// Activity unit tests: plain calls against the factories with mock dependencies.
import assert from 'assert';
import { describe, it } from 'mocha';
import { createAuditActivities } from '../activities/audit';
import { createDisbursementActivities } from '../activities/disbursement';
import { createUnderwritingActivities } from '../activities/underwriting';
import type { AuditSink } from '../activities/audit';
import { MockAuditSink, MockCoreBanking } from '../mocks/providers';
import { POLICIES } from '../products';
import { dollarsToCents, formatCents } from '../shared/money';
import type { EnrichmentResult, LoanApplication, LoanProduct } from '../shared/types';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const app = (product: LoanProduct): LoanApplication => ({
  channel: 'portal',
  externalId: 'test',
  product,
  amountCents: 2_000_000,
  applicant: { name: 'Test', email: 'test@example.com' },
  documents: [],
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

    assert.deepEqual(await missingDocuments('auto', ['id']), ['pay_stub', 'vehicle_bill_of_sale']);
    assert.deepEqual(await missingDocuments('auto', ['id', 'pay_stub', 'vehicle_bill_of_sale']), []);
    assert.deepEqual(await missingDocuments('personal', ['id', 'pay_stub', 'extra']), []);
  });

  it('underwrite fails non-retryably for an unknown product', async () => {
    const { underwrite } = createUnderwritingActivities(POLICIES);
    await assert.rejects(underwrite(app('boat' as LoanProduct), enrichment), (err: { nonRetryable?: boolean; type?: string }) => {
      assert.equal(err.nonRetryable, true);
      assert.equal(err.type, 'UnknownProduct');
      return true;
    });
  });

  it('a retried audit write with the same eventId is recorded once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'));
    try {
      const path = join(dir, 'audit.log');
      const sink: AuditSink = new MockAuditSink(path);
      const { recordAuditEvent } = createAuditActivities(sink);
      const event = { eventId: 'portal:app-123:1', workflowId: 'portal:app-123', type: 'APPROVED' as const, actor: 'system', payload: {} };

      await recordAuditEvent(event);
      await recordAuditEvent(event); // e.g. worker crashed after the write, before reporting completion
      await recordAuditEvent({ ...event, eventId: 'portal:app-123:2' });

      const lines = readFileSync(path, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('money', () => {
  it('parses dollar strings to integer cents without floats', () => {
    assert.equal(dollarsToCents('$32,500'), 3_250_000);
    assert.equal(dollarsToCents('15000.00'), 1_500_000);
    assert.equal(dollarsToCents('0.1'), 10);
    assert.equal(dollarsToCents('19.99'), 1_999);
    assert.throws(() => dollarsToCents('12.345'));
    assert.throws(() => dollarsToCents('abc'));
  });

  it('formats cents for humans', () => {
    assert.equal(formatCents(3_250_000), '$32,500');
    assert.equal(formatCents(1_500_050), '$15,000.50');
    assert.equal(formatCents(1_999), '$19.99');
  });
});
