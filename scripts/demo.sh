#!/usr/bin/env bash
# End-to-end demo, one scenario per step. Press enter to advance.
#
# Prereqs (each in its own terminal):
#   temporal server start-dev      Web UI: http://localhost:8233
#   ./scripts/setup.sh
#   npm run worker
#
# Workflow IDs are deterministic (channel:externalId), so on a second run every start is
# rejected as a duplicate. Restart `temporal server start-dev` (in-memory) to run it again.
set -euo pipefail

BROKER_ID="broker:ref-88412@northpoint-brokers.example"
PRIYA_ID="aggregator:loanhub-rec-002"
TAYLOR_ID="aggregator:loanhub-rec-005"

step() { echo; echo "=== $1"; read -r -p "    (enter to run) " _; }
settle() { sleep "${1:-2}"; }

step "1. Portal: Jane, personal loan, good credit -> auto-approved and FUNDED"
npm run --silent portal
settle
npm run --silent status -- portal:app-123

step "2. Broker: Sam, auto loan, missing bill of sale -> waits in AWAITING_DOCUMENTS"
npm run --silent broker
settle
npm run --silent status -- "$BROKER_ID"

step "3. Same broker email again -> rejected as a duplicate by workflow ID"
npm run --silent broker

step "4. Sam's broker uploads the bill of sale -> workflow resumes and funds"
npm run --silent upload-docs -- "$BROKER_ID" vehicle_bill_of_sale
settle
npm run --silent status -- "$BROKER_ID"

step "5. Aggregator batch: 5 applications covering approve, refer, decline, product cap, fraud"
npm run --silent aggregator
settle 3

step "6. Operator view: what's waiting on a human?"
npm run --silent status -- --query 'ApplicationStatus="IN_REVIEW"'

step "7. Reviewer approves Priya (borderline credit) -> resumes and funds"
npm run --silent review -- "$PRIYA_ID" approve kieran "Income verified, DTI ok"
settle
npm run --silent status -- "$PRIYA_ID"

step "8. Reviewer declines Taylor (good credit, high fraud risk)"
npm run --silent review -- "$TAYLOR_ID" decline kieran "Fraud signal confirmed"

step "9. Final state of every application"
npm run --silent status -- --query 'ExecutionStatus="Completed"'

echo
echo "Decisions are in ./audit.log (one JSON line each). Full histories: http://localhost:8233"
echo "Failure demos: restart the worker with FRAUD_OUTAGE=1 or IDENTITY_NOT_FOUND=<email>, see samples/README.md"
