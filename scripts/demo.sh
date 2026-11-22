#!/usr/bin/env bash
# End-to-end demo. Prereqs: dev server running, setup.sh run, `npm run worker` in another terminal.
set -euo pipefail

# 1. Happy path: portal application auto-approves and funds
# TODO: npm run portal

# 2. Duplicate: re-send the same broker email, second start is rejected
# TODO: npm run broker && npm run broker

# 3. Human in the loop: application is referred, pauses in IN_REVIEW
# TODO: npm run aggregator -- samples/aggregator-batch.json
# TODO: npm run status -- --query 'ApplicationStatus="IN_REVIEW"'
# TODO: npm run review -- aggregator:rec-002 approve kieran "Manual DTI check ok"

# 4. Watch it resume and fund in the Web UI: http://localhost:8233
