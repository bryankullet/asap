#!/usr/bin/env bash
# Prepares a disposable Supabase Postgres 17.6 (the hosted build) at migration 0078 for the release
# rehearsal (D-170): the auth/storage service tables, migrations 0001–0078 applied as `postgres`
# (not a superuser, as on hosted), then the seed fixture. Usage:
#   scripts/release/rehearse-supabase17.sh <container-name> <host-port>
# Prints the admin and postgres connection URLs. Never point it at a hosted database: it only
# talks to the container it starts on 127.0.0.1.
set -euo pipefail
NAME="$1"; PORT="$2"; IMAGE="${SUPABASE_PG_IMAGE:-supabase/postgres:17.6.1.166}"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p "127.0.0.1:$PORT:5432" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 2; done
sleep 3
ADMIN="postgresql://supabase_admin:postgres@127.0.0.1:$PORT/postgres"
OWNER="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres"
psql "$ADMIN" -X -q -v ON_ERROR_STOP=1 -f scripts/release/supabase17-services.sql
for f in $(ls supabase/migrations/ | sort | awk -v stop="${STOP_BEFORE:-20261022}" '$0 < stop'); do
  psql "$OWNER" -X -q -1 -v ON_ERROR_STOP=1 -f "supabase/migrations/$f" >/dev/null || { echo "rehearse: $f failed" >&2; exit 1; }
done
psql "$ADMIN" -X -q -v ON_ERROR_STOP=1 -f supabase/seed.sql >/dev/null
echo "ADMIN=$ADMIN"
echo "OWNER=$OWNER"
