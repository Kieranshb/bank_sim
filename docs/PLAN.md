# Plan

How I approached the case study, in the order I worked. I used Claude as a pair throughout,
for scaffolding, explaining Temporal concepts I hadn't used before, drafting code and tests, and
reviewing decisions. I made the design calls and checked every piece by running it.

## Time

About 2.5 to 3 hours of my own time, spread over a few sessions, against a suggested 2. Claude wrote
most of the code and documentation. My time went on directing it: shaping the architecture and
trade-offs, steering its first drafts (injecting the product policies rather than importing them,
moving hard-coded defaults into one config file), questioning choices before accepting them (where
types should live, whether to test every combination of channel, product and outcome), having the
finished repo reviewed as an interviewer would and fixing what that found, and running everything. I
went slightly past the timebox on purpose to get the failure paths and their tests right, since
those are where a lending workflow is judged.

## 1. Read the brief and decide what to ask

- Requirements that drive the design: three channels, every application terminal, auditable
  decisions, clean escalation and resume, provider failures, product isolation, operator visibility.
- One genuine ambiguity: "escalated" is listed as terminal, but review should resume. I emailed
  the question, didn't hear back over the weekend, and designed for both readings: review is a
  pause (`IN_REVIEW`), escalation is the terminal hand-off on timeout.
- Kept to TypeScript (my strongest language) and a small scope: one workflow that runs locally,
  mocks instead of real providers, documentation over infrastructure (no UI, no Docker).

## 2. Map the design onto Temporal

- Clients (portal, broker, aggregator, review, status) use a Temporal `Client`; the Temporal Service
  holds histories, task queues and visibility; workers poll one queue each.
- One workflow per application, ID `channel:externalId`, so Temporal is the dedup layer.
- Four task queues (workflow, enrichment, underwriting, disbursement) so each concern can scale,
  rate limit and be secured on its own.

## 3. Build from the edges in

1. Scaffold from `npx @temporalio/create` (hello-world), then lay out `activities/`, `products/`,
   `clients/`, `shared/`.
2. Activity factories with injected dependencies (Temporal's documented pattern), so mocks and real
   clients are interchangeable and tests can stub anything.
3. `config.ts` as the only reader of `process.env`; mocks take options through constructors.
4. Deterministic mocks driven by a scenario table: one applicant per path, failures by flag.
5. Product policies as versioned pure functions, with table-driven tests on every boundary.
6. Client adapters per channel, verified end to end in the Web UI before any workflow logic existed.

## 4. The workflow

- Lifecycle as a single state machine, with `setStatus()` mirroring each transition into a search
  attribute and `finish()` as the only exit.
- Retry policy per queue, sized against the 48-hour target.
- `Promise.allSettled` for enrichment so one provider failing doesn't discard the others.
- Signals plus `condition()` with timeouts for review and the documents wait.

## 5. Problems hit and how I resolved them

- **Sample data written before requirements**: the samples had no documents, so most applications
  would have stalled waiting for them. Fixed the data and added tests that check every sample has
  its required documents, so it can't drift again.
- **Time-skipping test server doesn't support custom search attributes**: switched workflow tests to
  the dev server and made timing a workflow argument, so tests use short timeouts.
- **Types placement**: kept domain types shared, dependency interfaces with the activity that needs
  them, and channel input shapes with their channel, rather than one types file.

## 6. Verify and document

- `scripts/demo.sh` walks through every path; the README covers design, trade-offs and next steps.

## 7. Review as an interviewer, then fix

I had the finished repo reviewed against the brief as if by an interview panel, then fixed what it
found rather than just documenting it:

- **A provider outage could end in a loan funded without a fraud check** (outage, then review, then
  approve). Now a reviewer can only retry the missing check or decline; approve isn't offered on
  incomplete data, and the workflow ignores it if sent.
- **Escalation was a dead end.** Now a review timeout alerts a supervisor and the application stays
  decidable; it only completes as `ESCALATED` when the supervisor window expires, and ops is alerted.
- **A provider rejecting our request (a 4xx) was treated as an outage** and sent to underwriting
  review. Now it's its own failure class, escalated straight to ops.
- **`finish()` wasn't truly the only exit:** an unknown product or an activity out of retries would
  have left a Failed workflow. Added validation and a top-level catch-all, and made sure deliberate
  cancellation still passes through.
- **Money was a float** in one adapter. Now it's integer cents end to end.
- **Audit writes could duplicate** on retry and didn't record decision inputs. Now each event has an
  idempotency key and underwriting records what it decided on.
- Code quality: an `enrichAll()` helper without casts, a shared `createWorkers()` for production and
  tests, documents kept in workflow state, `policyVersion` stamped in one place, and a replay test.

59 tests now cover policies, money, activities, every workflow path on a real dev server, provider
failures, an unexpected failure, and replay determinism.
