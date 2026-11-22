// Personal loans: unsecured, so the strictest credit bands.
import type { UnderwritingOutcome } from '../shared/types';
import type { ProductPolicy } from './policy';

const VERSION = 'personal-v1';
const MAX_AMOUNT = 50_000;
const APPROVE_AT = 700; // score >= 700 approve
const REFER_AT = 600; //   600-699 refer, < 600 decline

const decide = (result: UnderwritingOutcome['result'], reason: string): UnderwritingOutcome => ({
  result,
  reasons: [reason],
  policyVersion: VERSION,
});

export const personalPolicy: ProductPolicy = {
  version: VERSION,
  requiredDocuments: ['id', 'pay_stub'],
  evaluate(app, { credit, identity, fraud }) {
    // Hard stops first
    if (!identity.verified) return decide('decline', 'Identity not verified');
    if (app.amount > MAX_AMOUNT) return decide('decline', `Amount $${app.amount} exceeds personal max $${MAX_AMOUNT}`);
    // Good credit doesn't override a fraud signal: a human looks at it
    if (fraud.riskLevel === 'high') return decide('refer', 'High fraud risk');
    if (credit.score >= APPROVE_AT) return decide('approve', `Credit score ${credit.score} >= ${APPROVE_AT}`);
    if (credit.score >= REFER_AT) return decide('refer', `Credit score ${credit.score} in review band ${REFER_AT}-${APPROVE_AT - 1}`);
    return decide('decline', `Credit score ${credit.score} < ${REFER_AT}`);
  },
};
