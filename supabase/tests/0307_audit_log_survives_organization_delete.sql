-- pgTAP: 0030 — an organization with audit rows cannot be deleted; the audit log never goes by
-- cascade (Screen Map v1 C05: "never rewrite historical outcomes"; D-054).
begin;
select plan(5);

select is(
  (select confdeltype from pg_constraint where conname = 'audit_log_organization_id_fkey' and conrelid = 'public.audit_log'::regclass),
  'r', 'audit_log.organization_id is ON DELETE RESTRICT');

-- A brokerage created the normal way has audit rows from birth.
create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
create temp table t_org as select app.create_organization('Ephemeral Cover', null, 'KE', 'KES', 'Africa/Nairobi', true) as id;
reset role;
select is((select count(*) from audit_log where organization_id = (select id from t_org)), 2::bigint,
  'a new brokerage has audit rows from the moment it is created');

-- Even the table owner cannot delete it while its history exists.
select throws_ok(
  $$ delete from organizations where id = (select id from t_org) $$,
  '23503', null, 'deleting a brokerage that has audit rows is refused');
select is((select count(*) from organizations where id = (select id from t_org)), 1::bigint, 'the brokerage is still there');
select is((select count(*) from audit_log where organization_id = (select id from t_org)), 2::bigint, 'and so is every audit row');

select * from finish();
rollback;
