#!/usr/bin/env bash
# The connected placement lifecycle: the real API code, through supabase-js and PostgREST, against
# a disposable PostgreSQL built from the migration files (scripts/db-verify-local.sh first).
#
#   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/asap_verify POSTGREST_BIN=/path/to/postgrest \
#     bash scripts/test-connected.sh
#
# Browser-equivalent sessions reach the database as `authenticated` through PostgREST with a signed
# JWT, so RLS and every grant apply exactly as in production. No service-role key is used. The one
# stand-in is Supabase Auth's token lookup (`/auth/v1/user`), answered in the test from the same
# signed token. Never point this at a hosted database: it creates a login role and API key rows.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at a disposable database built by db-verify-local.sh}"
case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "test-connected: refusing a non-local DATABASE_URL" >&2; exit 2 ;;
esac

BIN="${POSTGREST_BIN:-$(command -v postgrest || true)}"
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "test-connected: set POSTGREST_BIN to a PostgREST 12 binary (github.com/PostgREST/postgrest/releases)" >&2
  exit 2
fi

PORT="${CONNECTED_PORT:-3399}"
SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
AUTH_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
WORK="$(mktemp -d)"
trap 'kill "${PGRST_PID:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

# The role PostgREST logs in as. It holds no privilege of its own; it can only become anon or
# authenticated, as Supabase's `authenticator` does.
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end \$\$;
alter role authenticator with login noinherit password '$AUTH_PASSWORD';
grant anon, authenticated to authenticator;
SQL

HOSTPART="$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?://[^@]*@##')"
cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgresql://authenticator:$AUTH_PASSWORD@$HOSTPART"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PORT
log-level = "warn"
CONF

"$BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
PGRST_PID=$!
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then break; fi
  sleep 0.2
done
curl -s -o /dev/null "http://127.0.0.1:$PORT/" || { cat "$WORK/postgrest.log" >&2; exit 1; }

CONNECTED_POSTGREST_URL="http://127.0.0.1:$PORT" \
CONNECTED_JWT_SECRET="$SECRET" \
CONNECTED_OWNER_URL="$DATABASE_URL" \
  pnpm --filter @asap/api exec vitest run test/connected
