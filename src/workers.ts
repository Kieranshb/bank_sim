// Builds the four workers from their dependencies. Used by worker.ts (production wiring) and by
// the test harness, so tests exercise exactly the same task queues and registrations.
import { Worker, type NativeConnection } from '@temporalio/worker';
import { TASK_QUEUES } from './shared/taskQueues';
import {
  createAuditActivities,
  createDisbursementActivities,
  createEnrichmentActivities,
  createNotificationActivities,
  createUnderwritingActivities,
} from './activities';
import type { AuditSink } from './activities/audit';
import type { CoreBanking } from './activities/disbursement';
import type { EnrichmentDeps } from './activities/enrichment';
import type { Notifier } from './activities/notifications';
import type { PolicyRegistry } from './products/policy';

export interface WorkerDeps {
  auditSink: AuditSink;
  notifier: Notifier;
  providers: EnrichmentDeps;
  policies: PolicyRegistry;
  coreBanking: CoreBanking;
}

export interface WorkerOptions {
  namespace?: string;
  enrichmentRatePerSecond?: number; // shared across all enrichment workers by the server
}

export function createWorkers(connection: NativeConnection, deps: WorkerDeps, opts: WorkerOptions = {}): Promise<Worker[]> {
  const { namespace } = opts;
  return Promise.all([
    // Orchestration + lightweight internal activities
    Worker.create({
      connection,
      namespace,
      taskQueue: TASK_QUEUES.workflow,
      workflowsPath: require.resolve('./workflows'),
      activities: {
        ...createAuditActivities(deps.auditSink),
        ...createNotificationActivities(deps.notifier),
      },
    }),

    // Third-party calls, rate limited. Production: one queue per provider, each with its own limit
    Worker.create({
      connection,
      namespace,
      taskQueue: TASK_QUEUES.enrichment,
      activities: createEnrichmentActivities(deps.providers),
      maxTaskQueueActivitiesPerSecond: opts.enrichmentRatePerSecond,
    }),

    // Product policies injected here
    Worker.create({
      connection,
      namespace,
      taskQueue: TASK_QUEUES.underwriting,
      activities: createUnderwritingActivities(deps.policies),
    }),

    // Money movement, isolated on its own queue
    Worker.create({
      connection,
      namespace,
      taskQueue: TASK_QUEUES.disbursement,
      activities: createDisbursementActivities(deps.coreBanking),
    }),
  ]);
}
