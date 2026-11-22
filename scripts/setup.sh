#!/usr/bin/env bash
# Register the custom search attributes the workflow sets. Safe to re-run.
# Prereq (separate terminal): temporal server start-dev
set -uo pipefail

for attr in ApplicationStatus LoanProduct Channel; do
  if temporal operator search-attribute create --name "$attr" --type Keyword >/dev/null 2>&1; then
    echo "registered $attr"
  else
    echo "$attr already registered (or server not running)"
  fi
done
