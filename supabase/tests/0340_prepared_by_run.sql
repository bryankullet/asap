-- pgTAP: placement and issuance records name who made them — a person or a workflow run (0068, D-142).
begin;
select plan(11);

select col_is_null('placement_requests', 'prepared_by', 'a placement request may be prepared by a run');
select has_column('placement_requests', 'prepared_by_run_id', 'placement requests record the preparing run');
select col_is_null('issuance_requests', 'prepared_by', 'an issuance request may be prepared by a run');
select has_column('issuance_requests', 'prepared_by_run_id', 'issuance requests record the preparing run');
select col_is_null('issued_policy_documents', 'recorded_by', 'an issued policy document may be recorded by a run');
select has_column('issued_policy_documents', 'recorded_by_run_id', 'issued policy documents record the run');
select has_column('issued_policy_checks', 'compared_by_run_id', 'issued policy checks record the run');
select fk_ok('placement_requests', 'prepared_by_run_id', 'workflow_runs', 'id', 'the preparing run is a real run');

select ok(exists(select 1 from pg_constraint where conname = 'placement_requests_prepared_by_one'), 'placement requests: exactly one of person or run');
select ok(exists(select 1 from pg_constraint where conname = 'issuance_requests_prepared_by_one'), 'issuance requests: exactly one of person or run');
select ok(exists(select 1 from pg_constraint where conname = 'issued_policy_documents_recorded_by_one'), 'issued documents: exactly one of person or run');

select * from finish();
rollback;
