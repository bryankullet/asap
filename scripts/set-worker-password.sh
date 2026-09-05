#!/usr/bin/env bash
# Sets the asap_worker password for one environment. Run after migrations, once per environment,
# and again on rotation (docs/SECRETS.md). Reads DATABASE_URL (superuser) and WORKER_DB_PASSWORD
# from the environment or .env.local; never from a file in git. See docs/DECISIONS.md D-006.
set -euo pipefail

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD is required}"

if [[ "$WORKER_DB_PASSWORD" == "CHANGE_ME" || ${#WORKER_DB_PASSWORD} -lt 16 ]]; then
  echo "set-worker-password: WORKER_DB_PASSWORD must be at least 16 characters and not the placeholder" >&2
  exit 1
fi

# The password is passed as a psql variable, quoted by psql, so it never appears in a SQL string
# we build ourselves and never appears in shell history via argv.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$WORKER_DB_PASSWORD" -q <<'SQL'
alter role asap_worker with login password :'pw' nobypassrls noinherit;
SQL

echo "set-worker-password: asap_worker can now log in. Update WORKER_DATABASE_URL to match."
