// Shared harness for workflow tests: a local dev server with the search attributes registered,
// plus the four workers built by the same createWorkers() production uses. Providers and
// policies can be swapped per suite.
//
// createLocal, not createTimeSkipping: only the dev server can register the custom search
// attributes the workflow sets. It runs in real time, so timeout paths use the FAST timing below.
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import type { WorkflowHandle } from '@temporalio/client';
import { loanApplicationWorkflow, type WorkflowTiming } from '../workflows';
import { createWorkers } from '../workers';
import type { EnrichmentDeps } from '../activities/enrichment';
import type { PolicyRegistry } from '../products/policy';
import { POLICIES } from '../products';
import {
  MockAuditSink,
  MockCoreBanking,
  MockCreditBureau,
  MockFraudProvider,
  MockIdentityProvider,
} from '../mocks/providers';
import { TASK_QUEUES } from '../shared/taskQueues';
import { APPLICATION_STATUS, CHANNEL, LOAN_PRODUCT } from '../shared/searchAttributes';
import { getStatusQuery } from '../shared/signals';
import type { ApplicationState, ApplicationStatus, LoanApplication } from '../shared/types';
import { loadSampleApplications } from './samples';

// Timeouts fire quickly, for the escalation, abandonment and provider-outage paths
export const FAST: Partial<WorkflowTiming> = {
  reviewTimeout: '1s',
  escalationTimeout: '1s',
  documentReminderInterval: '300ms',
  providerRetryWindow: '2s',
};
// Long enough that the test's signal always arrives first
export const PATIENT: Partial<WorkflowTiming> = {
  reviewTimeout: '1m',
  escalationTimeout: '1m',
  documentReminderInterval: '1m',
  providerRetryWindow: '1m',
};

export interface TestHarness {
  start(app: LoanApplication, timing?: Partial<WorkflowTiming>): Promise<WorkflowHandle<typeof loanApplicationWorkflow>>;
  waitFor(handle: WorkflowHandle, status: ApplicationStatus): Promise<ApplicationState>;
  sample(email: string): LoanApplication;
  teardown(): Promise<void>;
}

export async function createTestHarness(
  overrides: { providers?: Partial<EnrichmentDeps>; policies?: Partial<PolicyRegistry> } = {},
): Promise<TestHarness> {
  const env = await TestWorkflowEnvironment.createLocal({
    server: { searchAttributes: [APPLICATION_STATUS, LOAN_PRODUCT, CHANNEL] },
  });
  const auditLog = join(tmpdir(), `audit-test-${process.pid}-${Date.now()}.log`);

  const workers = await createWorkers(env.nativeConnection, {
    auditSink: new MockAuditSink(auditLog),
    notifier: { send: async () => undefined },
    providers: {
      credit: new MockCreditBureau(),
      identity: new MockIdentityProvider(),
      fraud: new MockFraudProvider(),
      ...overrides.providers,
    },
    policies: { ...POLICIES, ...overrides.policies },
    coreBanking: new MockCoreBanking(),
  });
  const running = Promise.all(workers.map((w) => w.run()));

  const samples = loadSampleApplications();
  let seq = 0;

  return {
    start: (app, timing = PATIENT) =>
      env.client.workflow.start(loanApplicationWorkflow, {
        taskQueue: TASK_QUEUES.workflow,
        workflowId: `${app.channel}:${app.externalId}-test-${++seq}`,
        args: [app, timing],
      }),

    // Poll the query until the workflow is waiting where we expect
    async waitFor(handle, status) {
      for (let i = 0; i < 100; i++) {
        const state = await handle.query(getStatusQuery);
        if (state.status === status) return state;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Workflow never reached ${status}`);
    },

    // Copy so one test can't leak changes into another
    sample: (email) => JSON.parse(JSON.stringify(samples[email])),

    async teardown() {
      workers.forEach((w) => w.shutdown());
      await running;
      await env.teardown();
      rmSync(auditLog, { force: true });
    },
  };
}
