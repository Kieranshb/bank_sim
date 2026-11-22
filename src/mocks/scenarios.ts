// Demo scenarios: which sample applicant takes which path through the workflow.
// The mocks read provider results from here; tests can assert on `expect`.
// Inputs live in samples/; this table is the expected behaviour for each one.
import type { ApplicationStatus, FraudResult } from '../shared/types';

export interface Scenario {
  sample: string; // which sample input this applicant comes from
  creditScore: number;
  fraudRisk?: FraudResult['riskLevel']; // defaults to 'low'
  expect: ApplicationStatus; // terminal (or waiting) status the workflow should reach
  missingDocuments?: string[]; // deliberate gaps in the sample (defaults to none)
  note?: string;
}

export const SCENARIOS: Record<string, Scenario> = {
  'jane.doe@example.com': { sample: 'portal-form.json', creditScore: 760, expect: 'FUNDED' },
  // Documents wait: missing vehicle_bill_of_sale, so it pauses until it's uploaded
  'sam.patel@example.com': {
    sample: 'broker-email.txt',
    creditScore: 720,
    missingDocuments: ['vehicle_bill_of_sale'],
    expect: 'FUNDED',
    note: 'waits in AWAITING_DOCUMENTS until: npm run upload-docs -- <workflowId> vehicle_bill_of_sale',
  },
  'alex.nguyen@example.com': { sample: 'aggregator-batch.json (rec-001)', creditScore: 705, expect: 'FUNDED' },
  'priya.shah@example.com': { sample: 'aggregator-batch.json (rec-002)', creditScore: 650, expect: 'IN_REVIEW' },
  'chris.martin@example.com': { sample: 'aggregator-batch.json (rec-003)', creditScore: 540, expect: 'DECLINED' },

  // Product isolation: strong credit, but $80k is over the debt consolidation cap
  'morgan.lee@example.com': { sample: 'aggregator-batch.json (rec-004)', creditScore: 780, expect: 'DECLINED' },

  // Underwriting uses all enrichment: strong credit, high fraud risk, so a human looks at it
  'taylor.brooks@example.com': {
    sample: 'aggregator-batch.json (rec-005)',
    creditScore: 740,
    fraudRisk: 'high',
    expect: 'IN_REVIEW',
  },
};

// Anyone not listed above
export const DEFAULT_SCENARIO: Omit<Scenario, 'sample' | 'expect'> = { creditScore: 700 };

export function scenarioFor(email: string) {
  return SCENARIOS[email] ?? DEFAULT_SCENARIO;
}
