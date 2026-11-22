// End-to-end workflow tests against a local dev server, using the real activities, policies and
// mocks (with zero latency). See testEnv.ts for why this uses createLocal, not time skipping.
import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import { Worker } from '@temporalio/worker';
import { documentsUploadedSignal, submitDecisionSignal } from '../shared/signals';
import type { DecisionChoice, LoanProduct, ReviewDecision } from '../shared/types';
import { createTestHarness, FAST, type TestHarness } from './testEnv';

const decision = (choice: DecisionChoice, reason: string, reviewer = 'kieran'): ReviewDecision => ({
  decision: choice,
  reviewer,
  reason,
  decidedAt: new Date().toISOString(),
});

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
      ['RECEIVED', 'VALIDATING', 'ENRICHING', 'UNDERWRITING', 'DISBURSING', 'FUNDED'],
    );
  });

  it('replays a recorded history deterministically', async () => {
    // Temporal's determinism check: re-run the workflow code against a real event history.
    // Fails if the code makes different decisions on replay than it did when it ran.
    const handle = await start(sample('priya.shah@example.com'));
    await waitFor(handle, 'IN_REVIEW');
    await handle.signal(submitDecisionSignal, decision('approve', 'Income verified'));
    await handle.result();
    await Worker.runReplayHistory({ workflowsPath: require.resolve('../workflows') }, await handle.fetchHistory());
  });

  it('declines on poor credit', async () => {
    const result = await (await start(sample('chris.martin@example.com'))).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Credit score 540/);
  });

  it('declines over the product cap even with good credit', async () => {
    const result = await (await start(sample('morgan.lee@example.com'))).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Amount \$80,000 exceeds debt consolidation max \$50,000/);
  });

  it('declines an unknown product at validation instead of failing the workflow', async () => {
    const app = { ...sample('jane.doe@example.com'), product: 'boat' as LoanProduct };
    const result = await (await start(app)).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /unknown product "boat"/);
  });

  it('pauses in IN_REVIEW and resumes on an approve decision', async () => {
    const handle = await start(sample('priya.shah@example.com'));
    const inReview = await waitFor(handle, 'IN_REVIEW');
    assert.deepEqual(inReview.reviewOptions, ['approve', 'decline']);

    await handle.signal(submitDecisionSignal, decision('approve', 'Manual DTI check ok'));
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review?.reviewer, 'kieran');
  });

  it('declines when the reviewer declines', async () => {
    const handle = await start(sample('taylor.brooks@example.com'));
    await waitFor(handle, 'IN_REVIEW');
    await handle.signal(submitDecisionSignal, decision('decline', 'Fraud signal confirmed'));
    const result = await handle.result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Declined by kieran/);
  });

  it('escalates to a supervisor on review timeout and still accepts a late decision', async () => {
    const handle = await start(sample('priya.shah@example.com'), { reviewTimeout: '1s', escalationTimeout: '1m' });
    const escalated = await waitFor(handle, 'ESCALATED');
    assert.deepEqual(escalated.reviewOptions, ['approve', 'decline'], 'still decidable while escalated');

    await handle.signal(submitDecisionSignal, decision('approve', 'Supervisor approved', 'supervisor'));
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review?.reviewer, 'supervisor');
    assert.ok(result.history.some((h) => h.status === 'ESCALATED'));
  });

  it('ends ESCALATED when neither reviewer nor supervisor decides', async () => {
    const result = await (await start(sample('priya.shah@example.com'), FAST)).result();
    assert.equal(result.status, 'ESCALATED');
    assert.match(result.outcomeReason ?? '', /No review decision/);
  });

  it('waits for missing documents, then continues once uploaded', async () => {
    const handle = await start(sample('sam.patel@example.com'));
    const waiting = await waitFor(handle, 'AWAITING_DOCUMENTS');
    assert.deepEqual(waiting.missingDocuments, ['vehicle_bill_of_sale']);

    await handle.signal(documentsUploadedSignal, [{ type: 'vehicle_bill_of_sale', uri: 'upload://test' }]);
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.ok(result.documents.some((d) => d.type === 'vehicle_bill_of_sale'));
  });

  it('declines as abandoned when documents never arrive', async () => {
    const result = await (await start(sample('sam.patel@example.com'), FAST)).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Abandoned: missing vehicle_bill_of_sale after 3 requests/);
  });

  it('ignores a review decision sent when nothing is pending', async () => {
    const handle = await start(sample('sam.patel@example.com'));
    await waitFor(handle, 'AWAITING_DOCUMENTS');
    await handle.signal(submitDecisionSignal, decision('approve', 'too early', 'someone'));
    await handle.signal(documentsUploadedSignal, [{ type: 'vehicle_bill_of_sale', uri: 'upload://test' }]);
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review, undefined);
  });
});
