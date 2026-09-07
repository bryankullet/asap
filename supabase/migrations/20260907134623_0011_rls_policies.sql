-- 0011 — RLS policies
-- Every table in the public schema has RLS enabled. Tenant tables use app.can_access, which
-- honours both a signed-in user's memberships and a worker's app.organization_id setting.
-- The `with check` clause is not optional: without it a user can read only their own rows but
-- still insert a row stamped with another organization's id.

alter table organizations              enable row level security;
alter table roles                      enable row level security;
alter table permissions                enable row level security;
alter table role_permissions           enable row level security;
alter table organization_memberships   enable row level security;
alter table teams                      enable row level security;
alter table user_team_memberships      enable row level security;
alter table invitations                enable row level security;
alter table audit_log                  enable row level security;
alter table events                     enable row level security;
alter table event_deliveries           enable row level security;
alter table users                      enable row level security;

-- organizations: keyed on id, not organization_id. Creation happens through a security-definer
-- function in the create-brokerage flow (work item 4); no insert policy here.
create policy org_read on organizations
  for select using (app.can_access(id));

create policy org_write on organizations
  for update using (app.can_access(id))
  with check (app.can_access(id));

-- Standard tenant pattern.
create policy tenant_read on roles
  for select using (app.can_access(organization_id));
create policy tenant_write on roles
  for all using (app.can_access(organization_id))
  with check (app.can_access(organization_id));

create policy tenant_read on organization_memberships
  for select using (app.can_access(organization_id));
create policy tenant_write on organization_memberships
  for all using (app.can_access(organization_id))
  with check (app.can_access(organization_id));

create policy tenant_read on teams
  for select using (app.can_access(organization_id));
create policy tenant_write on teams
  for all using (app.can_access(organization_id))
  with check (app.can_access(organization_id));

create policy tenant_read on invitations
  for select using (app.can_access(organization_id));
create policy tenant_write on invitations
  for all using (app.can_access(organization_id))
  with check (app.can_access(organization_id));

create policy tenant_read on events
  for select using (app.can_access(organization_id));
create policy tenant_write on events
  for all using (app.can_access(organization_id))
  with check (app.can_access(organization_id));

-- role_permissions: reached through its role.
create policy role_permissions_all on role_permissions
  for all using (
    exists (select 1 from roles r
            where r.id = role_permissions.role_id
              and app.can_access(r.organization_id))
  )
  with check (
    exists (select 1 from roles r
            where r.id = role_permissions.role_id
              and app.can_access(r.organization_id))
  );

-- user_team_memberships: reached through its team.
create policy team_membership_all on user_team_memberships
  for all using (
    exists (select 1 from teams t
            where t.id = user_team_memberships.team_id
              and app.can_access(t.organization_id))
  )
  with check (
    exists (select 1 from teams t
            where t.id = user_team_memberships.team_id
              and app.can_access(t.organization_id))
  );

-- users: yourself, plus anyone sharing an organization with you.
create policy user_self on users
  for select using (
    id = auth.uid()
    or exists (
      select 1 from organization_memberships m
      where m.user_id = users.id
        and m.status = 'active'
        and m.organization_id in (select app.current_user_orgs())
    )
    -- workers see the members of the organization they are working for
    or exists (
      select 1 from organization_memberships m
      where m.user_id = users.id
        and m.status = 'active'
        and m.organization_id = app.worker_org()
    )
  );

create policy user_update_self on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- permissions: global reference data, readable by any signed-in user. Workers are added in 0013,
-- once the asap_worker role exists.
create policy permissions_read on permissions
  for select to authenticated using (true);

-- audit_log: insert and read only.
create policy audit_read on audit_log
  for select using (app.can_access(organization_id));

create policy audit_insert on audit_log
  for insert with check (app.can_access(organization_id));

-- event_deliveries: reached through its event.
create policy delivery_all on event_deliveries
  for all using (
    exists (select 1 from events e
            where e.id = event_deliveries.event_id
              and app.can_access(e.organization_id))
  )
  with check (
    exists (select 1 from events e
            where e.id = event_deliveries.event_id
              and app.can_access(e.organization_id))
  );
