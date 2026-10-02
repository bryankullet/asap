-- pgTAP: supervision (0063, D-131).
--   * workflow receipts: RLS on; members read their own brokerage only; no browser role writes;
--     one receipt per run; searchable;
--   * rule history (0052) still versions every change, which the supervision layer reports.
begin;
select plan(9);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select ok((select relrowsecurity from pg_class where relname = 'workflow_receipts'), 'row level security is on for receipts');
select is_empty($$
  select privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'workflow_receipts'
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
$$, 'no browser role may write a receipt');

-- Fixture, as the owner.
insert into workflow_runs (id, organization_id, workflow, subject_type, subject_id, state, finished_at)
values ('f3360000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'renewal', 'policy_period', gen_random_uuid(), 'done', now());
insert into workflow_receipts (organization_id, run_id, workflow, title, outcome, receipt)
values ('10000000-0000-4000-8000-00000000000a', 'f3360000-0000-4000-8000-00000000000a', 'renewal',
        'Renewal — Acme Motors, MOT-1', 'Renewal terms ready to present — CIC quoted KES 4,950,000', '{"intendedOutcome":"x"}');

select throws_like($$ insert into workflow_receipts (organization_id, run_id, workflow, title, outcome, receipt)
  values ('10000000-0000-4000-8000-00000000000a', 'f3360000-0000-4000-8000-00000000000a', 'renewal', 'again', 'again', '{}') $$,
  '%workflow_receipts_run_id_key%', 'one receipt per run');
select isnt_empty($$ select id from workflow_receipts where search @@ plainto_tsquery('simple', 'CIC renewal') $$, 'a receipt is searchable by its outcome');

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is_empty($$ select id from workflow_receipts where run_id = 'f3360000-0000-4000-8000-00000000000a' $$, 'another brokerage cannot see the receipt');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select isnt_empty($$ select id from workflow_receipts where run_id = 'f3360000-0000-4000-8000-00000000000a' $$, 'a member reads their own brokerage''s receipt');
select throws_ok($$ update workflow_receipts set outcome = 'changed' where run_id = 'f3360000-0000-4000-8000-00000000000a' $$,
  NULL, 'a member cannot edit a receipt');
select throws_ok($$ delete from workflow_receipts where run_id = 'f3360000-0000-4000-8000-00000000000a' $$,
  NULL, 'a member cannot delete a receipt');

reset role;
-- Two changes to a rule are two versions — the number the supervision layer shows.
create temp table before_versions as select count(*)::int as n from company_rule_versions where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'workflow.autonomy';
delete from company_rules where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'workflow.autonomy';
insert into company_rules (organization_id, key, value, source, verified_at, set_by)
values ('10000000-0000-4000-8000-00000000000a', 'workflow.autonomy', '{"approver":"any_approver"}', 'pgTAP', current_date, 'a0000000-0000-4000-8000-000000000001');
update company_rules set value = '{"approver":"admin_or_owner"}' where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'workflow.autonomy';
select is((select count(*)::int from company_rule_versions where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'workflow.autonomy') - (select n from before_versions), 2,
  'every change to a rule is kept as a version');

select * from finish();
rollback;
