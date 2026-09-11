-- 0036 — Automations: trigger, conditions, prepared action, approval rule, exceptions, history.
--
-- An automation is a standing instruction from the brokerage: *when this happens, and these things
-- are true, prepare that.* The rules that shape the schema:
--
--  - **It prepares; it does not decide.** The action is a named verb from the engine's own
--    vocabulary, on the record the event was about. An automation cannot invent a verb, cannot
--    write a status, and cannot approve anything (§45 rules 10, 13).
--  - **Anything leaving the brokerage needs a person.** `approval` is `always` for any action that
--    sends, and the constraint below refuses an automation that would send unattended. This is
--    §45 rule 13 written where nothing can route around it.
--  - **Triggers are semantic events**, not table changes: `quote.received`, never
--    `insurer_quotes.insert`.
--  - **Runs are idempotent.** One row per (automation, event), so a duplicated webhook cannot
--    prepare the same thing twice.
--  - **Nothing is hidden.** Every run is recorded, including the ones that did nothing and the
--    ones that failed — a silent automation is worse than none (§45 rule 15).

create table automations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null check (length(btrim(name)) > 0),
  -- What a person reads to know what this does. Plain brokerage language, no codes.
  description      text not null default '',
  -- The semantic event that starts it. Never a table name.
  trigger_event    text not null check (trigger_event ~ '^[a-z_]+\.[a-z_]+$'),
  -- All of these must hold. An empty list means the trigger alone is the condition.
  conditions       jsonb not null default '[]'::jsonb,
  -- The named capability that does the work, from docs/skill-map.md.
  skill            text not null check (length(btrim(skill)) > 0),
  -- The engine verb the prepared action would take, from the finite vocabulary.
  prepared_verb    text not null,
  -- When a person must approve. `always` is required for anything that leaves the brokerage.
  approval         text not null default 'always' check (approval in ('always','never')),
  -- Whether this action reaches outside the brokerage. Set from the verb, checked here.
  sends_externally boolean not null default false,
  enabled          boolean not null default false,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint automations_organization_id_name_key unique (organization_id, name),
  -- §45 rule 13, as a row constraint. No configuration can produce unattended external sending.
  constraint automations_external_send_needs_approval check (
    not sends_externally or approval = 'always')
);
create index automations_organization_id_idx on automations (organization_id);
create index automations_trigger_event_idx on automations (organization_id, trigger_event) where enabled;
create index automations_created_by_idx on automations (created_by);

-- One row per (automation, event). The unique constraint is the idempotency: a consumer that sees
-- the same event twice writes the same row twice and the second write is refused.
create table automation_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  automation_id    uuid not null references automations(id) on delete cascade,
  -- The event that started it, and the record it was about.
  event_id         uuid not null,
  event_name       text not null,
  work_item_id     uuid references work_items(id) on delete set null,
  outcome          text not null default 'working'
    check (outcome in ('working','prepared','conditions_not_met','needs_approval','exception','could_not_finish')),
  -- Which conditions held and which did not, so "why did nothing happen?" has an answer.
  condition_results jsonb not null default '[]'::jsonb,
  -- What it prepared, if anything: the verb and the step, never a status or a value.
  prepared_action  jsonb,
  -- Plain language when it could not finish, or when it raised an exception for a person.
  reason           text,
  -- Set when a person approved or declined what it prepared.
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  decision         text check (decision in ('approved','declined')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint automation_runs_automation_id_event_id_key unique (automation_id, event_id),
  constraint automation_runs_decision_has_a_person check (
    decision is null or (decided_by is not null and decided_at is not null)),
  constraint automation_runs_failure_has_a_reason check (
    outcome not in ('exception','could_not_finish') or reason is not null)
);
create index automation_runs_organization_id_started_at_idx
  on automation_runs (organization_id, started_at desc);
create index automation_runs_automation_id_idx on automation_runs (automation_id);
create index automation_runs_work_item_id_idx on automation_runs (work_item_id);
create index automation_runs_decided_by_idx on automation_runs (decided_by);
create index automation_runs_awaiting_idx
  on automation_runs (organization_id, started_at desc) where outcome = 'needs_approval';

comment on table automations is
  'Standing instructions. They prepare actions from the engine vocabulary; they never decide.';
comment on table automation_runs is
  'Every firing, including the ones that did nothing. A silent automation is worse than none.';

alter table automations enable row level security;
alter table automation_runs enable row level security;

create policy tenant_select on automations for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on automations for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_update on automations for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on automation_runs for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on automation_runs for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on automation_runs for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

grant select, insert, update on automations to authenticated, asap_worker;
grant select, insert, update on automation_runs to authenticated, asap_worker;
