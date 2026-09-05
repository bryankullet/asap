#!/usr/bin/env bash
# Live verification against the hosted Supabase project — the two things the local shim cannot
# prove (work item 4 follow-up), plus the settings recorded in D-020 / D-021:
#   1. the on_auth_user_created trigger, by signing up a real user through GoTrue
#   2. the storage policies, by trying to read another brokerage's folder with a real session
#   3. event triggers / bypassrls / force-RLS facts, from the catalog
#   4. the asap_worker role can connect and sees nothing without context
#
# Needs: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (a pooler
# session-mode URL works), WORKER_DB_PASSWORD. Reads .env.local if present. Creates and then
# deletes throwaway users prefixed live-verify+<ts>@…; uploads and deletes one small object.
set -euo pipefail

if [[ -f .env.local ]]; then set -a; . ./.env.local; set +a; fi
: "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${DATABASE_URL:?}" "${WORKER_DB_PASSWORD:?}"

TS=$(date +%s)
EMAIL_A="live-verify+${TS}a@example.com"
EMAIL_B="live-verify+${TS}b@example.com"
PASS="Live-Verify-$(openssl rand -hex 8)"
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }
FAILED=0
ADMIN_H=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Content-Type: application/json")

echo "== 3. catalog facts"
psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<'SQL'
select 'event triggers: ' || coalesce(string_agg(evtname || ' (' || evtevent || ' → ' || evtfoid::regproc || ')', '; '), 'none') from pg_event_trigger;
select 'postgres bypassrls: ' || rolbypassrls from pg_roles where rolname = 'postgres';
select 'tables with FORCE rls: ' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity;
select 'public tables without rls: ' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
select 'authenticated grants on organizations: ' || coalesce(string_agg(privilege_type, ','), 'NONE') from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and table_name='organizations';
select 'anon grants on public tables: ' || count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public';
SQL

echo "== 1. auth trigger: create a user through GoTrue admin API, expect a public.users row"
UID_A=$(curl -sS "${SUPABASE_URL}/auth/v1/admin/users" "${ADMIN_H[@]}" \
  -d "{\"email\":\"${EMAIL_A}\",\"password\":\"${PASS}\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"Live Verify A\"}}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))')
[[ -n "$UID_A" ]] || { fail "could not create user A via GoTrue"; exit 1; }
ROW=$(psql "$DATABASE_URL" -At -c "select email || '|' || coalesce(full_name,'') from users where id = '${UID_A}'")
if [[ "$ROW" == "${EMAIL_A}|Live Verify A" ]]; then pass "on_auth_user_created produced users row: $ROW"; else fail "no users row for ${UID_A} (got '$ROW')"; fi

echo "== 1b. real sign-up through the public endpoint (confirmation email path)"
SIGNUP=$(curl -sS "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${SUPABASE_ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_B}\",\"password\":\"${PASS}\",\"data\":{\"full_name\":\"Live Verify B\"}}")
UID_B=$(python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("id") or d.get("user",{}).get("id",""))' <<<"$SIGNUP")
if [[ -n "$UID_B" ]]; then
  ROW=$(psql "$DATABASE_URL" -At -c "select email from users where id = '${UID_B}'")
  [[ "$ROW" == "$EMAIL_B" ]] && pass "public signup created users row (confirmation pending)" || fail "signup user has no users row"
else
  fail "public signup response: $(echo "$SIGNUP" | head -c 300)"
fi

echo "== 1c. password policy: a 9-character password is refused"
SHORT=$(curl -sS -o /dev/null -w "%{http_code}" "${SUPABASE_URL}/auth/v1/signup" -H "apikey: ${SUPABASE_ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"live-verify+${TS}c@example.com\",\"password\":\"Short-123\"}")
[[ "$SHORT" == "422" || "$SHORT" == "400" ]] && pass "short password rejected ($SHORT)" || fail "short password accepted? ($SHORT)"

echo "== 2. storage: user A in org X must not read org Y's folder"
ORG_X=$(psql "$DATABASE_URL" -At -c "select gen_random_uuid()")
ORG_Y=$(psql "$DATABASE_URL" -At -c "select gen_random_uuid()")
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 <<SQL
insert into organizations (id, name, country) values ('${ORG_X}', 'Live Verify X', 'KE'), ('${ORG_Y}', 'Live Verify Y', 'KE');
select app.seed_default_roles('${ORG_X}'); select app.seed_default_roles('${ORG_Y}');
insert into organization_memberships (organization_id, user_id, role_id, is_owner)
select '${ORG_X}', '${UID_A}', id, true from roles where organization_id = '${ORG_X}' and key = 'brokerage_admin';
SQL
# upload one object into each folder with the service role
for O in "$ORG_X" "$ORG_Y"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "${SUPABASE_URL}/storage/v1/object/insurance-documents/${O}/policies/p1/d1/note.txt" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Content-Type: text/plain" --data "hello ${O}")
  [[ "$code" == "200" ]] || fail "service upload to ${O} returned $code"
done
TOKEN_A=$(curl -sS "${SUPABASE_URL}/auth/v1/token?grant_type=password" -H "apikey: ${SUPABASE_ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL_A}\",\"password\":\"${PASS}\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("access_token",""))')
[[ -n "$TOKEN_A" ]] || fail "could not sign in as A"
own=$(curl -sS -o /dev/null -w "%{http_code}" "${SUPABASE_URL}/storage/v1/object/authenticated/insurance-documents/${ORG_X}/policies/p1/d1/note.txt" -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${TOKEN_A}")
other=$(curl -sS -o /dev/null -w "%{http_code}" "${SUPABASE_URL}/storage/v1/object/authenticated/insurance-documents/${ORG_Y}/policies/p1/d1/note.txt" -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${TOKEN_A}")
anon=$(curl -sS -o /dev/null -w "%{http_code}" "${SUPABASE_URL}/storage/v1/object/authenticated/insurance-documents/${ORG_X}/policies/p1/d1/note.txt" -H "apikey: ${SUPABASE_ANON_KEY}")
[[ "$own" == "200" ]] && pass "A reads own brokerage's file ($own)" || fail "A cannot read own file ($own)"
[[ "$other" == "400" || "$other" == "403" || "$other" == "404" ]] && pass "A denied on other brokerage's file ($other)" || fail "A READ ANOTHER BROKERAGE'S FILE ($other)"
[[ "$anon" == "400" || "$anon" == "401" || "$anon" == "403" || "$anon" == "404" ]] && pass "anon denied ($anon)" || fail "anon read a private file ($anon)"

echo "== 4. asap_worker connects; sees nothing without context"
WURL=$(python3 - "$DATABASE_URL" "$WORKER_DB_PASSWORD" <<'PY'
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1]); pw = urllib.parse.quote(sys.argv[2], safe="")
user = u.username or "postgres"
# Supavisor pooler usernames are "<role>.<project_ref>"; direct connections are plain "<role>".
newuser = ("asap_worker." + user.split(".",1)[1]) if "." in user else "asap_worker"
host = u.hostname + (f":{u.port}" if u.port else "")
print(urllib.parse.urlunsplit((u.scheme, f"{newuser}:{pw}@{host}", u.path, u.query, "")))
PY
)
if W=$(psql "$WURL" -At -v ON_ERROR_STOP=1 -c "select current_user || '|' || (select count(*) from organizations) || '|' || (select count(*) from users)" 2>&1); then
  [[ "$W" == asap_worker*"|0|0" ]] && pass "worker connected: $W" || fail "worker sees rows without context: $W"
else
  fail "worker connection failed: $W"
fi

echo "== cleanup"
for O in "$ORG_X" "$ORG_Y"; do
  curl -sS -o /dev/null -X DELETE "${SUPABASE_URL}/storage/v1/object/insurance-documents/${O}/policies/p1/d1/note.txt" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
done
psql "$DATABASE_URL" -q -c "delete from organizations where id in ('${ORG_X}','${ORG_Y}')"
for U in "$UID_A" "$UID_B"; do [[ -n "$U" ]] && curl -sS -o /dev/null -X DELETE "${SUPABASE_URL}/auth/v1/admin/users/${U}" "${ADMIN_H[@]}"; done
psql "$DATABASE_URL" -q -c "delete from auth.users where email like 'live-verify+${TS}%'" || true

[[ $FAILED -eq 0 ]] && echo "verify-live: ALL PASSED" || { echo "verify-live: FAILURES"; exit 1; }
