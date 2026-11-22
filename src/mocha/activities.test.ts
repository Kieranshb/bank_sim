// Activity unit tests: plain calls against the factories with mock dependencies.
import assert from 'assert';
import { describe, it } from 'mocha';
import { createDisbursementActivities } from '../activities/disbursement';
import { createUnderwritingActivities } from '../activities/underwriting';
import { MockCoreBanking } from '../mocks/providers';
import { POLICIES } from '../products';
import type { EnrichmentResult, LoanApplication, LoanProduct } from '../shared/types';

const app = (product: LoanProduct, documents: string[] = []): LoanApplication => ({
  channel: 'portal',
  externalId: 'test',
  product,
  amount: 20_000,
  applicant: { name: 'Test', email: 'test@example.com' },
  documents: documents.map((type) => ({ type, uri: `test://${type}` })),
});

const enrichment: EnrichmentResult = { credit: { score: 690 }, identity: { verified: true }, fraud: { riskLevel: 'low' } };

describe('activities', () => {
  it('disburseLoan returns the same reference for the same idempotency key, and pays once', async () => {
    const coreBanking = new MockCoreBanking();
    const { disburseLoan } = createDisbursementActivities(coreBanking);

    const first = await disburseLoan(app('personal'), 'portal:app-123');
    const retry = await disburseLoan(app('personal'), 'portal:app-123');
    const other = await disburseLoan(app('personal'), 'portal:app-456');

    assert.equal(first.reference, retry.reference);
    assert.notEqual(first.reference, other.reference);
    assert.equal(coreBanking.payoutCount, 2, 'the retry did not pay again');
  });

  it("underwrite uses the application's product policy and stamps its version", async () => {
    const { underwrite } = createUnderwritingActivities(POLICIES);
    // Score 690: auto approves at >= 680, personal refers below 700
    const auto = await underwrite(app('auto'), enrichment);
    const personal = await underwrite(app('personal'), enrichment);

    assert.equal(auto.result, 'approve');
    assert.equal(auto.policyVersion, 'auto-v1');
    assert.equal(personal.result, 'refer');
    assert.equal(personal.policyVersion, 'personal-v1');
  });

  it('missingDocuments lists required documents not yet uploaded', async () => {
    const { missingDocuments } = createUnderwritingActivities(POLICIES);

    assert.deepEqual(await missingDocuments(app('auto', ['id'])), ['pay_stub', 'vehicle_bill_of_sale']);
    assert.deepEqual(await missingDocuments(app('auto', ['id', 'pay_stub', 'vehicle_bill_of_sale'])), []);
    assert.deepEqual(await missingDocuments(app('personal', ['id', 'pay_stub', 'extra'])), []);
  });

  it('underwrite fails non-retryably for an unknown product', async () => {
    const { underwrite } = createUnderwritingActivities(POLICIES);
    await assert.rejects(underwrite(app('boat' as LoanProduct), enrichment), (err: { nonRetryable?: boolean; type?: string }) => {
      assert.equal(err.nonRetryable, true);
      assert.equal(err.type, 'UnknownProduct');
      return true;
    });
  });
});
