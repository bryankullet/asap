-- pgTAP: work item 5 — tenant isolation and coverage guard.
begin;
select * from no_plan();

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end $$;
-- Row count in a table under the CURRENT role (SECURITY INVOKER), optionally for one organization.
create or replace function pg_temp.rows_in(p_tbl text, p_org uuid default null) returns bigint
language plpgsql as $$
declare n bigint;
begin
  if p_org is null then
    execute format('select count(*) from public.%I', p_tbl) into n;
  else
    execute format('select count(*) from public.%I where organization_id = %L', p_tbl, p_org) into n;
  end if;
  return n;
end $$;
grant execute on function pg_temp.rows_in(text, uuid) to anon, authenticated, asap_worker;

create temp table tenant_tables as
  select c.relname::text as tbl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.columns col on col.table_name = c.relname and col.table_schema = 'public'
  where n.nspname = 'public' and c.relkind = 'r' and col.column_name = 'organization_id';
grant select on tenant_tables to anon, authenticated, asap_worker;

-- 1. Coverage guard ------------------------------------------------------------
select is_empty($$
  select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policies p where p.tablename = c.relname and p.schemaname = 'public'))
$$, 'every public table has RLS enabled and at least one policy');

select is_empty($$
  select t.tbl from tenant_tables t
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tbl
      and (coalesce(p.qual, '') like '%organization_id%' or coalesce(p.with_check, '') like '%organization_id%'))
$$, 'every table carrying organization_id has a policy that references it');

select ok((select count(*) from tenant_tables) >= 6, 'the tenant table list is populated (' || (select count(*) from tenant_tables) || ' tables)');

-- 2. Cross-tenant reads --------------------------------------------------------
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(pg_temp.rows_in(tbl, '10000000-0000-4000-8000-00000000000a'), 0::bigint,
          'Beta admin sees zero Acme rows in ' || tbl)
from tenant_tables order by tbl;
select is((select count(*) from organizations where id = '10000000-0000-4000-8000-00000000000a'), 0::bigint,
  'Beta admin cannot see the Acme organization row');
select is((select count(*) from users where email like '%acme-brokers.test'), 0::bigint,
  'Beta admin cannot see Acme-only users');
select is((select count(*) from users where email = 'shared@consultant.test'), 1::bigint,
  'Beta admin can see the shared consultant (member of both)');
select pg_temp.logout();

-- 3. Cross-tenant writes -------------------------------------------------------
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into teams (organization_id, name) values ('10000000-0000-4000-8000-00000000000b', 'sneaky') $$,
  '42501', null, 'Acme admin cannot insert a row carrying Beta''s organization_id');
select throws_ok(
  $$ insert into audit_log (organization_id, actor_type, action, object_type)
     values ('10000000-0000-4000-8000-00000000000b', 'user', 'x', 'y') $$,
  '42501', null, 'Acme admin cannot write an audit row into Beta');
select lives_ok(
  $$ update teams set organization_id = '10000000-0000-4000-8000-00000000000a'
     where id = '20000000-0000-4000-8000-00000000000b' $$,
  'moving a Beta team into Acme does not error (the row is invisible)');
select throws_ok(
  $$ update teams set organization_id = '10000000-0000-4000-8000-00000000000b'
     where id = '20000000-0000-4000-8000-00000000000a' $$,
  '42501', null, 'Acme admin cannot re-stamp an Acme row with Beta''s organization_id');
select pg_temp.logout();
select is((select organization_id from teams where id = '20000000-0000-4000-8000-00000000000b'),
  '10000000-0000-4000-8000-00000000000b'::uuid, '…and the Beta team is unchanged');

-- 4. Audit log is insert-only --------------------------------------------------
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select throws_ok($$ update audit_log set action = 'x' $$, '42501', null, 'authenticated cannot update audit_log');
select throws_ok($$ delete from audit_log $$, '42501', null, 'authenticated cannot delete from audit_log');
select pg_temp.logout();

-- 5. Worker context ------------------------------------------------------------
set role asap_worker;
select is(pg_temp.rows_in(tbl), 0::bigint, 'worker without context reads nothing from ' || tbl)
from tenant_tables order by tbl;
select is((select count(*) from users), 0::bigint, 'worker without context sees no users');
select is((select count(*) from organizations), 0::bigint, 'worker without context sees no organizations');

select set_config('app.organization_id', '10000000-0000-4000-8000-00000000000a', true);
select is((select count(*) from organizations), 1::bigint, 'worker with Acme context sees one organization');
select is(pg_temp.rows_in(tbl, '10000000-0000-4000-8000-00000000000b'), 0::bigint,
          'worker with Acme context sees zero Beta rows in ' || tbl)
from tenant_tables order by tbl;
select is((select count(*) from organization_memberships where organization_id = '10000000-0000-4000-8000-00000000000a'), 4::bigint,
  'worker with Acme context sees all four Acme memberships');
select is((select count(*) from users), 4::bigint, 'worker with Acme context sees Acme''s members only');
select throws_ok($$ update audit_log set action = 'x' $$, '42501', null, 'worker cannot update audit_log');
select set_config('app.organization_id', '', true);
select is((select count(*) from organizations), 0::bigint, 'clearing the context returns the worker to zero rows');
reset role;

select * from finish();
rollback;
