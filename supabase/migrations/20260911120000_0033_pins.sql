-- 0033 — Pins: a personal marker, not a view.
--
-- A pin says "I am coming back to this". It is one person's marker on one record, in one
-- brokerage. What it is deliberately **not**:
--
--  - **Not a navigation destination.** There is no Pinned tab. Work's views are the states work is
--    actually in; a personal marker is not one of them, and making it one would be a list page for
--    a thing rather than a surface for work.
--  - **Not shared.** A colleague's pins are not brokerage information. The work is shared, in
--    work_items, where everyone in the brokerage sees it; the marker is not.
--  - **Not a status.** Pinning changes nothing about the record: no step, no guard, no ranking.
--    Discover's order is computed from signals and is not moved by anyone's marker (D-060).
--
-- One row per person per record, so pinning twice is the same pin.
create table work_item_pins (
  organization_id  uuid not null references organizations(id) on delete cascade,
  work_item_id     uuid not null references work_items(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  -- A person's own words about why they kept it. Never shown to anyone else.
  note             text check (note is null or length(btrim(note)) > 0),
  created_at       timestamptz not null default now(),
  primary key (work_item_id, user_id)
);
create index work_item_pins_user_idx on work_item_pins (user_id, organization_id, created_at desc);
create index work_item_pins_organization_id_idx on work_item_pins (organization_id);

comment on table work_item_pins is
  'A personal marker on a work item. Not shared, not a status, not a navigation destination.';

alter table work_item_pins enable row level security;

-- Tenant isolation and personal scope together, on every command. A member of the brokerage sees
-- their own pins only; another brokerage sees none at all.
create policy tenant_select on work_item_pins
  for select to authenticated, asap_worker
  using (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_insert on work_item_pins
  for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and user_id = (select auth.uid())
              -- A pin cannot point outside the brokerage it claims to be in.
              and exists (select 1 from work_items w
                          where w.id = work_item_id and w.organization_id = work_item_pins.organization_id));
create policy tenant_update on work_item_pins
  for update to authenticated, asap_worker
  using (app.can_access(organization_id) and user_id = (select auth.uid()))
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_delete on work_item_pins
  for delete to authenticated, asap_worker
  using (app.can_access(organization_id) and user_id = (select auth.uid()));

grant select, insert, update, delete on work_item_pins to authenticated, asap_worker;
