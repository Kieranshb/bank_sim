// Personal loans: unsecured, so the strictest credit bands.
//
// The hard stops (identity, amount cap, fraud) repeat across products on purpose: each product
// owns its full rule set and can diverge without touching the others.
import { formatCents } from '../shared/money';
import type { PolicyDecision } from '../shared/types';
import type { ProductPolicy } from './policy';

const MAX_AMOUNT_CENTS = 5_000_000; // $50,000
const APPROVE_AT = 700; // score >= 700 approve
const REFER_AT = 600; //   600-699 refer, < 600 decline

const decide = (result: PolicyDecision['result'], reason: string): PolicyDecision => ({ result, reasons: [reason] });

export const personalPolicy: ProductPolicy = {
  version: 'personal-v1',
  requiredDocuments: ['id', 'pay_stub'],
  evaluate(app, { credit, identity, fraud }) {
    // Hard stops first
    if (!identity.verified) return decide('decline', 'Identity not verified');
    if (app.amountCents > MAX_AMOUNT_CENTS) {
      return decide('decline', `Amount ${formatCents(app.amountCents)} exceeds personal max ${formatCents(MAX_AMOUNT_CENTS)}`);
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
