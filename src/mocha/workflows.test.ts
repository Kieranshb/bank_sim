// End-to-end workflow tests against a local dev server, using the real activities, policies and
// mocks (with zero latency). See testEnv.ts for why this uses createLocal, not time skipping.
import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import { documentsUploadedSignal, submitDecisionSignal } from '../shared/signals';
import { createTestHarness, FAST, type TestHarness } from './testEnv';

describe('loanApplicationWorkflow', function () {
  this.timeout(60_000);

  let t: TestHarness;
  before(async () => {
    t = await createTestHarness();
  });
  after(async () => {
    await t?.teardown();
  });

  const start: TestHarness['start'] = (...args) => t.start(...args);
  const waitFor: TestHarness['waitFor'] = (...args) => t.waitFor(...args);
  const sample: TestHarness['sample'] = (email) => t.sample(email);

  it('auto-approves and reaches FUNDED', async () => {
    const result = await (await start(sample('jane.doe@example.com'))).result();
    assert.equal(result.status, 'FUNDED');
    assert.match(result.disbursementRef ?? '', /^DISB-/);
    assert.deepEqual(
      result.history.map((h) => h.status),
      ['RECEIVED', 'VALIDATING', 'ENRICHING', 'UNDERWRITING', 'APPROVED', 'DISBURSING', 'FUNDED'],
    );
  });

  it('declines on poor credit', async () => {
    const result = await (await start(sample('chris.martin@example.com'))).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Credit score 540/);
  });

  it('declines over the product cap even with good credit', async () => {
    const result = await (await start(sample('morgan.lee@example.com'))).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /exceeds debt consolidation max/);
  });

  it('pauses in IN_REVIEW and resumes on submitDecision', async () => {
    const handle = await start(sample('priya.shah@example.com'));
    await waitFor(handle, 'IN_REVIEW');
    await handle.signal(submitDecisionSignal, {
      decision: 'approve',
      reviewer: 'kieran',
      reason: 'Manual DTI check ok',
      decidedAt: new Date().toISOString(),
    });
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review?.reviewer, 'kieran');
  });

  it('declines when the reviewer declines', async () => {
    const handle = await start(sample('taylor.brooks@example.com'));
    await waitFor(handle, 'IN_REVIEW');
    await handle.signal(submitDecisionSignal, {
      decision: 'decline',
      reviewer: 'kieran',
      reason: 'Fraud signal confirmed',
      decidedAt: new Date().toISOString(),
    });
    const result = await handle.result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Declined by kieran/);
  });

  it('moves to ESCALATED when no review decision arrives before the timeout', async () => {
    const result = await (await start(sample('priya.shah@example.com'), FAST)).result();
    assert.equal(result.status, 'ESCALATED');
    assert.match(result.outcomeReason ?? '', /No review decision within 1s/);
  });

  it('waits for missing documents, then continues once uploaded', async () => {
    const handle = await start(sample('sam.patel@example.com'));
    const waiting = await waitFor(handle, 'AWAITING_DOCUMENTS');
    assert.deepEqual(waiting.missingDocuments, ['vehicle_bill_of_sale']);

    await handle.signal(documentsUploadedSignal, [{ type: 'vehicle_bill_of_sale', uri: 'upload://test' }]);
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
  });

  it('declines as abandoned when documents never arrive', async () => {
    const result = await (await start(sample('sam.patel@example.com'), FAST)).result(); // 3 reminders
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Abandoned: missing vehicle_bill_of_sale/);
  });

  it('ignores a review decision sent when the application is not in review', async () => {
    const handle = await start(sample('sam.patel@example.com'));
    await waitFor(handle, 'AWAITING_DOCUMENTS');
    await handle.signal(submitDecisionSignal, {
      decision: 'approve',
      reviewer: 'someone',
      reason: 'too early',
      decidedAt: new Date().toISOString(),
    });
    await handle.signal(documentsUploadedSignal, [{ type: 'vehicle_bill_of_sale', uri: 'upload://test' }]);
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review, undefined);
  });
});
