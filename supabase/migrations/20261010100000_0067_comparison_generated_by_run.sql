-- 0067 — a comparison ASAP's quotation run generated says so (D-141).
--
-- 0050 required `generated_by` to name a person, because only a person generated comparisons. The
-- quotation workflow now generates one when every insurer has answered, and putting a person's
-- name on what a run did would make the audit trail lie. Exactly one of the two is recorded: the
-- person who generated it, or the run that did. Presenting a comparison to a client is still a
-- person's act (`presented_by`), unchanged.
alter table quote_comparisons alter column generated_by drop not null;
alter table quote_comparisons add column generated_by_run_id uuid references workflow_runs(id) on delete set null;
alter table quote_comparisons add constraint quote_comparisons_generated_by_one
  check ((generated_by is not null) <> (generated_by_run_id is not null));
create index quote_comparisons_generated_by_run_id_idx on quote_comparisons (generated_by_run_id);
comment on column quote_comparisons.generated_by_run_id is
  'The workflow run that generated this comparison, when ASAP did (D-141). Null when a person did.';
