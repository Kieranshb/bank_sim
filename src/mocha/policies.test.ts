// Product policies are pure functions, so the rule combinations are tested here, table-driven,
// with no Temporal involved. Demo scenarios (mocks/scenarios.ts) are checked too, so the sample
// data and the rules can't drift apart.
import assert from 'assert';
import { describe, it } from 'mocha';
import { POLICIES } from '../products';
import { SCENARIOS } from '../mocks/scenarios';
import { createUnderwritingActivities } from '../activities/underwriting';
import { loadSampleApplications } from './samples';
import type { EnrichmentResult, FraudResult, LoanApplication, LoanProduct, UnderwritingOutcome } from '../shared/types';

const app = (product: LoanProduct, amount: number): LoanApplication => ({
  channel: 'portal',
  externalId: 'test',
  product,
  amount,
  applicant: { name: 'Test', email: 'test@example.com' },
  documents: [],
});

const enrichment = (score: number, fraud: FraudResult['riskLevel'] = 'low', verified = true): EnrichmentResult => ({
  credit: { score },
  identity: { verified },
  fraud: { riskLevel: fraud },
});

type Case = [LoanProduct, number, number, FraudResult['riskLevel'], boolean, UnderwritingOutcome['result']];

// product, amount, score, fraud, identity verified, expected
const CASES: Case[] = [
  // personal: approve >= 700, refer 600-699, max $50k
  ['personal', 15_000, 700, 'low', true, 'approve'],
  ['personal', 15_000, 699, 'low', true, 'refer'],
  ['personal', 15_000, 600, 'low', true, 'refer'],
  ['personal', 15_000, 599, 'low', true, 'decline'],
  ['personal', 50_001, 800, 'low', true, 'decline'],
  // auto: approve >= 680, refer 600-679, max $75k
  ['auto', 30_000, 680, 'low', true, 'approve'],
  ['auto', 30_000, 679, 'low', true, 'refer'],
  ['auto', 30_000, 599, 'low', true, 'decline'],
  ['auto', 75_000, 700, 'low', true, 'approve'],
  ['auto', 75_001, 700, 'low', true, 'decline'],
  // debt consolidation: approve >= 700, refer 620-699, max $50k
  ['debt_consolidation', 20_000, 700, 'low', true, 'approve'],
  ['debt_consolidation', 20_000, 620, 'low', true, 'refer'],
  ['debt_consolidation', 20_000, 619, 'low', true, 'decline'],
  ['debt_consolidation', 80_000, 780, 'low', true, 'decline'],
  // every product: fraud high refers, identity failure declines, medium fraud doesn't block
  ['personal', 15_000, 800, 'high', true, 'refer'],
  ['auto', 30_000, 800, 'high', true, 'refer'],
  ['debt_consolidation', 20_000, 800, 'high', true, 'refer'],
  ['personal', 15_000, 800, 'medium', true, 'approve'],
  ['auto', 30_000, 800, 'low', false, 'decline'],
];

describe('product policies', () => {
  for (const [product, amount, score, fraud, verified, expected] of CASES) {
    it(`${product} $${amount} score ${score} fraud ${fraud}${verified ? '' : ' unverified'} -> ${expected}`, () => {
      const outcome = POLICIES[product].evaluate(app(product, amount), enrichment(score, fraud, verified));
      assert.equal(outcome.result, expected);
      assert.equal(outcome.policyVersion, POLICIES[product].version);
      assert.ok(outcome.reasons.length > 0, 'every decision carries a reason');
    });
  }

  it('identity failure wins over fraud and credit', () => {
    const outcome = POLICIES.personal.evaluate(app('personal', 15_000), enrichment(800, 'high', false));
    assert.equal(outcome.result, 'decline');
  });
});

describe('demo scenarios match the samples and policies', () => {
  const samples = loadSampleApplications();
  const underwriting = createUnderwritingActivities(POLICIES);
  const RESULT_TO_STATUS = { approve: 'FUNDED', refer: 'IN_REVIEW', decline: 'DECLINED' } as const;

  it('every scenario has a sample input and every sample has a scenario', () => {
    assert.deepEqual(Object.keys(samples).sort(), Object.keys(SCENARIOS).sort());
  });

  for (const [email, scenario] of Object.entries(SCENARIOS)) {
    const gaps = scenario.missingDocuments ?? [];

    it(`${email} has its required documents${gaps.length ? ` except ${gaps.join(', ')}` : ''}`, async () => {
      assert.deepEqual(await underwriting.missingDocuments(samples[email]), gaps);
    });

    it(`${email} -> ${scenario.expect}`, () => {
      const app = samples[email];
      const outcome = POLICIES[app.product].evaluate(app, enrichment(scenario.creditScore, scenario.fraudRisk));
      assert.equal(RESULT_TO_STATUS[outcome.result], scenario.expect);
    });
  }
});
