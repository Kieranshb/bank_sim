// Domain types shared by clients, workflows and activities.
// Safe to import from workflow code: types only, no runtime dependencies.

export type Channel = 'portal' | 'broker' | 'aggregator';

export type LoanProduct = 'personal' | 'auto' | 'debt_consolidation';

export type ApplicationStatus =
  | 'RECEIVED'
  | 'VALIDATING'
  | 'AWAITING_DOCUMENTS'
  | 'ENRICHING'
  | 'UNDERWRITING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'DISBURSING'
  // terminal states
  | 'FUNDED'
  | 'DECLINED'
  | 'ESCALATED';

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
  amount: number;
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

export interface UnderwritingOutcome {
  result: 'approve' | 'decline' | 'refer';
  reasons: string[];
  policyVersion: string;
}

export interface ReviewDecision {
  decision: 'approve' | 'decline';
  reviewer: string;
  reason: string;
  decidedAt: string; // ISO timestamp, set by the client
}

// Everything an operator needs to see, exposed by the getStatus query
export interface ApplicationState {
  status: ApplicationStatus;
  history: { status: ApplicationStatus; at: string }[];
  missingDocuments: string[];
  enrichment?: EnrichmentResult;
  unavailableProviders?: string[];
  underwriting?: UnderwritingOutcome;
  review?: ReviewDecision;
  disbursementRef?: string;
  outcomeReason?: string; // why it reached its terminal state
}

export interface AuditEvent {
  workflowId: string;
  type: string; // e.g. 'UNDERWRITING_DECISION', 'REVIEW_DECISION', 'DISBURSED'
  actor: 'system' | string; // 'system' or reviewer id
  payload: unknown;
  policyVersion?: string;
}
