// Domain types shared by clients, workflows and activities.
// Safe to import from workflow code: types only, no runtime dependencies.

export type Channel = 'portal' | 'broker' | 'aggregator';

export const LOAN_PRODUCTS = ['personal', 'auto', 'debt_consolidation'] as const;
export type LoanProduct = (typeof LOAN_PRODUCTS)[number];

export type ApplicationStatus =
  | 'RECEIVED'
  | 'VALIDATING'
  | 'AWAITING_DOCUMENTS'
  | 'ENRICHING'
  | 'UNDERWRITING'
  | 'IN_REVIEW'
  | 'DISBURSING'
  // terminal states
  | 'FUNDED'
  | 'DECLINED'
  // Escalated to a supervisor. While the workflow is still running a decision is still accepted;
  // once the supervisor window expires (or ops must step in) the workflow completes in this state.
  | 'ESCALATED';

export type TerminalStatus = 'FUNDED' | 'DECLINED' | 'ESCALATED';

export interface Applicant {
  name: string;
  email: string;
  // Trimmed to what the demo needs; production adds date of birth, address, income, employment
}

export interface LoanDocument {
  type: string; // e.g. 'pay_stub', 'id', 'vehicle_bill_of_sale'
  uri: string;
}

export interface LoanApplication {
  channel: Channel;
  externalId: string; // portal app id, email messageId, aggregator record id
  product: LoanProduct;
  amountCents: number; // integer cents, see shared/money.ts
  applicant: Applicant;
  documents: LoanDocument[];
  broker?: string;
}

// Provider results are trimmed to the fields the policies actually read
export interface CreditReport {
  score: number; // 300-900
}

export interface IdentityResult {
  verified: boolean;
}

export interface FraudResult {
  riskLevel: 'low' | 'medium' | 'high';
}

export interface EnrichmentResult {
  credit: CreditReport;
  identity: IdentityResult;
  fraud: FraudResult;
}

// What a policy decides. The underwriting activity stamps the policy version onto it.
export interface PolicyDecision {
  result: 'approve' | 'decline' | 'refer';
  reasons: string[];
}

export interface UnderwritingOutcome extends PolicyDecision {
  policyVersion: string;
}

// 'retry' re-runs enrichment; only offered when a provider was unavailable (never 'approve' then)
export type DecisionChoice = 'approve' | 'decline' | 'retry';

export interface ReviewDecision {
  decision: DecisionChoice;
  reviewer: string;
  reason: string;
  decidedAt: string; // ISO timestamp, set by the client
}

// Everything an operator needs to see, exposed by the getStatus query
export interface ApplicationState {
  status: ApplicationStatus;
  history: { status: ApplicationStatus; at: string }[];
  documents: LoanDocument[]; // as submitted, plus uploads
  missingDocuments: string[];
  enrichment?: EnrichmentResult;
  unavailableProviders?: string[];
  underwriting?: UnderwritingOutcome;
  reviewReasons?: string[]; // why a human is looking at it
  reviewOptions?: DecisionChoice[]; // decisions accepted right now (only while waiting)
  review?: ReviewDecision;
  disbursementRef?: string;
  outcomeReason?: string; // why it reached its terminal state
}

export type AuditEventType =
  | 'UNDERWRITING_DECISION'
  | 'ENRICHMENT_INCOMPLETE'
  | 'PROVIDER_REJECTED'
  | 'ESCALATED_TO_SUPERVISOR'
  | 'REVIEW_DECISION'
  | 'APPROVED'
  | 'DISBURSED'
  | TerminalStatus;

export interface AuditEvent {
  eventId: string; // workflowId:sequence, so a retried audit write is recognised as a duplicate
  workflowId: string;
  type: AuditEventType;
  actor: 'system' | string; // 'system' or reviewer id
  payload: unknown;
  policyVersion?: string;
}
