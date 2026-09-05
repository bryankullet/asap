#!/usr/bin/env bash
# Applies every migration and the seed to a plain PostgreSQL 16 database, without Docker.
#
# `supabase db reset` is the canonical path (CI, and any laptop with Docker). This script exists
# for environments that cannot run Docker: it creates a throwaway database, installs a minimal
# shim of the Supabase `auth` and `storage` schemas (scripts/local-shim.sql), applies
# supabase/migrations in order, applies supabase/seed.sql, then runs the Drizzle drift check.
#
# Requires: psql, a superuser connection in PG_SUPER_URL (default: local postgres/postgres),
# and the pgcrypto, pg_trgm, vector and pgtap extensions installed on the server.
#
# Usage: scripts/db-verify-local.sh            → database asap_verify on the local server
#        PG_SUPER_URL=postgresql://... scripts/db-verify-local.sh
set -euo pipefail

PG_SUPER_URL="${PG_SUPER_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}"
DB_NAME="${DB_NAME:-asap_verify}"
TARGET_URL="${PG_SUPER_URL%/*}/${DB_NAME}"

echo "db-verify-local: recreating ${DB_NAME}"
psql "$PG_SUPER_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists ${DB_NAME} with (force);"
psql "$PG_SUPER_URL" -v ON_ERROR_STOP=1 -q -c "create database ${DB_NAME};"

echo "db-verify-local: installing auth/storage shim"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f scripts/local-shim.sql

for f in $(ls supabase/migrations/*.sql | sort); do
  echo "db-verify-local: applying $(basename "$f")"
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "db-verify-local: applying seed.sql"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql

echo "db-verify-local: sanity counts"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'organizations', count(*) from organizations
union all select 'users', count(*) from users
union all select 'roles', count(*) from roles
union all select 'permissions', count(*) from permissions
union all select 'role_permissions', count(*) from role_permissions
union all select 'memberships', count(*) from organization_memberships
union all select 'teams', count(*) from teams
union all select 'invitations', count(*) from invitations
union all select 'audit_log', count(*) from audit_log
union all select 'events', count(*) from events;
SQL

echo "db-verify-local: drift check"
DATABASE_URL="$TARGET_URL" pnpm --filter @asap/db run drift

echo "db-verify-local: ok → DATABASE_URL=$TARGET_URL"
