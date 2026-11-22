// Workflow tests with stubbed dependencies: e.g. inject a policy that always refers,
// to test the review path without depending on real thresholds.
import { describe, it } from 'mocha';

describe('loanApplicationWorkflow with stubbed policies', () => {
  it.skip('review path: stub policy always refers, reviewer approves -> FUNDED');
  it.skip('review path: stub policy always refers, reviewer declines -> DECLINED');
  it.skip('disbursement retry does not pay twice (same idempotency key)');
});
