// Shared harness for workflow tests: a local dev server with the search attributes registered,
// plus the four workers wired to real activities and policies. Providers can be swapped per suite.
//
// createLocal, not createTimeSkipping: only the dev server can register the custom search
// attributes the workflow sets. It runs in real time, so timeout paths use the FAST timing below.
import { tmpdir } from 'os';
import { join } from 'path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { WorkflowHandle } from '@temporalio/client';
import { loanApplicationWorkflow, type WorkflowTiming } from '../workflows';
import {
  createAuditActivities,
  createDisbursementActivities,
  createEnrichmentActivities,
  createNotificationActivities,
  createUnderwritingActivities,
} from '../activities';
import type { EnrichmentDeps } from '../activities/enrichment';
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

// Timeouts fire quickly, for the escalation and abandonment paths
export const FAST: Partial<WorkflowTiming> = { reviewTimeout: '1s', documentReminderInterval: '300ms' };
// Long enough that the test's signal always arrives first
export const PATIENT: Partial<WorkflowTiming> = { reviewTimeout: '1m', documentReminderInterval: '1m' };

export interface TestHarness {
  start(app: LoanApplication, timing?: Partial<WorkflowTiming>): Promise<WorkflowHandle<typeof loanApplicationWorkflow>>;
  waitFor(handle: WorkflowHandle, status: ApplicationStatus): Promise<ApplicationState>;
  sample(email: string): LoanApplication;
  teardown(): Promise<void>;
}

export async function createTestHarness(providers: Partial<EnrichmentDeps> = {}): Promise<TestHarness> {
  const env = await TestWorkflowEnvironment.createLocal({
    server: { searchAttributes: [APPLICATION_STATUS, LOAN_PRODUCT, CHANNEL] },
  });
  const connection = env.nativeConnection;
  const quiet = { send: async () => undefined };

  const workers = await Promise.all([
    Worker.create({
      connection,
      taskQueue: TASK_QUEUES.workflow,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        ...createAuditActivities(new MockAuditSink(join(tmpdir(), `audit-test-${process.pid}.log`))),
        ...createNotificationActivities(quiet),
      },
    }),
    Worker.create({
      connection,
      taskQueue: TASK_QUEUES.enrichment,
      activities: createEnrichmentActivities({
        credit: new MockCreditBureau(),
        identity: new MockIdentityProvider(),
        fraud: new MockFraudProvider(),
        ...providers,
      }),
    }),
    Worker.create({ connection, taskQueue: TASK_QUEUES.underwriting, activities: createUnderwritingActivities(POLICIES) }),
    Worker.create({
      connection,
      taskQueue: TASK_QUEUES.disbursement,
      activities: createDisbursementActivities(new MockCoreBanking()),
    }),
  ]);
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

    // Copy so the signal handler's document merge in one test can't leak into another
    sample: (email) => JSON.parse(JSON.stringify(samples[email])),

    async teardown() {
      workers.forEach((w) => w.shutdown());
      await running;
      await env.teardown();
    },
  };
}
