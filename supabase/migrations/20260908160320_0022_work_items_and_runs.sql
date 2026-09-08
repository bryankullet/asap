-- 0022 — UI Build Spec v1 Phase 1: work items and runs as readable tables
--
-- Phase 1 of the UI spec ships the shell, Work's four views, record routes and an Ask that only
-- searches, over real Supabase reads with RLS on. That needs the two tables the shell reads
-- (spec Part 1.2 names `work_items` and `runs`). The shape is spec Part 5.1; the *engine* that
-- writes them (guards, actions, in-transaction run outcomes) is Phase 2 and is not here.
--
-- Rules honoured:
--   - Task, cover, money and run status are the Part 2.1 vocabularies, checked in the database.
--     They are workflow status, not economic state (architecture §3A); no economic column exists.
--   - `with_party` is impossible without a party and a since date (spec Part 2.3), at the row.
--   - Nothing here is a model-authored status: Phase 2's engine derives it from steps.
--   - client_id / policy_period_id are nullable uuids without foreign keys: the clients and
--     policy_periods tables are Phase 2 of the work order (D-029). A later migration adds the keys.
--   - Grants are explicit (D-020). authenticated may only SELECT in Phase 1; writes arrive with
--     the API in Phase 2. asap_worker inherits select/insert/update/delete from 0013's defaults.

create table work_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  title             text not null check (length(btrim(title)) > 0),
  -- one of the fourteen Part 6 workflows
  kind              text not null check (kind in (
                      'new_business','placement','endorsement','tor','certificate','claim',
                      'renewal','compliance','money_in','money_out','reconciliation','wht',
                      'import','exception')),
  client_id         uuid,
  policy_period_id  uuid,
  owner_id          uuid references users(id),
  task_status       text not null check (task_status in ('needs_you','with_party','in_progress','done')),
  task_party        text,
  task_since        timestamptz,
  task_next_check   timestamptz,
  cover_status      text check (cover_status in (
                      'draft','requested','submitted','confirmed','active','expired','cancelled')),
  money_status      text check (money_status in (
                      'not_invoiced','unpaid','part_paid','paid','received','reconciled','disputed',
                      'due_to_insurer','settled')),
  -- Why this item is on Today / in this view, in plain language. Shown behind "Why here?".
  reason            text,
  steps             jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  search            tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(task_party, ''))) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  deleted_at        timestamptz,
  constraint work_items_with_party_named check (
    task_status <> 'with_party' or (task_party is not null and task_since is not null)),
  constraint work_items_done_has_completed_at check (
    (task_status = 'done') = (completed_at is not null))
);

create index work_items_organization_id_task_status_idx on work_items (organization_id, task_status);
create index work_items_organization_id_updated_at_idx on work_items (organization_id, updated_at desc);
create index work_items_owner_id_idx on work_items (owner_id);
create index work_items_search_idx on work_items using gin (search);

create table runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  work_item_id     uuid references work_items(id) on delete set null,
  -- names the output ("Renewal pack prepared"), never a business outcome (spec Part 8)
  title            text not null check (length(btrim(title)) > 0),
  status           text not null check (status in ('working','paused','finished','could_not_finish','stopped')),
  -- what the person should do next when the run did not finish
  next_step        text,
  started_by       uuid references users(id),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint runs_ended_when_not_working check ((status = 'working') = (ended_at is null))
);

create index runs_organization_id_started_at_idx on runs (organization_id, started_at desc);
create index runs_work_item_id_idx on runs (work_item_id);
create index runs_started_by_idx on runs (started_by);

alter table work_items enable row level security;
alter table runs enable row level security;

-- One permissive SELECT policy per table; write policies per command (0018 convention); scoped
-- away from anon (0021 convention).
create policy tenant_read on work_items for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on work_items for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on work_items for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on work_items for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

create policy tenant_read on runs for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on runs for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on runs for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on runs for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

-- Phase 1: reads only for signed-in users. The API (Phase 2) brings the write grants with the engine.
grant select on work_items, runs to authenticated;
