// Auto loans: secured by the vehicle, so higher max and a lower approve threshold.
import type { UnderwritingOutcome } from '../shared/types';
import type { ProductPolicy } from './policy';

const VERSION = 'auto-v1';
const MAX_AMOUNT = 75_000;
const APPROVE_AT = 680; // score >= 680 approve
const REFER_AT = 600; //   600-679 refer, < 600 decline

const decide = (result: UnderwritingOutcome['result'], reason: string): UnderwritingOutcome => ({
  result,
  reasons: [reason],
  policyVersion: VERSION,
});

export const autoPolicy: ProductPolicy = {
  version: VERSION,
  requiredDocuments: ['id', 'pay_stub', 'vehicle_bill_of_sale'],
  evaluate(app, { credit, identity, fraud }) {
    if (!identity.verified) return decide('decline', 'Identity not verified');
    if (app.amount > MAX_AMOUNT) return decide('decline', `Amount $${app.amount} exceeds auto max $${MAX_AMOUNT}`);
    if (fraud.riskLevel === 'high') return decide('refer', 'High fraud risk');
    if (credit.score >= APPROVE_AT) return decide('approve', `Credit score ${credit.score} >= ${APPROVE_AT}`);
    if (credit.score >= REFER_AT) return decide('refer', `Credit score ${credit.score} in review band ${REFER_AT}-${APPROVE_AT - 1}`);
    return decide('decline', `Credit score ${credit.score} < ${REFER_AT}`);
    // Next version (auto-v2): loan-to-value check once the bill of sale is parsed
  },
};
