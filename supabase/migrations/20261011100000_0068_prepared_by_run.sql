-- 0068 — what the placement and issuance runs prepare says the run prepared it (D-142).
--
-- The placement and issuance workflows prepare the insurer requests and record the insurer's policy
-- document when exactly one waiting run fits it. The columns that name who did that required a
-- person, so the run would have had to borrow somebody's name. As in 0067, exactly one of the two is
-- recorded: the person, or the run. Approving, sending and applying are unchanged — still a person's
-- acts, and still required to name the person.
alter table placement_requests alter column prepared_by drop not null;
alter table placement_requests add column prepared_by_run_id uuid references workflow_runs(id) on delete set null;
alter table placement_requests add constraint placement_requests_prepared_by_one check ((prepared_by is not null) <> (prepared_by_run_id is not null));
create index placement_requests_prepared_by_run_id_idx on placement_requests (prepared_by_run_id);

alter table issuance_requests alter column prepared_by drop not null;
alter table issuance_requests add column prepared_by_run_id uuid references workflow_runs(id) on delete set null;
alter table issuance_requests add constraint issuance_requests_prepared_by_one check ((prepared_by is not null) <> (prepared_by_run_id is not null));
create index issuance_requests_prepared_by_run_id_idx on issuance_requests (prepared_by_run_id);

alter table issued_policy_documents alter column recorded_by drop not null;
alter table issued_policy_documents add column recorded_by_run_id uuid references workflow_runs(id) on delete set null;
alter table issued_policy_documents add constraint issued_policy_documents_recorded_by_one check ((recorded_by is not null) <> (recorded_by_run_id is not null));
create index issued_policy_documents_recorded_by_run_id_idx on issued_policy_documents (recorded_by_run_id);

-- compared_by was already optional; the run that compared is now named when it was the run.
alter table issued_policy_checks add column compared_by_run_id uuid references workflow_runs(id) on delete set null;
create index issued_policy_checks_compared_by_run_id_idx on issued_policy_checks (compared_by_run_id);

-- A workflow step prepares the request through the same service as a person, on the API's
-- service connection; it digests the request with the same function.
grant execute on function app.placement_request_digest(text, text, text, timestamptz, text) to service_role;
