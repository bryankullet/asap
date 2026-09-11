-- pgTAP: automations (0036).
--
-- Two rules are constraints rather than route logic, because the route is not the only thing that
-- will ever write these rows: an automation that reaches outside the brokerage cannot be
-- configured to run unattended, and one happening fires an automation exactly once.
begin;
select plan(10);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'automations', 'automations exists');
select has_table('public', 'automation_runs', 'automation_runs exists');
select is(
  (select count(*)::int from pg_class
   where oid in ('public.automations'::regclass,'public.automation_runs'::regclass) and relrowsecurity),
  2, 'row level security is enabled on both');
select is(
  (select count(*)::int from pg_policies
   where schemaname='public' and tablename in ('automations','automation_runs')
     and ((coalesce(qual,'')||coalesce(with_check,'')) not like '%can_access%'
          or roles::text[] @> array['anon'])),
  0, 'every policy carries the brokerage scope and none reaches anon');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

-- §45 rule 13, as a row constraint. No configuration can produce unattended external sending.
select throws_ok(
  $$insert into automations (organization_id, name, trigger_event, skill, prepared_verb, approval, sends_externally, created_by)
    values ('10000000-0000-4000-8000-00000000000a','Chase unattended','check.overdue','quote.track_responses',
            'draft','never',true,'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an automation that reaches outside cannot run unattended');

-- A trigger is a semantic event, never a table change.
select throws_ok(
  $$insert into automations (organization_id, name, trigger_event, skill, prepared_verb, created_by)
    values ('10000000-0000-4000-8000-00000000000a','Table watcher','insurer_quotes','quote.track_responses',
            'prepare','a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a trigger must be a semantic event, not a bare table name');

insert into automations (id, organization_id, name, trigger_event, skill, prepared_verb, created_by)
values ('c1000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-00000000000a',
        'Record terms','quote.received','renewal.extract_terms','record_evidence',
        'a0000000-0000-4000-8000-000000000001');
select is((select enabled from automations where id='c1000000-0000-4000-8000-000000000001'), false,
  'a new automation is switched off until someone switches it on');

-- One happening, one firing. This is the idempotency a duplicated webhook runs into.
insert into automation_runs (organization_id, automation_id, event_id, event_name)
values ('10000000-0000-4000-8000-00000000000a','c1000000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000001','quote.received');
select throws_ok(
  $$insert into automation_runs (organization_id, automation_id, event_id, event_name)
    values ('10000000-0000-4000-8000-00000000000a','c1000000-0000-4000-8000-000000000001',
            'e1000000-0000-4000-8000-000000000001','quote.received')$$,
  '23505', null, 'the same happening cannot fire one automation twice');

-- A decision has a decider, and a failure a person is shown has to say something.
select throws_ok(
  $$update automation_runs set decision = 'approved'
    where event_id = 'e1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a decision cannot be recorded with nobody having made it');
select throws_ok(
  $$update automation_runs set outcome = 'could_not_finish'
    where event_id = 'e1000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an automation cannot fail without saying why');
reset role;

select * from finish();
rollback;
