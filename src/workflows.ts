// The application lifecycle state machine. One execution per application.
// Workflow code must be deterministic: no I/O, no Date.now(), no Math.random().
// Anything that touches the outside world is an activity.
import { proxyActivities, setHandler, condition, upsertSearchAttributes } from '@temporalio/workflow';
import type {
  createAuditActivities,
  createDisbursementActivities,
  createEnrichmentActivities,
  createNotificationActivities,
  createUnderwritingActivities,
} from './activities';
import { TASK_QUEUES } from './shared/taskQueues';
import { submitDecisionSignal, documentsUploadedSignal, getStatusQuery } from './shared/signals';
import type { ApplicationState, ApplicationStatus, LoanApplication, ReviewDecision } from './shared/types';

// ---- Activity proxies (one per task queue) --------------------------------
// Types come from the factories' return types; implementations are wired in worker.ts.

const enrich = proxyActivities<ReturnType<typeof createEnrichmentActivities>>({
  taskQueue: TASK_QUEUES.enrichment,
  startToCloseTimeout: '30s',
  // TODO: retry policy (backoff, maximumInterval, nonRetryableErrorTypes)
});

const uw = proxyActivities<ReturnType<typeof createUnderwritingActivities>>({
  taskQueue: TASK_QUEUES.underwriting,
  startToCloseTimeout: '30s',
  // TODO: retry policy
});

const pay = proxyActivities<ReturnType<typeof createDisbursementActivities>>({
  taskQueue: TASK_QUEUES.disbursement,
  startToCloseTimeout: '1m',
  // TODO: retry policy
});

const sys = proxyActivities<
  ReturnType<typeof createAuditActivities> & ReturnType<typeof createNotificationActivities>
>({
  taskQueue: TASK_QUEUES.workflow, // registered on the workflow worker in worker.ts
  startToCloseTimeout: '10s',
});

// ---- Workflow -------------------------------------------------------------

export async function loanApplicationWorkflow(app: LoanApplication): Promise<ApplicationState> {
  const state: ApplicationState = { status: 'RECEIVED' };
  let decision: ReviewDecision | undefined;
  let docsUploaded = false; // set by documentsUploadedSignal, reset by step 2 after each check

  // ---- handlers ----
  setHandler(getStatusQuery, () => state);
  setHandler(submitDecisionSignal, (d) => {
    // TODO: only accept when status === 'IN_REVIEW'
    decision = d;
  });
  setHandler(documentsUploadedSignal, (docs) => {
    // Merge uploads, ignoring types we already have. Step 2 re-checks what's still missing.
    const have = new Set(app.documents.map((d) => d.type));
    app.documents.push(...docs.filter((d) => !have.has(d.type)));
    docsUploaded = true;
  });

  // TODO: helper to set status + upsert ApplicationStatus search attribute
  // const setStatus = (s: ApplicationStatus) => { ... };

  // 1. VALIDATING
  // TODO: validate required fields for app.product

  // 2. AWAITING_DOCUMENTS
  // TODO: compute missing docs from product policy
  // TODO: notify applicant, wait with condition(() => docsComplete, timeout)
  // TODO: reminder timers; on final timeout -> DECLINED (abandoned)

  // 3. ENRICHING
  // TODO: run pullCredit / verifyIdentity / checkFraud in parallel (Promise.all)

  // 4. UNDERWRITING
  // TODO: uw.underwrite(app, enrichment) -> approve | decline | refer
  // TODO: audit the decision with policyVersion

  // 5. IN_REVIEW (only on 'refer')
  // TODO: create review task, wait with condition(() => decision !== undefined, reviewTimeout)
  // TODO: on timeout -> ESCALATED (terminal)
  // TODO: audit the reviewer decision

  // 6. APPROVED -> DISBURSING -> FUNDED
  // TODO: pay.disburseLoan(app, idempotencyKey = workflowId)
  // TODO: audit + notify

  // TERMINAL: every path must end in FUNDED, DECLINED or ESCALATED
  return state;
}
