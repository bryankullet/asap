-- pgTAP: UI Build Spec Phase 1 — work_items and runs are tenant-isolated, read-only for the API
-- role, and the with_party rule holds at the row (spec Part 2.3, Part 9).
begin;
select plan(12);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Acme account executive
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select is((select count(*) from work_items), 6::bigint, 'Acme AE counts exactly the six Acme work items (hidden rows are not counted)');
select is((select count(*) from work_items where organization_id = '10000000-0000-4000-8000-00000000000b'), 0::bigint,
          'Acme AE sees zero Beta work items');
select is((select count(*) from runs), 3::bigint, 'Acme AE counts exactly the three Acme runs');
select results_eq(
  $$select title from work_items where task_status = 'with_party' order by title$$,
  $$values ('Acme Motors — renewal terms from Jubilee'::text)$$,
  'the with_party view is one Acme item');
select is((select task_party from work_items where id = '30000000-0000-4000-8000-000000000001'), 'Jubilee',
          'a with_party item names its party');
select throws_ok(
  $$insert into work_items (organization_id, title, kind, task_status)
    values ('10000000-0000-4000-8000-00000000000a', 'x', 'renewal', 'needs_you')$$,
  '42501', null, 'authenticated cannot insert a work item in Phase 1 (grant layer)');
reset role;

-- Beta admin
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*) from work_items), 2::bigint, 'Beta admin counts exactly the two Beta work items');
select is((select count(*) from runs where organization_id = '10000000-0000-4000-8000-00000000000a'), 0::bigint,
          'Beta admin sees zero Acme runs');
reset role;

-- Row rules, as the owner role
select throws_ok(
  $$insert into work_items (organization_id, title, kind, task_status)
    values ('10000000-0000-4000-8000-00000000000a', 'no party', 'renewal', 'with_party')$$,
  '23514', null, 'with_party without a party and a since date is rejected at the row');
select throws_ok(
  $$insert into work_items (organization_id, title, kind, task_status)
    values ('10000000-0000-4000-8000-00000000000a', 'bad', 'renewal', 'waiting')$$,
  '23514', null, 'a status outside the task vocabulary is rejected');
select throws_ok(
  $$insert into runs (organization_id, title, status)
    values ('10000000-0000-4000-8000-00000000000a', 'Policy renewed', 'failed')$$,
  '23514', null, 'a status outside the run vocabulary is rejected');
select lives_ok(
  $$insert into work_items (organization_id, title, kind, task_status, task_party, task_since)
    values ('10000000-0000-4000-8000-00000000000a', 'ok', 'renewal', 'with_party', 'CIC', now())$$,
  'with_party with party and since is accepted');

select * from finish();
rollback;
