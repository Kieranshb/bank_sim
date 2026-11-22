// Debt consolidation: unsecured and the applicant is already carrying debt,
// so a lower cap and a narrower review band than personal.
import type { UnderwritingOutcome } from '../shared/types';
import type { ProductPolicy } from './policy';

const VERSION = 'debt-consolidation-v1';
const MAX_AMOUNT = 50_000;
const APPROVE_AT = 700; // score >= 700 approve
const REFER_AT = 620; //   620-699 refer, < 620 decline

const decide = (result: UnderwritingOutcome['result'], reason: string): UnderwritingOutcome => ({
  result,
  reasons: [reason],
  policyVersion: VERSION,
});

export const debtConsolidationPolicy: ProductPolicy = {
  version: VERSION,
  requiredDocuments: ['id', 'pay_stub', 'debt_statements'],
  evaluate(app, { credit, identity, fraud }) {
    if (!identity.verified) return decide('decline', 'Identity not verified');
    if (app.amount > MAX_AMOUNT) {
      return decide('decline', `Amount $${app.amount} exceeds debt consolidation max $${MAX_AMOUNT}`);
    }
    if (fraud.riskLevel === 'high') return decide('refer', 'High fraud risk');
    if (credit.score >= APPROVE_AT) return decide('approve', `Credit score ${credit.score} >= ${APPROVE_AT}`);
    if (credit.score >= REFER_AT) return decide('refer', `Credit score ${credit.score} in review band ${REFER_AT}-${APPROVE_AT - 1}`);
    return decide('decline', `Credit score ${credit.score} < ${REFER_AT}`);
    // Next version (debt-consolidation-v2): post-consolidation debt-to-income from debt_statements
  },
};
