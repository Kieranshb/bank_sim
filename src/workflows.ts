// The application lifecycle state machine. One execution per application.
//
// Workflow code must be deterministic: no I/O, no Math.random(), no process.env.
// Anything that touches the outside world is an activity; the workflow only decides what happens next.
//
// Every path ends in a terminal state (FUNDED, DECLINED or ESCALATED) through finish(), including
// unexpected failures. The one exception is an operator cancelling the workflow on purpose.
import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  isCancellation,
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
import {
  LOAN_PRODUCTS,
  type ApplicationState,
  type ApplicationStatus,
  type AuditEventType,
  type DecisionChoice,
  type EnrichmentResult,
  type LoanApplication,
  type ReviewDecision,
  type TerminalStatus,
} from './shared/types';

// ---- Timing -----------------------------------------------------------------
// Workflow code can't read config or the environment (determinism), so timing is a workflow
// argument with production defaults. Clients normally omit it; tests pass short values.

export interface WorkflowTiming {
  documentReminderInterval: Duration; // time between document requests
  maxDocumentRequests: number; // declined as abandoned when this many requests go unanswered
  reviewTimeout: Duration; // reviewer window, then escalated to a supervisor
  escalationTimeout: Duration; // supervisor window, then terminal ESCALATED
  providerRetryWindow: Duration; // how long enrichment keeps retrying an unavailable provider
}

export const DEFAULT_TIMING: WorkflowTiming = {
  documentReminderInterval: '24h', // 3 requests: declined 72h after the first (SLA clock paused)
  maxDocumentRequests: 3,
  reviewTimeout: '24h', // keeps a referred file inside the 48h target
  escalationTimeout: '72h', // past the target already; a supervisor owns it from here
  providerRetryWindow: '12h', // leaves room in the 48h target for review
};

// ---- Activity proxies (one per task queue) --------------------------------
// Types come from the factories' return types; implementations are wired in workers.ts.

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
  taskQueue: TASK_QUEUES.workflow, // registered on the workflow worker
  startToCloseTimeout: '10s',
  retry: { maximumInterval: '1m' },
});

type EnrichmentOutcome =
  | { kind: 'complete'; enrichment: EnrichmentResult }
  | { kind: 'unavailable'; partial: Partial<EnrichmentResult>; failures: string[] } // retries exhausted
  | { kind: 'rejected'; failures: string[] }; // a provider refused our request: ops, not underwriting

// ---- Workflow -------------------------------------------------------------

export async function loanApplicationWorkflow(
  app: LoanApplication,
  timingOverrides: Partial<WorkflowTiming> = {},
): Promise<ApplicationState> {
  const timing: WorkflowTiming = { ...DEFAULT_TIMING, ...timingOverrides };
  const { workflowId } = workflowInfo();
  const state: ApplicationState = {
    status: 'RECEIVED',
    history: [],
    documents: [...app.documents],
    missingDocuments: [],
  };
  let auditSequence = 0;
  let docsUploaded = false; // set by documentsUploadedSignal, reset after each re-check
  // The human decision being waited on: which choices are valid, and the one received
  let pending: { allowed: DecisionChoice[]; received?: ReviewDecision } | undefined;

  // Third-party calls: retry through rate limits and outages with backoff, but only within the
  // provider retry window, so the application can still be decided inside 48h.
  const enrich = proxyActivities<ReturnType<typeof createEnrichmentActivities>>({
    taskQueue: TASK_QUEUES.enrichment,
    startToCloseTimeout: '30s',
    scheduleToCloseTimeout: timing.providerRetryWindow,
    retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '5m' },
  });

  // ---- handlers ----
  setHandler(getStatusQuery, () => state);

  setHandler(submitDecisionSignal, (d) => {
    // Signals can't be rejected, so invalid decisions are logged and ignored.
    // The review client checks reviewOptions first and tells the reviewer.
    if (!pending || pending.received) {
      log.warn('Ignoring review decision: none pending', { workflowId, status: state.status });
      return;
    }
    if (!pending.allowed.includes(d.decision)) {
      log.warn('Ignoring review decision: not allowed now', { workflowId, decision: d.decision, allowed: pending.allowed });
      return;
    }
    pending.received = d;
  });

  setHandler(documentsUploadedSignal, (docs) => {
    // Merge into workflow state (not the input), ignoring types we already have
    const have = new Set(state.documents.map((d) => d.type));
    state.documents.push(...docs.filter((d) => !have.has(d.type)));
    docsUploaded = true;
  });

  // ---- helpers ----
  function setStatus(status: ApplicationStatus): void {
    state.status = status;
    // Workflow time is deterministic (it comes from history), so new Date() is safe here
    state.history.push({ status, at: new Date().toISOString() });
    upsertSearchAttributes([{ key: APPLICATION_STATUS, value: status }]);
  }

  async function audit(type: AuditEventType, payload: unknown, extra: { actor?: string; policyVersion?: string } = {}) {
    await sys.recordAuditEvent({
      eventId: `${workflowId}:${++auditSequence}`, // deterministic, so a retried write is a duplicate
      workflowId,
      type,
      actor: extra.actor ?? 'system',
      payload,
      policyVersion: extra.policyVersion,
    });
  }

  // The only way out of the workflow: records why, tells whoever needs to know, returns final state
  async function finish(status: TerminalStatus, reason: string): Promise<ApplicationState> {
    setStatus(status);
    state.outcomeReason = reason;
    await audit(status, { reason });
    if (status === 'ESCALATED') {
      await sys.alertOperations(workflowId, reason);
    } else {
      await sys.notifyApplicant(app, status === 'FUNDED' ? 'Your loan has been funded.' : `Application declined: ${reason}`);
    }
    return state;
  }

  // Human in the loop. Waits for a reviewer; if none decides in time, escalates to a supervisor
  // and keeps waiting (still decidable) until the supervisor window expires.
  // Returns the decision, or undefined if nobody decided at all.
  async function awaitDecision(reasons: string[], allowed: DecisionChoice[]): Promise<ReviewDecision | undefined> {
    const waiting: { allowed: DecisionChoice[]; received?: ReviewDecision } = { allowed };
    pending = waiting;
    state.reviewReasons = reasons;
    state.reviewOptions = allowed;
    setStatus('IN_REVIEW');
    await sys.createReviewTask(workflowId, reasons, allowed);

    const decided = () => waiting.received !== undefined;
    if (!(await condition(decided, timing.reviewTimeout))) {
      setStatus('ESCALATED');
      await audit('ESCALATED_TO_SUPERVISOR', { reasons, reviewTimeout: timing.reviewTimeout });
      await sys.escalateToSupervisor(workflowId, reasons, allowed);
      await condition(decided, timing.escalationTimeout);
    }

    pending = undefined;
    state.reviewOptions = undefined;
    const decision = waiting.received;
    if (decision) {
      state.review = decision;
      await audit('REVIEW_DECISION', decision, { actor: decision.reviewer });
    }
    return decision;
  }

  // Calls every provider we don't have an answer from yet, in parallel.
  // allSettled, not all: one provider failing must not throw away the others' results.
  async function enrichAll(have: Partial<EnrichmentResult>): Promise<EnrichmentOutcome> {
    const [credit, identity, fraud] = await Promise.allSettled([
      have.credit ?? enrich.pullCredit(app),
      have.identity ?? enrich.verifyIdentity(app),
      have.fraud ?? enrich.checkFraud(app),
    ]);

    const partial: Partial<EnrichmentResult> = { ...have };
    const unavailable: string[] = [];
    const rejected: string[] = [];
    const fail = (provider: string, err: unknown) => {
      if (isCancellation(err)) throw err; // cancellation is not a provider failure
      const line = `${provider}: ${describeFailure(err)}`;
      (failureType(err)?.endsWith('Rejected') ? rejected : unavailable).push(line);
    };

    if (credit.status === 'fulfilled') partial.credit = credit.value;
    else fail('credit', credit.reason);

    if (identity.status === 'fulfilled') partial.identity = identity.value;
    else if (failureType(identity.reason) === 'IdentityNotFound') partial.identity = { verified: false }; // an answer
    else fail('identity', identity.reason);

    if (fraud.status === 'fulfilled') partial.fraud = fraud.value;
    else fail('fraud', fraud.reason);

    if (rejected.length > 0) return { kind: 'rejected', failures: rejected };
    if (partial.credit && partial.identity && partial.fraud) {
      return { kind: 'complete', enrichment: { credit: partial.credit, identity: partial.identity, fraud: partial.fraud } };
    }
    return { kind: 'unavailable', partial, failures: unavailable };
  }

  async function disburse(): Promise<ApplicationState> {
    setStatus('DISBURSING');
    try {
      const { reference } = await pay.disburseLoan(app, workflowId); // workflow ID = idempotency key
      state.disbursementRef = reference;
      await audit('DISBURSED', { reference, amountCents: app.amountCents });
      return finish('FUNDED', `Disbursed ${reference}`);
    } catch (err) {
      if (isCancellation(err)) throw err;
      // Approved but core banking never confirmed within 24h: a human has to reconcile it
      return finish('ESCALATED', `Disbursement not confirmed, needs reconciliation: ${describeFailure(err)}`);
    }
  }

  // ---- the lifecycle ----
  async function run(): Promise<ApplicationState> {
    upsertSearchAttributes([
      { key: LOAN_PRODUCT, value: app.product },
      { key: CHANNEL, value: app.channel },
    ]);
    setStatus('RECEIVED');

    // 1. VALIDATING: structural checks before spending money on providers
    setStatus('VALIDATING');
    const invalid = validate(app);
    if (invalid) return finish('DECLINED', `Invalid application: ${invalid}`);

    // 2. AWAITING_DOCUMENTS: request until the product's required documents are in, or give up
    const documentTypes = () => state.documents.map((d) => d.type);
    state.missingDocuments = await uw.missingDocuments(app.product, documentTypes());
    let unanswered = 0;
    while (state.missingDocuments.length > 0) {
      setStatus('AWAITING_DOCUMENTS');
      await sys.requestDocuments(app, state.missingDocuments);

      const uploaded = await condition(() => docsUploaded, timing.documentReminderInterval);
      if (!uploaded && ++unanswered >= timing.maxDocumentRequests) {
        return finish('DECLINED', `Abandoned: missing ${state.missingDocuments.join(', ')} after ${unanswered} requests`);
      }
      docsUploaded = false;
      state.missingDocuments = await uw.missingDocuments(app.product, documentTypes()); // one upload may not cover all
    }

    // 3. ENRICHING. If a provider stays unavailable past its retry window, a human chooses to
    // retry or decline. Never approve: there's no automated decision on incomplete data.
    let have: Partial<EnrichmentResult> = {};
    let enrichment: EnrichmentResult | undefined;
    while (!enrichment) {
      setStatus('ENRICHING');
      const outcome = await enrichAll(have);

      if (outcome.kind === 'complete') {
        enrichment = outcome.enrichment;
        state.unavailableProviders = undefined;
      } else if (outcome.kind === 'rejected') {
        await audit('PROVIDER_REJECTED', { failures: outcome.failures });
        return finish('ESCALATED', `Provider rejected our request: ${outcome.failures.join('; ')}`);
      } else {
        have = outcome.partial; // a retry only re-runs the providers that failed
        state.unavailableProviders = outcome.failures;
        await audit('ENRICHMENT_INCOMPLETE', { failures: outcome.failures, received: Object.keys(outcome.partial) });

        const d = await awaitDecision(outcome.failures.map((f) => `Provider unavailable (${f})`), ['retry', 'decline']);
        if (!d) return finish('ESCALATED', 'No decision on an application with incomplete provider data');
        if (d.decision === 'decline') return finish('DECLINED', `Declined by ${d.reviewer}: ${d.reason}`);
      }
    }
    state.enrichment = enrichment;

    // 4. UNDERWRITING: audited with the inputs the decision was based on, not just its reasons
    setStatus('UNDERWRITING');
    const result = await uw.underwrite(app, enrichment);
    state.underwriting = result;
    await audit(
      'UNDERWRITING_DECISION',
      { outcome: result, inputs: { product: app.product, amountCents: app.amountCents, ...enrichment } },
      { policyVersion: result.policyVersion },
    );
    if (result.result === 'decline') return finish('DECLINED', result.reasons.join('; '));

    // 5. IN_REVIEW (only when referred)
    if (result.result === 'refer') {
      const d = await awaitDecision(result.reasons, ['approve', 'decline']);
      if (!d) return finish('ESCALATED', 'No review decision within the reviewer and supervisor windows');
      if (d.decision === 'decline') return finish('DECLINED', `Declined by ${d.reviewer}: ${d.reason}`);
    }

    // 6. Approved (by policy or reviewer), recorded as an event rather than a status, then DISBURSING -> FUNDED
    await audit('APPROVED', { by: state.review?.reviewer ?? `policy ${result.policyVersion}` });
    return disburse();
  }

  try {
    return await run();
  } catch (err) {
    if (isCancellation(err)) throw err; // an operator cancelled on purpose: Temporal records it as Cancelled
    // Anything unexpected (an activity out of retries, a bug) ends ESCALATED, never as a Failed workflow
    return finish('ESCALATED', `Unexpected failure: ${describeFailure(err)}`);
  }
}

// ---- Pure helpers (deterministic, no I/O) -----------------------------------

// Structural checks on the input shape only. Business rules (caps, thresholds) live in the
// policies, which run as activities so they can change without affecting replay.
function validate(app: LoanApplication): string | undefined {
  if (!(LOAN_PRODUCTS as readonly string[]).includes(app.product)) return `unknown product "${app.product}"`;
  if (!Number.isInteger(app.amountCents) || app.amountCents <= 0) return 'amount must be a positive whole number of cents';
  if (!app.applicant?.email) return 'applicant email is required';
  if (!app.applicant?.name) return 'applicant name is required';
  return undefined;
}

// The ApplicationFailure type thrown inside an activity, e.g. 'IdentityNotFound', 'FraudRejected'
function failureType(err: unknown): string | undefined {
  return err instanceof ActivityFailure && err.cause instanceof ApplicationFailure ? (err.cause.type ?? undefined) : undefined;
}

function describeFailure(err: unknown): string {
  if (err instanceof ActivityFailure) return err.cause?.message ?? err.message;
  return err instanceof Error ? err.message : String(err);
}
