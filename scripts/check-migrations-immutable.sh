#!/usr/bin/env bash
# Migrations are append-only (work item 3). Fails if any migration file that exists on the base
# branch was modified, renamed or deleted on this branch. New files are fine.
#
# Usage: scripts/check-migrations-immutable.sh [base-ref]   (default: origin/main)
set -euo pipefail

BASE_REF="${1:-${BASE_REF:-origin/main}}"
DIR="supabase/migrations"

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "check-migrations-immutable: base ref '$BASE_REF' not found; fetching" >&2
  git fetch --quiet origin "${BASE_REF#origin/}" || {
    echo "check-migrations-immutable: cannot resolve $BASE_REF" >&2
    exit 2
  }
fi

MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)"
CHANGED="$(git diff --name-status "$MERGE_BASE" HEAD -- "$DIR" | grep -Ev '^A\s' || true)"

if [[ -n "$CHANGED" ]]; then
  echo "check-migrations-immutable: committed migration files were modified. Write a new migration instead." >&2
  echo "$CHANGED" >&2
  exit 1
fi

# Also fail on duplicate numeric prefixes, which the CLI would apply in undefined order.
DUPES="$(ls "$DIR" | sed -E 's/^([0-9]+)_.*/\1/' | sort | uniq -d || true)"
if [[ -n "$DUPES" ]]; then
  echo "check-migrations-immutable: duplicate migration numbers: $DUPES" >&2
  exit 1
fi

echo "check-migrations-immutable: ok (base $MERGE_BASE)"
