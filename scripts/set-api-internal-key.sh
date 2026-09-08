#!/usr/bin/env bash
# Registers the API's internal key with the database (migration 0023, app.api_keys). The engine
# functions accept writes only from requests carrying this key in `x-asap-api-key`; the web app
# never holds it. Only the sha256 of the key is stored. Run once per environment and on rotation.
# Reads DATABASE_URL (superuser) and API_INTERNAL_KEY from the environment or .env.local.
set -euo pipefail

if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${API_INTERNAL_KEY:?API_INTERNAL_KEY is required}"

if [[ ${#API_INTERNAL_KEY} -lt 32 ]]; then
  echo "set-api-internal-key: API_INTERNAL_KEY must be at least 32 characters" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v k="$API_INTERNAL_KEY" -q <<'SQL'
insert into app.api_keys (key_hash, label)
values (encode(extensions.digest(:'k', 'sha256'), 'hex'), 'api')
on conflict (key_hash) do update set revoked_at = null;
SQL

echo "set-api-internal-key: registered. The API must send this value as x-asap-api-key."
