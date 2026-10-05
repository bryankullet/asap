-- 0065 — the engine runs more than renewal (D-139).
--
-- 0062/0063 allowed one workflow and one subject type because only renewal existed. The registry
-- (apps/api/src/workflows/registry.ts) now carries the quotation, placement, issuance, endorsement
-- and claim workflows on the same engine: one live run per (organization, workflow, subject), the
-- same leases, the same audit. The lists below are the registry's, and a name not on them is
-- refused by the database as well as by the code.
alter table workflow_runs drop constraint workflow_runs_workflow_check;
alter table workflow_runs add constraint workflow_runs_workflow_check
  check (workflow in ('renewal', 'quotation', 'placement', 'issuance', 'endorsement', 'claim'));

alter table workflow_runs drop constraint workflow_runs_subject_type_check;
alter table workflow_runs add constraint workflow_runs_subject_type_check
  check (subject_type in ('policy_period', 'opportunity', 'placement', 'policy', 'claim', 'work_item'));

alter table workflow_receipts drop constraint workflow_receipts_workflow_check;
alter table workflow_receipts add constraint workflow_receipts_workflow_check
  check (workflow in ('renewal', 'quotation', 'placement', 'issuance', 'endorsement', 'claim'));
