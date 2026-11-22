// Single source of truth for task queue names.
// Used by proxyActivities in the workflow and by Worker.create in worker.ts.

export const TASK_QUEUES = {
  workflow: 'loan-workflow',
  enrichment: 'enrichment',
  underwriting: 'underwriting',
  disbursement: 'disbursement',
} as const;
