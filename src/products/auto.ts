// Auto loans: secured by the vehicle, so a higher cap and a lower approve threshold.
// Next version (auto-v2): loan-to-value check once the bill of sale is parsed.
//
// The hard stops (identity, amount cap, fraud) repeat across products on purpose: each product
// owns its full rule set and can diverge without touching the others.
import { formatCents } from '../shared/money';
import type { PolicyDecision } from '../shared/types';
import type { ProductPolicy } from './policy';

const MAX_AMOUNT_CENTS = 7_500_000; // $75,000
const APPROVE_AT = 680; // score >= 680 approve
const REFER_AT = 600; //   600-679 refer, < 600 decline

const decide = (result: PolicyDecision['result'], reason: string): PolicyDecision => ({ result, reasons: [reason] });

export const autoPolicy: ProductPolicy = {
  version: 'auto-v1',
  requiredDocuments: ['id', 'pay_stub', 'vehicle_bill_of_sale'],
  evaluate(app, { credit, identity, fraud }) {
    // Hard stops first
    if (!identity.verified) return decide('decline', 'Identity not verified');
    if (app.amountCents > MAX_AMOUNT_CENTS) {
      return decide('decline', `Amount ${formatCents(app.amountCents)} exceeds auto max ${formatCents(MAX_AMOUNT_CENTS)}`);
    }
    // Good credit doesn't override a fraud signal: a human looks at it
    if (fraud.riskLevel === 'high') return decide('refer', 'High fraud risk');
    if (credit.score >= APPROVE_AT) return decide('approve', `Credit score ${credit.score} >= ${APPROVE_AT}`);
    if (credit.score >= REFER_AT) {
      return decide('refer', `Credit score ${credit.score} in review band ${REFER_AT}-${APPROVE_AT - 1}`);
    }
    return decide('decline', `Credit score ${credit.score} < ${REFER_AT}`);
  },
};
