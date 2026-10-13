-- 0080 — Personal interface preferences on composed surfaces (D-157).
--
-- What one person keeps arranged on one surface in one brokerage: which blocks are pinned or
-- collapsed, what they had selected, when they last looked. Interface state only — never a status,
-- never business data, never shared. Scoped to (brokerage, person, surface) under RLS, like
-- space_pins (0078), so a brokerage switch or a different colleague never inherits it.
--
-- `surface_key` is the surface's identity, e.g. 'renewal:<work item id>', 'home', 'portfolio:renewals'.

create table surface_preferences (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  surface_key     text not null check (surface_key ~ '^[a-z_]{1,40}(:[A-Za-z0-9_.:-]{1,200})?$'),
  prefs           jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) <= 16384),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id, surface_key)
);
create index surface_preferences_user_id_idx on surface_preferences (user_id);
comment on table surface_preferences is 'One person''s arrangement of one composed surface in one brokerage (D-157). Interface state only.';

alter table surface_preferences enable row level security;
create policy tenant_select on surface_preferences for select to authenticated
  using (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_insert on surface_preferences for insert to authenticated
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_update on surface_preferences for update to authenticated
  using (app.can_access(organization_id) and user_id = (select auth.uid()))
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_delete on surface_preferences for delete to authenticated
  using (app.can_access(organization_id) and user_id = (select auth.uid()));
grant select, insert, update, delete on surface_preferences to authenticated;
revoke all on surface_preferences from anon;
