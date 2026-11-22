// Provider failures during enrichment, using stubbed providers injected into the enrichment worker.
// Shows partial failure handling: one provider failing doesn't lose the others' results,
// and a definitive "not found" is treated as an answer, not an outage.
import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import type { CreditBureau, FraudProvider } from '../activities/enrichment';
import { ProviderError } from '../activities/providerErrors';
import { MockCreditBureau, MockFraudProvider, MockIdentityProvider } from '../mocks/providers';
import { createTestHarness, FAST, type TestHarness } from './testEnv';

describe('loanApplicationWorkflow with failing providers', function () {
  this.timeout(60_000);

  // Fraud provider permanently rejects Jane's request (non-retryable); works for everyone else
  const brokenFraud: FraudProvider = {
    async check(app) {
      if (app.applicant.email === 'jane.doe@example.com') {
        throw new ProviderError('Fraud API rejected request: invalid account', 'Fraud', 400);
      }
      return new MockFraudProvider().check(app);
    },
  };

  // Counts calls, to prove credit isn't re-run when fraud fails
  const creditCalls: string[] = [];
  const countingCredit: CreditBureau = {
    async pull(app) {
      creditCalls.push(app.applicant.email);
      return new MockCreditBureau().pull(app);
    },
  };

  let t: TestHarness;
  before(async () => {
    t = await createTestHarness({
      credit: countingCredit,
      fraud: brokenFraud,
      identity: new MockIdentityProvider({ notFoundEmail: 'alex.nguyen@example.com' }),
    });
  });
  after(async () => {
    await t?.teardown();
  });

  it('refers to review when a provider fails, keeping the other results', async () => {
    const handle = await t.start(t.sample('jane.doe@example.com'), FAST);

    const inReview = await t.waitFor(handle, 'IN_REVIEW');
    assert.equal(inReview.unavailableProviders?.length, 1);
    assert.match(inReview.unavailableProviders![0], /^fraud: Fraud API rejected request/);
    assert.equal(inReview.underwriting, undefined, 'no automated decision on incomplete data');
    assert.deepEqual(creditCalls, ['jane.doe@example.com'], 'credit called exactly once');

    const result = await handle.result(); // nobody reviews it within FAST timing
    assert.equal(result.status, 'ESCALATED');
  });

  it('declines when identity says the applicant does not exist', async () => {
    // A 404 from identity is an answer, not an outage: mapped to { verified: false } and declined
    // by the policy straight away, with no retries and no review.
    const result = await (await t.start(t.sample('alex.nguyen@example.com'), FAST)).result();
    assert.equal(result.status, 'DECLINED');
    assert.equal(result.outcomeReason, 'Identity not verified');
    assert.equal(result.enrichment?.identity.verified, false);
  });
});
