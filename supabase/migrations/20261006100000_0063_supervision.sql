-- 0063 — Supervision (D-131).
--
-- The completion receipt of a finished workflow: intended and achieved outcome, dates, approvals,
-- people, evidence, delivery evidence and anything left unresolved. Written once by the engine;
-- searchable; never edited. (Rule versions already exist: company_rule_versions, 0052, kept by
-- trigger — the supervision layer reads them; nothing here changes them.)
--
-- Additive only: one new table.

create table workflow_receipts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id          uuid not null unique references workflow_runs(id) on delete cascade,
  workflow        text not null check (workflow in ('renewal')),
  client_id       uuid references clients(id) on delete set null,
  work_item_id    uuid references work_items(id) on delete set null,
  title           text not null check (length(btrim(title)) > 0),
  -- One line, plain words: "Renewal terms ready to present — CIC quoted KES 4,950,000".
  outcome         text not null check (length(btrim(outcome)) > 0),
  receipt         jsonb not null,
  completed_at    timestamptz not null default now(),
  search          tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(outcome, ''))) stored
);
create index workflow_receipts_organization_id_idx on workflow_receipts (organization_id);
create index workflow_receipts_client_id_idx on workflow_receipts (client_id);
create index workflow_receipts_work_item_id_idx on workflow_receipts (work_item_id);
create index workflow_receipts_search_idx on workflow_receipts using gin (search);

comment on table workflow_receipts is
  'The completion receipt of a finished workflow. Written once by the engine; searchable; never edited.';

-- Read by members of the brokerage; written by the engine's service connection only.
alter table workflow_receipts enable row level security;
create policy tenant_select on workflow_receipts for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on workflow_receipts to authenticated, asap_worker;
revoke insert, update, delete on workflow_receipts from authenticated, asap_worker, anon;
create trigger "000_through_api" before insert or update or delete on workflow_receipts
  for each row execute function app.placement_writes_through_api();
