-- 0020 — Work item 5f: covering indexes for the ten foreign keys the advisor flagged
-- (unindexed_foreign_keys), plus users.active_organization_id, which 0014 added after that advisor
-- run and which the pgTAP covering-index test caught. Unused-index warnings are left alone until
-- there is data.
create index audit_log_actor_user_id_idx              on audit_log (actor_user_id);
create index events_actor_user_id_idx                 on events (actor_user_id);
create index invitations_accepted_by_idx              on invitations (accepted_by);
create index invitations_invited_by_idx               on invitations (invited_by);
create index invitations_role_id_idx                  on invitations (role_id);
create index organization_memberships_invited_by_idx  on organization_memberships (invited_by);
create index organization_memberships_role_id_idx     on organization_memberships (role_id);
create index role_permissions_permission_id_idx       on role_permissions (permission_id);
create index teams_lead_user_id_idx                   on teams (lead_user_id);
create index user_team_memberships_user_id_idx        on user_team_memberships (user_id);
create index users_active_organization_id_idx        on users (active_organization_id);
