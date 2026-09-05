#!/usr/bin/env bash
# pgTAP isolation suite (work item 5). Runs every test in supabase/tests against DATABASE_URL.
# Work items 1–3 ship the runner and the schema; the isolation tests themselves are work item 5.
set -euo pipefail

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
fi
: "${DATABASE_URL:?DATABASE_URL is required}"

shopt -s nullglob
TESTS=(supabase/tests/*.sql)
if [[ ${#TESTS[@]} -eq 0 ]]; then
  echo "test-rls: no tests in supabase/tests yet (work item 5)"; exit 0
fi

if command -v pg_prove >/dev/null 2>&1; then
  pg_prove -d "$DATABASE_URL" --ext .sql --verbose "${TESTS[@]}"
else
  # Fallback without pg_prove: run each file, fail on any "not ok".
  status=0
  for t in "${TESTS[@]}"; do
    echo "== $t"
    out="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -f "$t")" || status=1
    echo "$out"
    if grep -q '^not ok' <<<"$out"; then status=1; fi
  done
  exit $status
fi
