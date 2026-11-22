# Plan

How I approached the case study, in the order I worked. I used Claude as a pair throughout,
for scaffolding, explaining Temporal concepts I hadn't used before, drafting code and tests, and
reviewing decisions. I made the design calls and checked every piece by running it.

## 1. Read the brief and decide what to ask

- Requirements that drive the design: three channels, every application terminal, auditable
  decisions, clean escalation and resume, provider failures, product isolation, operator visibility.
- One genuine ambiguity: "escalated" is listed as terminal, but review should resume. I emailed
  the question, didn't hear back over the weekend, and designed for both readings: review is a
  pause (`IN_REVIEW`), escalation is the terminal hand-off on timeout.
- Kept to TypeScript (my strongest language) and the 2-hour spirit: one workflow that runs locally,
  mocks instead of real providers, documentation over infrastructure.

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

- 50 tests: policies, activities, workflows on a real dev server, provider failures.
- `scripts/demo.sh` walks through every path; the README covers design, trade-offs and next steps.
