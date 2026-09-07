-- pgTAP: work item 5g — under anon, every policy-protected table returns zero rows without error.
begin;
select * from no_plan();

create temp table all_protected as
  select 'public'::text as sch, c.relname::text as tbl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all select 'storage', 'objects';
grant select on all_protected to anon;

-- Returns the row count as text, or 'ERROR <sqlstate> <message>' — runs as the CURRENT role.
create or replace function pg_temp.anon_count(p_sch text, p_tbl text) returns text
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %I.%I', p_sch, p_tbl) into n;
  return n::text;
exception when others then
  return 'ERROR ' || sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function pg_temp.anon_count(text, text) to anon;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set role anon;

-- Two acceptable outcomes, decided by the grant layer, never by a policy raising:
--   anon holds SELECT  → zero rows, no error (the policy evaluated to false)
--   anon holds nothing → 42501 "permission denied for table …" (refused before any policy ran)
-- A "permission denied for function …" or any other error means a policy threw. That is the defect.
select case
  when has_table_privilege('anon', format('%I.%I', sch, tbl), 'select')
    then is(pg_temp.anon_count(sch, tbl), '0', format('anon: %s.%s (has SELECT) returns zero rows, no error', sch, tbl))
  else matches(pg_temp.anon_count(sch, tbl), '^ERROR 42501 permission denied for table ',
               format('anon: %s.%s (no SELECT) is refused at the grant layer, not by a policy', sch, tbl))
  end
from all_protected order by sch, tbl;

select ok(has_table_privilege('anon', 'storage.objects', 'select'),
  'anon holds SELECT on storage.objects (so the policy layer itself is exercised above)');

-- anon may not call the tenancy helpers at all.
select throws_ok($$ select app.can_access('10000000-0000-4000-8000-00000000000a') $$, '42501', null,
  'anon cannot execute app.can_access');
select throws_ok($$ select app.worker_org() $$, '42501', null, 'anon cannot execute app.worker_org');
select throws_ok($$ select app.current_user_orgs() $$, '42501', null, 'anon cannot execute app.current_user_orgs');
-- …but the invitation preview stays reachable (the token is the credential).
select lives_ok($$ select * from app.invitation_preview('no-such-hash') $$, 'anon can call invitation_preview');

reset role;
select * from finish();
rollback;
