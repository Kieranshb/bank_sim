// Typed search attribute keys. Registered on the server by scripts/setup.sh.
// The workflow keeps ApplicationStatus current, so operators can query e.g.
//   ApplicationStatus="IN_REVIEW"   or   ApplicationStatus="AWAITING_DOCUMENTS" AND LoanProduct="auto"
import { defineSearchAttributeKey, SearchAttributeType } from '@temporalio/common';

export const APPLICATION_STATUS = defineSearchAttributeKey('ApplicationStatus', SearchAttributeType.KEYWORD);
export const LOAN_PRODUCT = defineSearchAttributeKey('LoanProduct', SearchAttributeType.KEYWORD);
export const CHANNEL = defineSearchAttributeKey('Channel', SearchAttributeType.KEYWORD);
