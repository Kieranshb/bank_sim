// Shared by every intake channel and operator script.
// Workflow ID = channel:externalId, so Temporal itself rejects duplicate submissions.
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import type { loanApplicationWorkflow } from './workflows';
import { TASK_QUEUES } from './shared/taskQueues';
import type { LoanApplication } from './shared/types';

export async function getClient(): Promise<Client> {
  // Reads TEMPORAL_ADDRESS etc. from env / config profile; defaults to localhost:7233
  const config = loadClientConnectConfig();
  const connection = await Connection.connect(config.connectionOptions);
  return new Client({ connection });
}

export function workflowIdFor(app: Pick<LoanApplication, 'channel' | 'externalId'>): string {
  return `${app.channel}:${app.externalId}`;
}

export async function startApplication(
  client: Client,
  app: LoanApplication,
): Promise<{ workflowId: string; duplicate: boolean }> {
  const workflowId = workflowIdFor(app);
  try {
    await client.workflow.start<typeof loanApplicationWorkflow>('loanApplicationWorkflow', {
      taskQueue: TASK_QUEUES.workflow,
      workflowId,
      // Reject the same ID even after the first workflow has finished
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [app],
    });
    return { workflowId, duplicate: false };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      return { workflowId, duplicate: true };
    }
    throw err;
  }
}

// Small helper so each channel script has the same entry point shape
export function runMain(main: () => Promise<void>): void {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
