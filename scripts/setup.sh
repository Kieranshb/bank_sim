#!/usr/bin/env bash
# Register custom search attributes on the local dev server.
# Prereq (separate terminal): temporal server start-dev
set -euo pipefail

temporal operator search-attribute create --name ApplicationStatus --type Keyword
temporal operator search-attribute create --name LoanProduct --type Keyword
temporal operator search-attribute create --name Channel --type Keyword
# TODO: SlaDeadline (Datetime) for "past 36h and not funded" queries
