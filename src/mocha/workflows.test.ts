// End-to-end workflow tests against a local dev server, using the real activities, policies and
// mocks (with zero latency).
//
// createLocal, not createTimeSkipping: only the dev server can register the custom search
// attributes the workflow sets. It runs in real time, so timeout paths use short timing overrides.
import assert from 'assert';
import { tmpdir } from 'os';
import { join } from 'path';
import { after, before, describe, it } from 'mocha';
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
import { documentsUploadedSignal, getStatusQuery, submitDecisionSignal } from '../shared/signals';
import type { ApplicationState, ApplicationStatus, LoanApplication } from '../shared/types';
import { loadSampleApplications } from './samples';

const quiet = { send: async () => undefined };

// Timeouts fire quickly, for the escalation and abandonment paths
const FAST: Partial<WorkflowTiming> = { reviewTimeout: '1s', documentReminderInterval: '300ms' };
// Long enough that the test's signal always arrives first
const PATIENT: Partial<WorkflowTiming> = { reviewTimeout: '1m', documentReminderInterval: '1m' };

describe('loanApplicationWorkflow', function () {
  this.timeout(60_000);

  let env: TestWorkflowEnvironment;
  let workers: Worker[];
  let workersRunning: Promise<unknown>;
  const samples = loadSampleApplications();
  let seq = 0;

  before(async () => {
    env = await TestWorkflowEnvironment.createLocal({
      server: { searchAttributes: [APPLICATION_STATUS, LOAN_PRODUCT, CHANNEL] },
    });
    const connection = env.nativeConnection;
    workers = await Promise.all([
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
        }),
      }),
      Worker.create({ connection, taskQueue: TASK_QUEUES.underwriting, activities: createUnderwritingActivities(POLICIES) }),
      Worker.create({ connection, taskQueue: TASK_QUEUES.disbursement, activities: createDisbursementActivities(new MockCoreBanking()) }),
    ]);
    workersRunning = Promise.all(workers.map((w) => w.run()));
  });

  after(async () => {
    workers?.forEach((w) => w.shutdown());
    await workersRunning;
    await env?.teardown();
  });

  // Copy so the signal handler's document merge in one test can't leak into another
  const sample = (email: string): LoanApplication => JSON.parse(JSON.stringify(samples[email]));

  const start = (app: LoanApplication, timing: Partial<WorkflowTiming> = PATIENT) =>
    env.client.workflow.start(loanApplicationWorkflow, {
      taskQueue: TASK_QUEUES.workflow,
      workflowId: `${app.channel}:${app.externalId}-test-${++seq}`,
      args: [app, timing],
    });

  // Poll the query until the workflow is waiting where we expect
  async function waitFor(handle: WorkflowHandle, status: ApplicationStatus): Promise<ApplicationState> {
    for (let i = 0; i < 100; i++) {
      const state = await handle.query(getStatusQuery);
      if (state.status === status) return state;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Workflow never reached ${status}`);
  }

  it('auto-approves and reaches FUNDED', async () => {
    const result = await (await start(sample('jane.doe@example.com'))).result();
    assert.equal(result.status, 'FUNDED');
    assert.match(result.disbursementRef ?? '', /^DISB-/);
    assert.deepEqual(
      result.history.map((h) => h.status),
      ['RECEIVED', 'VALIDATING', 'ENRICHING', 'UNDERWRITING', 'APPROVED', 'DISBURSING', 'FUNDED'],
    );
  });

  it('declines on poor credit', async () => {
    const result = await (await start(sample('chris.martin@example.com'))).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Credit score 540/);
  });

  it('declines over the product cap even with good credit', async () => {
    const result = await (await start(sample('morgan.lee@example.com'))).result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /exceeds debt consolidation max/);
  });

  it('pauses in IN_REVIEW and resumes on submitDecision', async () => {
    const handle = await start(sample('priya.shah@example.com'));
    await waitFor(handle, 'IN_REVIEW');
    await handle.signal(submitDecisionSignal, {
      decision: 'approve',
      reviewer: 'kieran',
      reason: 'Manual DTI check ok',
      decidedAt: new Date().toISOString(),
    });
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review?.reviewer, 'kieran');
  });

  it('declines when the reviewer declines', async () => {
    const handle = await start(sample('taylor.brooks@example.com'));
    await waitFor(handle, 'IN_REVIEW');
    await handle.signal(submitDecisionSignal, {
      decision: 'decline',
      reviewer: 'kieran',
      reason: 'Fraud signal confirmed',
      decidedAt: new Date().toISOString(),
    });
    const result = await handle.result();
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Declined by kieran/);
  });

  it('moves to ESCALATED when no review decision arrives before the timeout', async () => {
    const result = await (await start(sample('priya.shah@example.com'), FAST)).result();
    assert.equal(result.status, 'ESCALATED');
    assert.match(result.outcomeReason ?? '', /No review decision within 1s/);
  });

  it('waits for missing documents, then continues once uploaded', async () => {
    const handle = await start(sample('sam.patel@example.com'));
    const waiting = await waitFor(handle, 'AWAITING_DOCUMENTS');
    assert.deepEqual(waiting.missingDocuments, ['vehicle_bill_of_sale']);

    await handle.signal(documentsUploadedSignal, [{ type: 'vehicle_bill_of_sale', uri: 'upload://test' }]);
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
  });

  it('declines as abandoned when documents never arrive', async () => {
    const result = await (await start(sample('sam.patel@example.com'), FAST)).result(); // 3 reminders
    assert.equal(result.status, 'DECLINED');
    assert.match(result.outcomeReason ?? '', /Abandoned: missing vehicle_bill_of_sale/);
  });

  it('ignores a review decision sent when the application is not in review', async () => {
    const handle = await start(sample('sam.patel@example.com'));
    await waitFor(handle, 'AWAITING_DOCUMENTS');
    await handle.signal(submitDecisionSignal, {
      decision: 'approve',
      reviewer: 'someone',
      reason: 'too early',
      decidedAt: new Date().toISOString(),
    });
    await handle.signal(documentsUploadedSignal, [{ type: 'vehicle_bill_of_sale', uri: 'upload://test' }]);
    const result = await handle.result();
    assert.equal(result.status, 'FUNDED');
    assert.equal(result.review, undefined);
  });
});
