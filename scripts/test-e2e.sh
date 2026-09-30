#!/usr/bin/env bash
# Browser end-to-end: the approved interface, in a real browser, against the real API, supabase-js,
# PostgREST and a disposable PostgreSQL built from every migration.
#
#   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/asap_verify POSTGREST_BIN=/path/to/postgrest \
#     bash scripts/test-e2e.sh
#
# The one stand-in is the session (a signed token handed to the page instead of Supabase Auth's
# sign-in). Never point this at a hosted database: it creates a login role and API key rows.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point at a disposable database built by db-verify-local.sh}"
case "$DATABASE_URL" in *127.0.0.1*|*localhost*) ;; *) echo "test-e2e: refusing a non-local DATABASE_URL" >&2; exit 2 ;; esac
BIN="${POSTGREST_BIN:-$(command -v postgrest || true)}"
[ -n "$BIN" ] && [ -x "$BIN" ] || { echo "test-e2e: set POSTGREST_BIN to a PostgREST 12 binary" >&2; exit 2; }

REST_PORT="${CONNECTED_PORT:-3399}"; API_PORT="${CONNECTED_API_PORT:-3398}"; WEB_PORT="${E2E_WEB_PORT:-5199}"
SECRET="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
AUTH_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
WORK="$(mktemp -d)"
# Each server runs in its own process group, so the whole group (npx and the node it starts) stops.
cleanup() { for p in ${PIDS:-}; do kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT

psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
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
server-port = $REST_PORT
log-level = "warn"
CONF
setsid "$BIN" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 & PIDS="$!"

export CONNECTED_POSTGREST_URL="http://127.0.0.1:$REST_PORT" CONNECTED_JWT_SECRET="$SECRET" CONNECTED_OWNER_URL="$DATABASE_URL"
export CONNECTED_API_PORT="$API_PORT" E2E_WEB_ORIGIN="http://127.0.0.1:$WEB_PORT"
for _ in $(seq 1 50); do curl -s -o /dev/null "$CONNECTED_POSTGREST_URL/" && break; sleep 0.2; done
setsid bash -c "cd apps/api && exec npx tsx test/connected/serve.ts" > "$WORK/api.log" 2>&1 & PIDS="$PIDS $!"
VITE_PUBLIC_SUPABASE_URL="http://127.0.0.1:9" VITE_PUBLIC_SUPABASE_ANON_KEY="e2e-anon" \
  VITE_PUBLIC_API_BASE_URL="http://127.0.0.1:$API_PORT" VITE_PUBLIC_APP_ENV="local" \
  setsid bash -c "cd apps/web && exec npx vite --host 127.0.0.1 --port $WEB_PORT --strictPort" > "$WORK/web.log" 2>&1 & PIDS="$PIDS $!"
for _ in $(seq 1 100); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/health" && curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/e2e/live.html" && break; sleep 0.3; done
curl -s -o /dev/null "http://127.0.0.1:$API_PORT/health" || { cat "$WORK/api.log" >&2; exit 1; }

E2E_URL="http://127.0.0.1:$WEB_PORT/e2e/live.html" node apps/web/e2e/journey.e2e.mjs
