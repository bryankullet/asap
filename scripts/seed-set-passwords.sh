#!/usr/bin/env bash
# LOCAL ONLY. Gives the seeded fixture users a known password so a developer can sign in with
# email + password instead of a magic link. Refuses to run unless APP_ENV is local.
# Usage: SEED_PASSWORD='at-least-twelve-chars' scripts/seed-set-passwords.sh
set -euo pipefail

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
fi

if [[ "${APP_ENV:-local}" != "local" ]]; then
  echo "seed-set-passwords: refusing to run outside APP_ENV=local (staging is synthetic-only but its users stay unrecoverable)" >&2
  exit 1
fi
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${SEED_PASSWORD:?SEED_PASSWORD is required}"
if [[ ${#SEED_PASSWORD} -lt 12 ]]; then
  echo "seed-set-passwords: SEED_PASSWORD must be at least 12 characters (D-005)" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v pw="$SEED_PASSWORD" -q <<'SQL'
update auth.users
set encrypted_password = extensions.crypt(:'pw', extensions.gen_salt('bf')),
    updated_at = now()
where email like '%@acme-brokers.test'
   or email like '%@beta-risk.test'
   or email like '%@consultant.test';
SQL
echo "seed-set-passwords: fixture users updated."
