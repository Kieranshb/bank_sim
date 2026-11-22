// Provider failures and unexpected failures, using stubbed providers and policies injected into
// the workers. Covers: an outage never leads to funding without the missing check, a provider
// rejecting our request goes to ops, a definitive "not found" is an answer, and any unexpected
// failure still ends in a terminal state.
import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import { ApplicationFailure } from '@temporalio/common';
import type { CreditBureau, FraudProvider } from '../activities/enrichment';
import { ProviderError } from '../activities/providerErrors';
import { MockCreditBureau, MockFraudProvider, MockIdentityProvider } from '../mocks/providers';
import { POLICIES } from '../products';
import { submitDecisionSignal } from '../shared/signals';
import type { ReviewDecision } from '../shared/types';
import { createTestHarness, FAST, PATIENT, type TestHarness } from './testEnv';

const decision = (choice: ReviewDecision['decision'], reason: string): ReviewDecision => ({
  decision: choice,
  reviewer: 'kieran',
  reason,
  decidedAt: new Date().toISOString(),
});

const settle = () => new Promise((r) => setTimeout(r, 500));

describe('loanApplicationWorkflow with failing providers', function () {
  this.timeout(60_000);

  // Fraud is down for Jane until the test brings it back; always rejects Chris's request (a 400)
  let fraudDownForJane = true;
  const fraud: FraudProvider = {
    async check(app) {
      if (app.applicant.email === 'jane.doe@example.com' && fraudDownForJane) {
        throw new ProviderError('Fraud service unavailable', 'Fraud', 503);
      }
      if (app.applicant.email === 'chris.martin@example.com') {
        throw new ProviderError('Fraud API rejected request: malformed account number', 'Fraud', 400);
      }
      return new MockFraudProvider().check(app);
    },
  };

  // Records who credit was pulled for, to prove a retry doesn't re-run providers that succeeded
  const creditCalls: string[] = [];
  const credit: CreditBureau = {
    async pull(app) {
      creditCalls.push(app.applicant.email);
      return new MockCreditBureau().pull(app);
    },
  };

  let t: TestHarness;
  before(async () => {
    t = await createTestHarness({
      providers: { credit, fraud, identity: new MockIdentityProvider({ notFoundEmail: 'alex.nguyen@example.com' }) },
    });
  });
  after(async () => {
    await t?.teardown();
  });

  it('never approves on incomplete data: a reviewer can only retry or decline', async () => {
    const handle = await t.start(t.sample('jane.doe@example.com'), { ...PATIENT, providerRetryWindow: '2s' });

    const inReview = await t.waitFor(handle, 'IN_REVIEW');
    assert.match(inReview.unavailableProviders?.[0] ?? '', /^fraud: /);
    assert.deepEqual(inReview.reviewOptions, ['retry', 'decline']);
    assert.equal(inReview.underwriting, undefined, 'no automated decision on incomplete data');

    // An approve is ignored: still waiting, nothing recorded
    await handle.signal(submitDecisionSignal, decision('approve', 'looks fine'));
    await settle();
    const stillWaiting = await t.waitFor(handle, 'IN_REVIEW');
    assert.equal(stillWaiting.review, undefined);

    // Provider recovers, reviewer retries: only fraud is called again, then normal underwriting
    fraudDownForJane = false;
    await handle.signal(submitDecisionSignal, decision('retry', 'fraud service is back'));
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.enrichment?.fraud.riskLevel, 'low');
    assert.equal(creditCalls.filter((e) => e === 'jane.doe@example.com').length, 1, 'credit pulled once');
  });

  it('escalates to ops, not underwriting review, when a provider rejects our request', async () => {
    const result = await (await t.start(t.sample('chris.martin@example.com'), FAST)).result();
    assert.equal(result.status, 'ESCALATED');
    assert.match(result.outcomeReason ?? '', /Provider rejected our request: fraud: Fraud API rejected/);
    assert.equal(result.underwriting, undefined);
    assert.ok(!result.history.some((h) => h.status === 'IN_REVIEW'), 'never sent to a reviewer');
  });

  it('declines when identity says the applicant does not exist', async () => {
    // A 404 from identity is an answer, not an outage: { verified: false }, declined by the policy
    const result = await (await t.start(t.sample('alex.nguyen@example.com'), FAST)).result();
    assert.equal(result.status, 'DECLINED');
    assert.equal(result.outcomeReason, 'Identity not verified');
    assert.equal(result.enrichment?.identity.verified, false);
  });
});

describe('loanApplicationWorkflow with an unexpected failure', function () {
  this.timeout(60_000);

  let t: TestHarness;
  before(async () => {
    // A personal policy that blows up: underwriting fails non-retryably
    t = await createTestHarness({
      policies: {
        personal: {
          ...POLICIES.personal,
          evaluate: () => {
            throw ApplicationFailure.nonRetryable('policy bug', 'PolicyBug');
          },
        },
      },
    });
  });
  after(async () => {
    await t?.teardown();
  });

  it('ends ESCALATED instead of leaving a Failed workflow', async () => {
    const result = await (await t.start(t.sample('jane.doe@example.com'), FAST)).result();
    assert.equal(result.status, 'ESCALATED');
    assert.match(result.outcomeReason ?? '', /Unexpected failure: policy bug/);
  });
});
