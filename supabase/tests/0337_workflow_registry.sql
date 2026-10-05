-- pgTAP: the engine carries more than renewal (0065, D-139).
--   * the six registered workflows and their subject types are accepted; any other name is refused;
--   * one live run per (organization, workflow, subject) still holds for the new workflows;
--   * receipts accept the same names.
begin;
select plan(6);

select lives_ok($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  select '10000000-0000-4000-8000-00000000000a', w, s, gen_random_uuid()
    from (values ('quotation', 'opportunity'), ('placement', 'placement'), ('issuance', 'placement'),
                 ('endorsement', 'work_item'), ('claim', 'claim')) as v(w, s)
$$, 'quotation, placement, issuance, endorsement and claim runs are accepted');
select throws_like($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  values ('10000000-0000-4000-8000-00000000000a', 'probe', 'opportunity', gen_random_uuid())
$$, '%workflow_runs_workflow_check%', 'a workflow nothing registers is refused');
select throws_like($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  values ('10000000-0000-4000-8000-00000000000a', 'quotation', 'spreadsheet', gen_random_uuid())
$$, '%workflow_runs_subject_type_check%', 'an unknown subject type is refused');

insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
values ('10000000-0000-4000-8000-00000000000a', 'quotation', 'opportunity', 'f3370000-0000-4000-8000-00000000000a');
select throws_like($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  values ('10000000-0000-4000-8000-00000000000a', 'quotation', 'opportunity', 'f3370000-0000-4000-8000-00000000000a')
$$, '%workflow_runs_one_live_per_subject%', 'one live quotation run per opportunity');
select lives_ok($$
  insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  values ('10000000-0000-4000-8000-00000000000a', 'placement', 'opportunity', 'f3370000-0000-4000-8000-00000000000a')
$$, 'a different workflow may run on the same subject');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'workflow_receipts_workflow_check')) like '%claim%',
  'receipts accept the new workflows');

select * from finish();
rollback;
