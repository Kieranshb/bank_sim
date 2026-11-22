# Loan disbursement on Temporal

TODO: one-paragraph summary of the problem and the approach.

## Assumptions

- TODO: "Escalated" is terminal. Review is a paused state (`IN_REVIEW`) that resumes on a decision; if no decision arrives before the timeout, the application moves to `ESCALATED` (handed off outside the automated flow).
- TODO: "Funded" means a confirmed disbursement from core banking (mocked). Reconciliation of failed or returned payouts is out of scope.
- TODO: Third-party providers, core banking and the audit store are mocked.

## Architecture

TODO: Mermaid diagram (clients → Temporal Service → task queues → workers → external systems).

## Application lifecycle

TODO: Mermaid `stateDiagram-v2` of the statuses in `src/shared/types.ts`.

## Workflow design

TODO: one workflow per application, workflow ID = `channel:externalId`, state exposed via query + search attributes.

## Activity design

TODO: table of activities, task queue, timeout, retry policy, idempotency.

## Human in the loop

TODO: sequence diagram: refer → review task → signal → resume. Timeouts and escalation.

## Failure handling

TODO: retries and backoff, non-retryable errors, per-provider rate limits, partial failure, provider outages.

## Product isolation

TODO: `ProductPolicy` interface, versioning, workflow versioning when rules change.

## Observability and audit

TODO: search attribute queries, metrics and alerts, append-only audit log vs Temporal history retention.

## Trade-offs

TODO

## What I'd do next

TODO

## Running locally

```bash
brew install temporal
temporal server start-dev        # terminal 1 (Web UI: http://localhost:8233)
npm install
./scripts/setup.sh
npm run worker.watch             # terminal 2
./scripts/demo.sh                # terminal 3
npm test                         # workflow tests (time-skipping test server)
```
