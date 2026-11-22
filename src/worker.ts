// Runs all four workers in one process for the demo.
// In production each would be its own deployment, scaled and secured separately.
//
// This is the only file that decides which implementations are real and which are mocked.
import { NativeConnection, Worker } from '@temporalio/worker';
import { config } from './config';
import { TASK_QUEUES } from './shared/taskQueues';
import {
  createAuditActivities,
  createDisbursementActivities,
  createEnrichmentActivities,
  createNotificationActivities,
  createUnderwritingActivities,
} from './activities';
import { POLICIES } from './products';
import {
  ConsoleNotifier,
  MockAuditSink,
  MockCoreBanking,
  MockCreditBureau,
  MockFraudProvider,
  MockIdentityProvider,
} from './mocks/providers';

async function run() {
  const connection = await NativeConnection.connect({ address: config.temporalAddress });
  const { latencyMs } = config.mocks;

  try {
    const workers = await Promise.all([
      // Orchestration + lightweight internal activities
      Worker.create({
        connection,
        namespace: config.namespace,
        taskQueue: TASK_QUEUES.workflow,
        workflowsPath: require.resolve('./workflows'),
        activities: {
          ...createAuditActivities(new MockAuditSink(config.auditLogPath)),
          ...createNotificationActivities(new ConsoleNotifier()),
        },
      }),

      // Third-party calls, rate limited across all enrichment workers
      // Production: one queue per provider, since each has its own rate limit
      Worker.create({
        connection,
        namespace: config.namespace,
        taskQueue: TASK_QUEUES.enrichment,
        activities: createEnrichmentActivities({
          credit: new MockCreditBureau({ latencyMs }),
          identity: new MockIdentityProvider({ latencyMs, notFoundEmail: config.mocks.identityNotFound }),
          fraud: new MockFraudProvider({ latencyMs, outage: config.mocks.fraudOutage }),
        }),
        maxTaskQueueActivitiesPerSecond: config.enrichmentRatePerSecond,
      }),

      // Product policies injected here
      Worker.create({
        connection,
        namespace: config.namespace,
        taskQueue: TASK_QUEUES.underwriting,
        activities: createUnderwritingActivities(POLICIES),
      }),

      // Money movement, isolated on its own queue
      Worker.create({
        connection,
        namespace: config.namespace,
        taskQueue: TASK_QUEUES.disbursement,
        activities: createDisbursementActivities(new MockCoreBanking({ latencyMs })),
      }),
    ]);

    await Promise.all(workers.map((w) => w.run()));
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
