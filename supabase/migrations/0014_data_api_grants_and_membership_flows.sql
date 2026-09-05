-- 0014 — Data API grants, default roles, and the membership flows (work item 4)
--
-- Part 1: explicit Data API grants. The hosted project was created with "Automatically expose
-- new tables" OFF (D-020): new public tables carry no grants for anon / authenticated /
-- service_role, so nothing is reachable through supabase-js until a migration says so. This is
-- the allowlist. anon gets nothing on tenant tables; authenticated gets the minimum the user
-- paths need; RLS (0011) still decides which rows. Writes that need permission checks or audit
-- rows go through the security-definer functions in Part 3, not through direct table access.

grant select on organizations, roles, permissions, role_permissions, organization_memberships,
                teams, user_team_memberships, invitations, audit_log, events, event_deliveries,
                users
  to authenticated;

-- teams are plain tenant records in Phase 1 (no permission semantics yet).
grant insert, update, delete on teams, user_team_memberships to authenticated;

-- The API's recordAudit() and semantic events write under the user's session.
grant insert on audit_log, events to authenticated;
grant insert, update on event_deliveries to authenticated;

-- users: profile fields only. active_organization_id is set through app.set_active_organization,
-- which verifies membership; a browser must not be able to write it directly.
alter table users add column active_organization_id uuid references organizations(id) on delete set null;
grant update (full_name, display_name, avatar_url, phone, locale, timezone, last_seen_at)
  on users to authenticated;

-- service_role bypasses RLS and is confined to apps/api server-side (storage admin, later
-- Phase 3 ingestion). Keep the standard Supabase grant so admin paths behave as documented.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- audit_log stays insert-only for every application role (0009 revoked authenticated/anon; the
-- grants above deliberately omit update/delete). Re-assert against service_role too.
revoke update, delete, truncate on audit_log from service_role;

-- ---------------------------------------------------------------------------
-- Part 2: default roles and the permission matrix, in one place.
-- Called by app.create_organization for real brokerages and by seed.sql for the fixture, so the
-- two cannot drift (D-009 revisit). send_external per D-022: "this role talks to clients or
-- insurers at all"; the approval engine (work item 6) decides what goes out unsupervised.
-- ---------------------------------------------------------------------------
create or replace function app.seed_default_roles(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into roles (organization_id, key, name, description, is_system)
  values
    (p_organization_id, 'brokerage_admin',      'Brokerage administrator', 'Full control of the brokerage workspace, members and roles.', true),
    (p_organization_id, 'account_executive',    'Account executive',       'Owns client relationships, opportunities and renewals.', true),
    (p_organization_id, 'placement_officer',    'Placement officer',       'Arranges cover with insurers.', true),
    (p_organization_id, 'policy_administrator', 'Policy administrator',    'Maintains policy records, endorsements and certificates after issuance.', true),
    (p_organization_id, 'claims_officer',       'Claims officer',          'Registers and follows up claims.', true),
    (p_organization_id, 'renewals_officer',     'Renewals officer',        'Prepares and tracks renewals.', true),
    (p_organization_id, 'finance_officer',      'Finance officer',         'Invoices, payments, commissions and reconciliation.', true),
    (p_organization_id, 'manager',              'Manager',                 'Oversees the team, approvals and workload.', true),
    (p_organization_id, 'read_only',            'Read-only user',          'Can view, cannot change or send.', true)
  on conflict (organization_id, key) do nothing;

  -- brokerage_admin: everything.
  insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p
  where r.organization_id = p_organization_id and r.key = 'brokerage_admin'
  on conflict do nothing;

  -- manager: everything except delete.
  insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p
  where r.organization_id = p_organization_id and r.key = 'manager' and p.verb <> 'delete'
  on conflict do nothing;

  -- read_only: view everything except the audit log.
  insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p
  where r.organization_id = p_organization_id and r.key = 'read_only'
    and p.verb = 'view' and p.object_type <> 'audit'
  on conflict do nothing;

  -- operational roles: view everything (except audit); create/edit/ai_execute on business objects,
  -- spaces, jobs and reports; no organization / role / user administration.
  insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p
  where r.organization_id = p_organization_id
    and r.key in ('account_executive','placement_officer','policy_administrator',
                  'claims_officer','renewals_officer','finance_officer')
    and (
      (p.verb = 'view' and p.object_type <> 'audit')
      or (p.verb in ('create','edit','ai_execute')
          and p.object_type in ('client','policy','claim','document','email','quote','placement',
                                'invoice','payment','commission','space','job','report'))
    )
  on conflict do nothing;

  -- finance_officer additionally approves and exports money objects.
  insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p
  where r.organization_id = p_organization_id and r.key = 'finance_officer'
    and p.verb in ('approve','export')
    and p.object_type in ('invoice','payment','commission','report')
  on conflict do nothing;

  -- send_external (D-022): admin, manager, account_executive, placement_officer, renewals_officer,
  -- claims_officer, finance_officer. Not policy_administrator (internal record-keeping after the
  -- insurer issues; does not negotiate) and not read_only. Granted on the objects a message can
  -- be about.
  insert into role_permissions (role_id, permission_id)
  select r.id, p.id from roles r cross join permissions p
  where r.organization_id = p_organization_id
    and r.key in ('account_executive','placement_officer','renewals_officer',
                  'claims_officer','finance_officer')
    and p.verb = 'send_external'
    and p.object_type in ('client','policy','claim','document','email','quote','placement',
                          'invoice','payment','commission')
  on conflict do nothing;
end;
$$;

revoke all on function app.seed_default_roles(uuid) from public;

-- ---------------------------------------------------------------------------
-- Part 3: membership flows. Each is security definer so it can write rows the caller could not
-- write directly, checks the caller's membership and permission itself, and writes its own
-- audit row. Errors carry a stable errcode + message the API maps to HTTP status codes.
-- ---------------------------------------------------------------------------

-- Helper: the calling user's active membership in an organization, or null.
create or replace function app.current_membership(p_organization_id uuid)
returns organization_memberships
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.* from organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;
revoke all on function app.current_membership(uuid) from public;

-- §7 Step 1 — create the brokerage workspace. The first user becomes owner and administrator.
create or replace function app.create_organization(
  p_name           text,
  p_legal_name     text,
  p_country        text,
  p_currency       text,
  p_timezone       text,
  p_accepted_terms boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id  uuid;
  v_role_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if coalesce(p_accepted_terms, false) is not true then
    raise exception 'terms_not_accepted' using errcode = '22023';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country' using errcode = '22023';
  end if;
  if p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;
  if p_timezone is null or p_timezone not in (select name from pg_timezone_names) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  insert into organizations (name, legal_name, country, currency, timezone, created_by, settings)
  values (
    trim(p_name), nullif(trim(p_legal_name), ''), p_country, p_currency, p_timezone, v_user_id,
    jsonb_build_object('terms_accepted_at', now(), 'terms_accepted_by', v_user_id)
  )
  returning id into v_org_id;

  perform app.seed_default_roles(v_org_id);

  select id into v_role_id from roles
  where organization_id = v_org_id and key = 'brokerage_admin';

  insert into organization_memberships (organization_id, user_id, role_id, is_owner, status)
  values (v_org_id, v_user_id, v_role_id, true, 'active');

  update users set active_organization_id = v_org_id, updated_at = now() where id = v_user_id;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
  values (v_org_id, 'user', v_user_id, 'organization.created', 'organization', v_org_id,
          jsonb_build_object('name', trim(p_name), 'country', p_country, 'currency', p_currency,
                             'timezone', p_timezone));
  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
  values (v_org_id, 'user', v_user_id, 'membership.created', 'membership',
          (select id from organization_memberships where organization_id = v_org_id and user_id = v_user_id),
          jsonb_build_object('user_id', v_user_id, 'role_key', 'brokerage_admin', 'is_owner', true));

  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (v_org_id, 'user.action', 'organization', v_org_id, 'user', v_user_id,
          jsonb_build_object('action', 'organization.created'));

  return v_org_id;
end;
$$;
revoke all on function app.create_organization(text, text, text, text, text, boolean) from public;
grant execute on function app.create_organization(text, text, text, text, text, boolean) to authenticated;

-- Switch the active organization. The API resolves the active organization from this column on
-- every request; the browser can only ask to switch, and only to an organization it belongs to.
create or replace function app.set_active_organization(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if app.current_membership(p_organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  update users set active_organization_id = p_organization_id, updated_at = now()
  where id = v_user_id;
end;
$$;
revoke all on function app.set_active_organization(uuid) from public;
grant execute on function app.set_active_organization(uuid) to authenticated;

-- §7 Step 2 — invite. The API generates the token, emails it, and passes only the hash here.
create or replace function app.create_invitation(
  p_organization_id uuid,
  p_email           text,
  p_role_id         uuid,
  p_token_hash      text,
  p_ttl_hours       integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
  v_email   text := lower(trim(p_email));
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- A denied attempt is audited by the API (recordAudit with result = 'denied'): a row inserted
  -- here would be rolled back together with the exception.
  if not app.has_permission(p_organization_id, 'user', 'create') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if not exists (select 1 from roles where id = p_role_id and organization_id = p_organization_id) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if exists (select 1 from organization_memberships m join users u on u.id = m.user_id
             where m.organization_id = p_organization_id and lower(u.email) = v_email and m.status = 'active') then
    raise exception 'already_a_member' using errcode = '23505';
  end if;
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 24 * 30 then
    raise exception 'invalid_ttl' using errcode = '22023';
  end if;

  -- One live invitation per email per organization (unique index in 0008). Re-inviting replaces
  -- the pending one so a lost email can be resent.
  update invitations set status = 'revoked', updated_at = now()
  where organization_id = p_organization_id and lower(email) = v_email and status = 'pending';

  insert into invitations (organization_id, email, role_id, token_hash, invited_by, expires_at)
  values (p_organization_id, v_email, p_role_id, p_token_hash, v_user_id, now() + make_interval(hours => p_ttl_hours))
  returning id into v_id;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
  values (p_organization_id, 'user', v_user_id, 'invitation.created', 'invitation', v_id,
          jsonb_build_object('email', v_email, 'role_id', p_role_id));
  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (p_organization_id, 'user.action', 'invitation', v_id, 'user', v_user_id,
          jsonb_build_object('action', 'invitation.created'));
  return v_id;
end;
$$;
revoke all on function app.create_invitation(uuid, text, uuid, text, integer) from public;
grant execute on function app.create_invitation(uuid, text, uuid, text, integer) to authenticated;

create or replace function app.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_inv     invitations;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_inv from invitations where id = p_invitation_id;
  if v_inv.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_permission(v_inv.organization_id, 'user', 'create') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation_not_pending' using errcode = '22023';
  end if;
  update invitations set status = 'revoked', updated_at = now() where id = p_invitation_id;
  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, previous_state, new_state)
  values (v_inv.organization_id, 'user', v_user_id, 'invitation.revoked', 'invitation', v_inv.id,
          jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'revoked'));
end;
$$;
revoke all on function app.revoke_invitation(uuid) from public;
grant execute on function app.revoke_invitation(uuid) to authenticated;

-- What the accept page shows before sign-in. Holding the token is the credential; the preview
-- reveals only the brokerage name, the role and the invited address.
create or replace function app.invitation_preview(p_token_hash text)
returns table (organization_name text, role_name text, email text, status text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name, r.name, i.email,
         case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
         i.expires_at
  from invitations i
  join organizations o on o.id = i.organization_id
  join roles r on r.id = i.role_id
  where i.token_hash = p_token_hash;
$$;
revoke all on function app.invitation_preview(text) from public;
grant execute on function app.invitation_preview(text) to anon, authenticated;

-- Accept. Idempotent: accepting the same invitation twice yields one membership. Expired and
-- revoked invitations cannot be accepted. The signed-in user's email must match.
create or replace function app.accept_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id    uuid := auth.uid();
  v_user_email text;
  v_inv        invitations;
  v_membership organization_memberships;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select lower(email) into v_user_email from users where id = v_user_id;

  select * into v_inv from invitations where token_hash = p_token_hash for update;
  if v_inv.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Already accepted by this same user: return the organization, change nothing.
  if v_inv.status = 'accepted' and v_inv.accepted_by = v_user_id then
    return v_inv.organization_id;
  end if;
  if v_inv.status = 'revoked' then
    raise exception 'invitation_revoked' using errcode = '22023';
  end if;
  if v_inv.status = 'expired' or (v_inv.status = 'pending' and v_inv.expires_at < now()) then
    update invitations set status = 'expired', updated_at = now() where id = v_inv.id and status = 'pending';
    raise exception 'invitation_expired' using errcode = '22023';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation_not_pending' using errcode = '22023';
  end if;
  if lower(v_inv.email) <> v_user_email then
    raise exception 'invitation_email_mismatch' using errcode = '42501';
  end if;

  -- A previously removed member being re-invited is reactivated, not duplicated.
  insert into organization_memberships (organization_id, user_id, role_id, status, invited_by)
  values (v_inv.organization_id, v_user_id, v_inv.role_id, 'active', v_inv.invited_by)
  on conflict (organization_id, user_id) do update
    set status = 'active', role_id = excluded.role_id, invited_by = excluded.invited_by,
        joined_at = now(), updated_at = now()
  returning * into v_membership;

  update invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_user_id, updated_at = now()
  where id = v_inv.id;

  update users set active_organization_id = coalesce(active_organization_id, v_inv.organization_id),
                   updated_at = now()
  where id = v_user_id;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, previous_state, new_state)
  values (v_inv.organization_id, 'user', v_user_id, 'invitation.accepted', 'invitation', v_inv.id,
          jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'accepted'));
  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
  values (v_inv.organization_id, 'user', v_user_id, 'membership.created', 'membership', v_membership.id,
          jsonb_build_object('user_id', v_user_id, 'role_id', v_inv.role_id, 'invitation_id', v_inv.id));
  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (v_inv.organization_id, 'user.action', 'membership', v_membership.id, 'user', v_user_id,
          jsonb_build_object('action', 'membership.created'));

  return v_inv.organization_id;
end;
$$;
revoke all on function app.accept_invitation(text) from public;
grant execute on function app.accept_invitation(text) to authenticated;

-- Change a member's role or status (suspend / remove / reactivate). The owner cannot be removed
-- or demoted here; ownership transfer is a later, deliberate flow.
create or replace function app.update_membership(
  p_membership_id uuid,
  p_role_id       uuid,
  p_status        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_old     organization_memberships;
  v_new     organization_memberships;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_old from organization_memberships where id = p_membership_id for update;
  if v_old.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_permission(v_old.organization_id, 'user', 'edit') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_old.is_owner and (p_status is distinct from 'active' or p_role_id is distinct from v_old.role_id) then
    raise exception 'cannot_change_owner' using errcode = '22023';
  end if;
  if v_old.user_id = v_user_id and p_status in ('removed', 'suspended') then
    raise exception 'cannot_remove_self' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'removed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_role_id is not null and not exists (
    select 1 from roles where id = p_role_id and organization_id = v_old.organization_id) then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  update organization_memberships
  set role_id = coalesce(p_role_id, role_id),
      status  = coalesce(p_status, status),
      updated_at = now()
  where id = p_membership_id
  returning * into v_new;

  -- A removed or suspended member loses the active organization immediately.
  if v_new.status <> 'active' then
    update users set active_organization_id = null, updated_at = now()
    where id = v_new.user_id and active_organization_id = v_new.organization_id;
  end if;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, previous_state, new_state)
  values (v_old.organization_id, 'user', v_user_id,
          case when v_new.status = 'removed' then 'membership.removed' else 'membership.updated' end,
          'membership', v_old.id,
          jsonb_build_object('role_id', v_old.role_id, 'status', v_old.status),
          jsonb_build_object('role_id', v_new.role_id, 'status', v_new.status));
  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (v_old.organization_id, 'user.action', 'membership', v_old.id, 'user', v_user_id,
          jsonb_build_object('action', case when v_new.status = 'removed' then 'membership.removed' else 'membership.updated' end));
end;
$$;
revoke all on function app.update_membership(uuid, uuid, text) from public;
grant execute on function app.update_membership(uuid, uuid, text) to authenticated;

-- Workers must not call the membership flows; they run as users. Only the reader helpers.
grant execute on function app.current_membership(uuid) to authenticated, asap_worker;
