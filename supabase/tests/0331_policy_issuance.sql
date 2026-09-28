-- pgTAP: policy issuance (0058) — tenancy, the API-only gate, evidence immutability, and the
-- apply function's security. The behaviour end to end is proven by the connected test
-- apps/api/test/connected/issuance-lifecycle.test.ts, against the same migrations.
begin;
select plan(16);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-0331');

create temp table issuance (t text primary key) on commit drop;
insert into issuance values ('issuance_requests'),('issuance_request_approvals'),('issuance_submissions'),
  ('issued_policy_documents'),('issued_policy_checks'),('issued_policy_check_items'),
  ('issued_policy_resolutions'),('policy_issuance_applications');
create temp table evidence (t text primary key) on commit drop;
insert into evidence values ('issuance_submissions'),('issued_policy_documents'),('issued_policy_checks'),
  ('issued_policy_check_items'),('issued_policy_resolutions'),('policy_issuance_applications');
grant select on issuance, evidence to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tenancy and grants.

select is_empty($$
  select t from issuance i where not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = i.t and c.column_name = 'organization_id' and c.is_nullable = 'NO')
$$, 'every issuance table carries a non-null organization_id');
select is_empty($$
  select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in (select t from issuance) and not c.relrowsecurity
$$, 'row level security is enabled on every issuance table');
select is_empty($$
  select t from issuance i where not exists (
    select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = i.t and p.cmd = 'SELECT'
       and p.qual like '%can_access(organization_id)%')
$$, 'every issuance table is readable only within the brokerage');
select is_empty($$
  select tablename || ':' || policyname from pg_policies
   where schemaname = 'public' and tablename in (select t from issuance)
     and ((cmd = 'INSERT' and (with_check is null or with_check not like '%can_access(organization_id)%'))
       or (cmd = 'UPDATE' and (qual is null or with_check is null)))
$$, 'every insert policy checks the brokerage, and every update policy has USING and WITH CHECK');
select is_empty($$
  select tablename || ':' || policyname from pg_policies
   where schemaname = 'public' and tablename in (select t from issuance) and 'anon' = any(roles)
$$, 'no issuance policy admits anon');
select is_empty($$
  select table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name in (select t from issuance)
     and (grantee in ('anon', 'PUBLIC') or (grantee in ('authenticated', 'asap_worker') and privilege_type = 'DELETE'))
$$, 'anon and PUBLIC hold nothing on them, and nobody may delete');
select is_empty($$
  select privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'policy_issuance_applications'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'
$$, 'an application is only ever written by the apply function: a browser role may only read it');

-- ---------------------------------------------------------------------------------------------
-- The API-only gate, and evidence that cannot be changed.

select is_empty($$
  select t from issuance where not exists (select 1 from pg_trigger g where g.tgrelid = t::regclass and g.tgname = '000_through_api')
$$, 'every issuance table has the API-only write gate, firing first');
select is_empty($$
  select t from evidence where not exists (select 1 from pg_trigger g where g.tgrelid = t::regclass and g.tgname = t || '_immutable')
$$, 'submissions, documents, checks, items, resolutions and applications are immutable');
select is_empty($$
  select c.conrelid::regclass || '.' || a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.conrelid::regclass::text in (select t from issuance)
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
$$, 'every foreign key on the issuance tables is indexed');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'issuance_submissions_provider_names_its_message') like '%provider_message_id IS NOT NULL%',
  'a provider submission must carry the provider''s real message id');

-- ---------------------------------------------------------------------------------------------
-- The apply function.

select ok(
  (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc
    where oid = 'public.policy_issuance_apply(uuid, uuid, uuid, text, uuid, uuid, jsonb, jsonb, text)'::regprocedure),
  'the apply function is SECURITY DEFINER with a fixed search_path');
select ok(
  not has_function_privilege('anon', 'public.policy_issuance_apply(uuid, uuid, uuid, text, uuid, uuid, jsonb, jsonb, text)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid = 'public.policy_issuance_apply(uuid, uuid, uuid, text, uuid, uuid, jsonb, jsonb, text)'::regprocedure
                     and x.grantee = 0 and x.privilege_type = 'EXECUTE'),
  'PUBLIC and anon may not execute it');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
     and p.proname in ('issuance_request_is_frozen', 'issuance_approval_covers_the_request', 'issuance_submission_needs_live_approval',
                       'issuance_records_are_immutable', 'policy_issuance_apply')
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
$$, 'every issuance function fixes its search_path');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok(
  $$select public.policy_issuance_apply(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'create', null, null, null,
                                        '{"period_start":"2026-09-10","period_end":"2027-09-09"}'::jsonb, 'pgtap-forged-apply')$$,
  null, null, 'a browser session, without the server-held key, cannot apply an issued policy');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.policy_issuance_apply(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'create', null, null, null,
                                        '{"period_start":"2026-09-10","period_end":"2027-09-09"}'::jsonb, 'pgtap-missing-apply')$$,
  'P0002', 'placement_not_found', 'the API cannot apply against a placement that does not exist');

select * from finish();
rollback;
