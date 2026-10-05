-- pgTAP: endorsement runs, and a run completing only ASAP's own Work steps (0069, D-143).
begin;
select plan(8);

select lives_ok($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  values ('10000000-0000-4000-8000-00000000000a', 'endorsement', 'endorsement', 'f3410000-0000-4000-8000-00000000000a')
$$, 'an endorsement run is about the endorsement');
select throws_like($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  values ('10000000-0000-4000-8000-00000000000a', 'endorsement', 'invoice', 'f3410000-0000-4000-8000-00000000000b')
$$, '%workflow_runs_subject_type_check%', 'an unknown subject type is still refused');

insert into work_items (id, organization_id, title, kind, task_status, steps)
values ('f3410000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'pgTAP claim', 'claim', 'in_progress',
  '[{"id":"capture","label":"Captured","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null},
    {"id":"match","label":"Matched","actor":"you","state":"todo","guards":[],"evidence":[{"kind":"confirmation","label":"x"}],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null},
    {"id":"submit","label":"Sent","actor":"you","state":"todo","guards":[],"evidence":[{"kind":"record_send","label":"x"}],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]');
insert into workflow_runs (id, organization_id, workflow, subject_type, subject_id, work_item_id)
values ('f3410000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'claim', 'claim', 'f3410000-0000-4000-8000-0000000000a3', 'f3410000-0000-4000-8000-0000000000a1');

select throws_like($$ select work_item_step_by_run('f3410000-0000-4000-8000-0000000000a2', 'match', 'x') $$,
  '%not_the_current_step%', 'a run cannot complete a step that is not current');
select lives_ok($$ select work_item_step_by_run('f3410000-0000-4000-8000-0000000000a2', 'capture', 'Captured by ASAP') $$,
  'a run completes ASAP''s own current step');
select is((select steps -> 1 ->> 'state' from work_items where id = 'f3410000-0000-4000-8000-0000000000a1'), 'now', 'the next step becomes current');
select throws_like($$ select work_item_step_by_run('f3410000-0000-4000-8000-0000000000a2', 'match', 'x') $$,
  '%not_asaps_step%', 'a run cannot complete a person''s step');
select ok(exists(select 1 from audit_log where action = 'work_item.step_by_run' and object_id = 'f3410000-0000-4000-8000-0000000000a1' and actor_type = 'automation'), 'audited as the automation');

set local role authenticated;
select throws_like($$ select work_item_step_by_run('f3410000-0000-4000-8000-0000000000a2', 'match', 'x') $$,
  '%permission denied%', 'a signed-in session cannot call it at all');
reset role;

select * from finish();
rollback;
