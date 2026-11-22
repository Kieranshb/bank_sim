// Workflow tests run against Temporal's local test server with mocked activities,
// so every path through the state machine can be checked without real providers.
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { after, before, describe, it } from 'mocha';

describe('loanApplicationWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  before(async () => {
    // Time-skipping lets review / document timeouts fire instantly
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  });

  after(async () => {
    await testEnv?.teardown();
  });

  // TODO: helper that creates a Worker with mocked activities on a test queue
  //   (see the original hello-world workflows-mocks.test.ts for the pattern)

  it.skip('auto-approves and reaches FUNDED');
  it.skip('declines when underwriting declines');
  it.skip('pauses in IN_REVIEW and resumes on submitDecision');
  it.skip('moves to ESCALATED when no review decision arrives before timeout');
  it.skip('declines as abandoned when documents never arrive');
  it.skip('retries a failing enrichment provider without repeating the others');
});
