// The application lifecycle state machine. One execution per application.
//
// Workflow code must be deterministic: no I/O, no Math.random(), no process.env.
// Anything that touches the outside world is an activity; the workflow only decides what happens next.
//
// Every path ends in a terminal state: FUNDED, DECLINED or ESCALATED.
import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  log,
  proxyActivities,
  setHandler,
  upsertSearchAttributes,
  workflowInfo,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import type {
  createAuditActivities,
  createDisbursementActivities,
  createEnrichmentActivities,
  createNotificationActivities,
  createUnderwritingActivities,
} from './activities';
import { TASK_QUEUES } from './shared/taskQueues';
import { documentsUploadedSignal, getStatusQuery, submitDecisionSignal } from './shared/signals';
import { APPLICATION_STATUS, CHANNEL, LOAN_PRODUCT } from './shared/searchAttributes';
import type {
  ApplicationState,
  ApplicationStatus,
  AuditEvent,
  EnrichmentResult,
  LoanApplication,
  ReviewDecision,
} from './shared/types';

// ---- Timing -----------------------------------------------------------------
// Workflow code can't read config or the environment (determinism), so timing is a workflow
// argument with production defaults. Clients normally omit it; tests pass short values.

export interface WorkflowTiming {
  documentReminderInterval: Duration;
  maxDocumentReminders: number; // then the application is abandoned
  reviewTimeout: Duration; // then ESCALATED
}

export const DEFAULT_TIMING: WorkflowTiming = {
  documentReminderInterval: '24h',
  maxDocumentReminders: 3,
  reviewTimeout: '24h', // keeps referred files inside the 48h target
};

// ---- Activity proxies (one per task queue) --------------------------------
// Types come from the factories' return types; implementations are wired in worker.ts.

// Third-party calls: retry through rate limits and outages with backoff,
// but give up after 12h so the application can still be decided within 48h.
const enrich = proxyActivities<ReturnType<typeof createEnrichmentActivities>>({
  taskQueue: TASK_QUEUES.enrichment,
  startToCloseTimeout: '30s',
  scheduleToCloseTimeout: '12h',
  retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '5m' },
});

// Pure policy evaluation: if it fails repeatedly it's a bug, not an outage.
const uw = proxyActivities<ReturnType<typeof createUnderwritingActivities>>({
  taskQueue: TASK_QUEUES.underwriting,
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 5 },
});

// Money movement: safe to retry because disburseLoan is idempotent on the workflow ID.
const pay = proxyActivities<ReturnType<typeof createDisbursementActivities>>({
  taskQueue: TASK_QUEUES.disbursement,
  startToCloseTimeout: '1m',
  scheduleToCloseTimeout: '24h',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '10m' },
});

// Audit and notifications: retried until they succeed. No decision goes unrecorded.
const sys = proxyActivities<
  ReturnType<typeof createAuditActivities> & ReturnType<typeof createNotificationActivities>
>({
  taskQueue: TASK_QUEUES.workflow, // registered on the workflow worker in worker.ts
  startToCloseTimeout: '10s',
  retry: { maximumInterval: '1m' },
});

// ---- Workflow -------------------------------------------------------------

export async function loanApplicationWorkflow(
  app: LoanApplication,
  timingOverrides: Partial<WorkflowTiming> = {},
): Promise<ApplicationState> {
  const timing: WorkflowTiming = { ...DEFAULT_TIMING, ...timingOverrides };
  const { workflowId } = workflowInfo();
  const state: ApplicationState = { status: 'RECEIVED', history: [], missingDocuments: [] };
  let decision: ReviewDecision | undefined;
  let docsUploaded = false; // set by documentsUploadedSignal, reset by step 2 after each check

  // ---- handlers ----
  setHandler(getStatusQuery, () => state);

  setHandler(submitDecisionSignal, (d) => {
    // Signals can't be rejected, so ignore decisions that arrive at the wrong time
    if (state.status !== 'IN_REVIEW' || decision) {
      log.warn('Ignoring review decision', { workflowId, status: state.status });
      return;
    }
    decision = d;
  });

  setHandler(documentsUploadedSignal, (docs) => {
    // Merge uploads, ignoring types we already have. Step 2 re-checks what's still missing.
    const have = new Set(app.documents.map((d) => d.type));
    app.documents.push(...docs.filter((d) => !have.has(d.type)));
    docsUploaded = true;
  });

  // ---- helpers ----
  function setStatus(status: ApplicationStatus): void {
    state.status = status;
    // Workflow time is deterministic (it comes from history), so new Date() is safe here
    state.history.push({ status, at: new Date().toISOString() });
    upsertSearchAttributes([{ key: APPLICATION_STATUS, value: status }]);
  }

  async function audit(type: string, payload: unknown, extra: Partial<AuditEvent> = {}): Promise<void> {
    await sys.recordAuditEvent({ workflowId, type, actor: 'system', payload, ...extra });
  }

  // The only way out of the workflow: records why, tells the applicant, returns final state
  async function finish(status: 'FUNDED' | 'DECLINED' | 'ESCALATED', reason: string): Promise<ApplicationState> {
    setStatus(status);
    state.outcomeReason = reason;
    await audit(status, { reason });
    if (status !== 'ESCALATED') {
      await sys.notifyApplicant(app, status === 'FUNDED' ? 'Your loan has been funded.' : `Application declined: ${reason}`);
    }
    return state;
  }

  // Human in the loop: pause until a reviewer signals, or escalate on timeout
  async function review(reasons: string[]): Promise<'approve' | 'decline' | 'timeout'> {
    setStatus('IN_REVIEW');
    await sys.createReviewTask(workflowId, reasons);

    const decided = await condition(() => decision !== undefined, timing.reviewTimeout);
    if (!decided || !decision) return 'timeout';

    state.review = decision;
    await audit('REVIEW_DECISION', decision, { actor: decision.reviewer });
    return decision.decision;
  }

  async function disburse(): Promise<ApplicationState> {
    setStatus('APPROVED');
    setStatus('DISBURSING');
    try {
      const { reference } = await pay.disburseLoan(app, workflowId); // workflow ID = idempotency key
      state.disbursementRef = reference;
      await audit('DISBURSED', { reference, amount: app.amount });
      return finish('FUNDED', `Disbursed ${reference}`);
    } catch (err) {
      // Approved but core banking never confirmed within 24h: a human has to reconcile it
      return finish('ESCALATED', `Disbursement failed: ${describeFailure(err)}`);
    }
  }

  upsertSearchAttributes([
    { key: LOAN_PRODUCT, value: app.product },
    { key: CHANNEL, value: app.channel },
  ]);
  setStatus('RECEIVED');

  // 1. VALIDATING: cheap structural checks before spending money on providers
  setStatus('VALIDATING');
  const invalid = validate(app);
  if (invalid) return finish('DECLINED', `Invalid application: ${invalid}`);

  // 2. AWAITING_DOCUMENTS: loop until the product's required documents are in, or give up
  state.missingDocuments = await uw.missingDocuments(app);
  let reminders = 0;
  while (state.missingDocuments.length > 0) {
    setStatus('AWAITING_DOCUMENTS');
    await sys.requestDocuments(app, state.missingDocuments);

    const uploaded = await condition(() => docsUploaded, timing.documentReminderInterval);
    if (!uploaded && ++reminders >= timing.maxDocumentReminders) {
      return finish('DECLINED', `Abandoned: missing ${state.missingDocuments.join(', ')}`);
    }
    docsUploaded = false;
    state.missingDocuments = await uw.missingDocuments(app); // one upload may not cover everything
  }

  // 3. ENRICHING: all three providers in parallel.
  // allSettled, not all: one provider failing shouldn't throw away the others' results.
  setStatus('ENRICHING');
  const [credit, identity, fraud] = await Promise.allSettled([
    enrich.pullCredit(app),
    enrich.verifyIdentity(app),
    enrich.checkFraud(app),
  ]);

  // A definitive "no identity record" is an answer, not an outage: the policy will decline it
  const identityResult =
    identity.status === 'rejected' && failureType(identity.reason) === 'IdentityRejected'
      ? { status: 'fulfilled' as const, value: { verified: false } }
      : identity;

  const unavailable = (
    [
      ['credit', credit],
      ['identity', identityResult],
      ['fraud', fraud],
    ] as const
  )
    .filter(([, r]) => r.status === 'rejected')
    .map(([name, r]) => `${name}: ${describeFailure((r as PromiseRejectedResult).reason)}`);

  // 4. UNDERWRITING, or straight to a human if a provider stayed down past its retry window
  let outcome: 'approve' | 'decline' | 'refer';
  let reasons: string[];

  if (unavailable.length > 0) {
    state.unavailableProviders = unavailable;
    await audit('ENRICHMENT_INCOMPLETE', { unavailable });
    outcome = 'refer';
    reasons = unavailable.map((u) => `Provider unavailable (${u})`);
  } else {
    const enrichment: EnrichmentResult = {
      credit: valueOf(credit),
      identity: valueOf(identityResult),
      fraud: valueOf(fraud),
    };
    state.enrichment = enrichment;

    setStatus('UNDERWRITING');
    const result = await uw.underwrite(app, enrichment);
    state.underwriting = result;
    await audit('UNDERWRITING_DECISION', result, { policyVersion: result.policyVersion });
    outcome = result.result;
    reasons = result.reasons;
  }

  if (outcome === 'decline') return finish('DECLINED', reasons.join('; '));

  // 5. IN_REVIEW (only when referred)
  if (outcome === 'refer') {
    const reviewed = await review(reasons);
    if (reviewed === 'timeout') return finish('ESCALATED', `No review decision within ${timing.reviewTimeout}`);
    if (reviewed === 'decline') return finish('DECLINED', `Declined by ${decision!.reviewer}: ${decision!.reason}`);
  }

  // 6. APPROVED -> DISBURSING -> FUNDED
  return disburse();
}

// ---- Pure helpers (deterministic, no I/O) -----------------------------------

function validate(app: LoanApplication): string | undefined {
  if (!(app.amount > 0)) return 'amount must be positive';
  if (!app.applicant?.email) return 'applicant email is required';
  if (!app.applicant?.name) return 'applicant name is required';
  return undefined;
}

// The ApplicationFailure type thrown inside an activity, e.g. 'IdentityRejected'
function failureType(err: unknown): string | undefined {
  return err instanceof ActivityFailure && err.cause instanceof ApplicationFailure ? err.cause.type ?? undefined : undefined;
}

// Only called once every result is known to be fulfilled
function valueOf<T>(result: PromiseSettledResult<T>): T {
  return (result as PromiseFulfilledResult<T>).value;
}

function describeFailure(err: unknown): string {
  if (err instanceof ActivityFailure) return err.cause?.message ?? err.message;
  return err instanceof Error ? err.message : String(err);
}
