-- 0002 — App schema and helper functions
-- Every RLS policy is built on these four functions. Nothing else decides tenancy.
create schema if not exists app;

-- SQL-language function bodies are validated at creation time, and current_user_orgs() and
-- has_permission() reference tables created by later migrations (0005, 0006). Deferring body
-- validation keeps the migration order of docs/PHASE-1-SCHEMA.md; the bodies are exercised by
-- the RLS suite, and by the seed, on every `supabase db reset`.
set check_function_bodies = off;

-- Organizations the signed-in user actively belongs to.
-- security definer is deliberate: the function reads organization_memberships, which is itself
-- RLS-protected, and would otherwise recurse into its own policy.
create or replace function app.current_user_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.organization_id
  from organization_memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

-- Organization context set by a background worker via
--   select set_config('app.organization_id', '<uuid>', true);
-- Returns null when unset, which every policy treats as "no access".
create or replace function app.worker_org()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.organization_id', true), '')::uuid;
$$;

-- Single predicate used by every tenant policy.
create or replace function app.can_access(org uuid)
returns boolean
language sql
stable
as $$
  select org is not null
     and (org = app.worker_org() or org in (select app.current_user_orgs()));
$$;

-- Permission check for a specific verb on an object type.
create or replace function app.has_permission(org uuid, obj text, verb text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_memberships m
    join role_permissions rp on rp.role_id = m.role_id
    join permissions p on p.id = rp.permission_id
    where m.user_id = auth.uid()
      and m.organization_id = org
      and m.status = 'active'
      and p.object_type = obj
      and p.verb = has_permission.verb
  );
$$;

-- The security definer functions must not be callable by the public role.
revoke all on function app.current_user_orgs() from public;
revoke all on function app.has_permission(uuid, text, text) from public;
grant execute on function app.current_user_orgs() to authenticated, service_role;
grant execute on function app.has_permission(uuid, text, text) to authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;
grant execute on function app.worker_org() to anon, authenticated, service_role;
grant execute on function app.can_access(uuid) to anon, authenticated, service_role;
