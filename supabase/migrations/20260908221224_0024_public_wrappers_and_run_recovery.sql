-- 0024 — Public wrappers for the membership flows; run recovery on boot
--
-- 1. The API reaches the 0014 membership functions through supabase-js `rpc()`, which resolves
--    names in the exposed `public` schema. The functions live in `app`, which is not exposed and
--    must stay that way. Each gets a thin SECURITY INVOKER wrapper in `public` with the same
--    signature and the same grants; the `app` schema is not exposed. Only invitation_preview is
--    reachable by anon, through public; nothing else in `app` is executable by anon (the auth
--    trigger function loses the default PUBLIC grant it never needed).
-- 2. A run records the API process that started it (`boot_token`). On boot the API calls
--    runs_recover(current token): every run still `working` under another token becomes
--    could_not_finish through the same path as run_end, so its work item is created or moved to
--    needs_you in the same transaction (Part 5.4 invariant 2). Recovery runs with no user
--    session, so it is callable by service_role only and audits as actor_type 'system'.

-- ---------------------------------------------------------------------------
-- 1. Public wrappers
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text, p_legal_name text, p_country text, p_currency text, p_timezone text, p_accepted_terms boolean)
returns uuid language sql security invoker set search_path = app, public, pg_temp
as $$ select app.create_organization(p_name, p_legal_name, p_country, p_currency, p_timezone, p_accepted_terms) $$;
revoke all on function public.create_organization(text, text, text, text, text, boolean) from public;
grant execute on function public.create_organization(text, text, text, text, text, boolean) to authenticated;

create or replace function public.set_active_organization(p_organization_id uuid)
returns void language sql security invoker set search_path = app, public, pg_temp
as $$ select app.set_active_organization(p_organization_id) $$;
revoke all on function public.set_active_organization(uuid) from public;
grant execute on function public.set_active_organization(uuid) to authenticated;

create or replace function public.create_invitation(
  p_organization_id uuid, p_email text, p_role_id uuid, p_token_hash text, p_ttl_hours integer)
returns uuid language sql security invoker set search_path = app, public, pg_temp
as $$ select app.create_invitation(p_organization_id, p_email, p_role_id, p_token_hash, p_ttl_hours) $$;
revoke all on function public.create_invitation(uuid, text, uuid, text, integer) from public;
grant execute on function public.create_invitation(uuid, text, uuid, text, integer) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void language sql security invoker set search_path = app, public, pg_temp
as $$ select app.revoke_invitation(p_invitation_id) $$;
revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;

create or replace function public.invitation_preview(p_token_hash text)
returns table (organization_name text, role_name text, email text, status text, expires_at timestamptz)
language sql security invoker set search_path = app, public, pg_temp
as $$ select * from app.invitation_preview(p_token_hash) $$;
revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token_hash text)
returns uuid language sql security invoker set search_path = app, public, pg_temp
as $$ select app.accept_invitation(p_token_hash) $$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.update_membership(p_membership_id uuid, p_role_id uuid, p_status text)
returns void language sql security invoker set search_path = app, public, pg_temp
as $$ select app.update_membership(p_membership_id, p_role_id, p_status) $$;
revoke all on function public.update_membership(uuid, uuid, text) from public;
grant execute on function public.update_membership(uuid, uuid, text) to authenticated;

-- The auth trigger function carried the default PUBLIC execute grant. It runs as the table owner
-- through the trigger; the role that inserts into auth.users needs the grant, nobody else does.
revoke all on function app.handle_new_auth_user() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function app.handle_new_auth_user() to supabase_auth_admin;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Boot token on runs; run_end split so recovery can share it
-- ---------------------------------------------------------------------------
alter table runs add column boot_token text;

drop function public.run_start(uuid, integer, text, jsonb);
create or replace function public.run_start(
  p_work_item_id uuid, p_expected_version integer, p_title text, p_steps jsonb, p_boot_token text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_row  work_items%rowtype;
  v_run  uuid;
begin
  select * into v_row from work_items where id = p_work_item_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_row.organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'version_stale' using errcode = '40001';
  end if;
  if exists (select 1 from runs where work_item_id = p_work_item_id and status = 'working') then
    raise exception 'run_already_working' using errcode = '23505';
  end if;
  insert into runs (organization_id, work_item_id, title, status, started_by, boot_token)
  values (v_row.organization_id, p_work_item_id, p_title, 'working', v_user, p_boot_token)
  returning id into v_run;
  update work_items set steps = p_steps, task_status = 'in_progress', task_party = null, task_since = null,
    version = version + 1, updated_at = now()
  where id = p_work_item_id;
  perform app.engine_audit(v_row.organization_id, v_user, 'run.started', 'run', v_run, null,
                           jsonb_build_object('title', p_title, 'work_item_id', p_work_item_id, 'boot_token', p_boot_token));
  return v_run;
end;
$$;
revoke all on function public.run_start(uuid, integer, text, jsonb, text) from public;
grant execute on function public.run_start(uuid, integer, text, jsonb, text) to authenticated;

-- The body of run_end, without the caller checks, so recovery (no session) can use it.
create or replace function app.run_end_internal(
  p_run_id uuid, p_status text, p_next_step text, p_steps jsonb, p_task_status text, p_task_party text,
  p_actor uuid, p_actor_type text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run  runs%rowtype;
  v_item uuid;
  v_kind text;
begin
  select * into v_run from runs where id = p_run_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_run.status <> 'working' then
    raise exception 'run_not_working' using errcode = '22023';
  end if;
  if p_status not in ('paused', 'finished', 'could_not_finish', 'stopped') then
    raise exception 'invalid_run_status' using errcode = '22023';
  end if;

  update runs set status = p_status, next_step = p_next_step, ended_at = now(), updated_at = now()
  where id = p_run_id;

  v_kind := case p_status when 'finished' then 'finished' when 'paused' then 'paused' else 'error' end;
  insert into run_events (organization_id, run_id, seq, kind, message)
  select v_run.organization_id, p_run_id, coalesce(max(seq), 0) + 1, v_kind, coalesce(p_next_step, v_run.title)
  from run_events where run_id = p_run_id;

  v_item := v_run.work_item_id;
  if v_item is not null then
    if p_status in ('paused', 'could_not_finish', 'stopped') and p_task_status <> 'needs_you' then
      raise exception 'stopped_run_must_need_you' using errcode = '22023';
    end if;
    update work_items set steps = p_steps, task_status = p_task_status, task_party = p_task_party,
      task_since = case when p_task_status = 'with_party' then now() end,
      version = version + 1, updated_at = now()
    where id = v_item;
  elsif p_status in ('paused', 'could_not_finish', 'stopped') then
    insert into work_items (organization_id, title, kind, owner_id, task_status, reason, steps)
    values (v_run.organization_id, v_run.title, 'exception', v_run.started_by, 'needs_you',
            coalesce(p_next_step, 'ASAP could not finish this run.'),
            jsonb_build_array(jsonb_build_object(
              'id', 'check', 'label', coalesce(p_next_step, 'Check this run'), 'actor', 'you',
              'state', 'now', 'guards', '[]'::jsonb, 'evidence', '[]'::jsonb, 'actions', '[]'::jsonb,
              'party', null, 'reason', null, 'recorded', '[]'::jsonb, 'runId', p_run_id)))
    returning id into v_item;
    update runs set work_item_id = v_item where id = p_run_id;
  end if;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, previous_state, new_state)
  values (v_run.organization_id, p_actor_type, p_actor, 'run.' || p_status, 'run', p_run_id,
          jsonb_build_object('status', 'working'),
          jsonb_build_object('status', p_status, 'work_item_id', v_item, 'next_step', p_next_step));
  return v_item;
end;
$$;
revoke all on function app.run_end_internal(uuid, text, text, jsonb, text, text, uuid, text) from public;

create or replace function public.run_end(
  p_run_id uuid, p_status text, p_next_step text, p_steps jsonb, p_task_status text, p_task_party text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_org  uuid;
begin
  select organization_id into v_org from runs where id = p_run_id;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  return app.run_end_internal(p_run_id, p_status, p_next_step, p_steps, p_task_status, p_task_party, v_user, 'user');
end;
$$;

-- Recovery: every run still working under a different (or no) boot token could not finish. The
-- step it was on is blocked with a plain reason; the item needs a person. Returns the run ids.
create or replace function public.runs_recover(p_boot_token text)
returns setof uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r     runs%rowtype;
  v_steps jsonb;
begin
  if p_boot_token is null or length(p_boot_token) = 0 then
    raise exception 'boot_token_required' using errcode = '22023';
  end if;
  for r in
    select * from runs where status = 'working' and boot_token is distinct from p_boot_token
    order by started_at for update skip locked
  loop
    select coalesce(jsonb_agg(
             case when (s ->> 'runId') = r.id::text or (s ->> 'state') = 'now'
                  then s || jsonb_build_object('state', 'blocked', 'runId', r.id,
                                               'reason', 'ASAP was interrupted before finishing this step.')
                  else s end), '[]'::jsonb)
      into v_steps
      from work_items w, jsonb_array_elements(w.steps) s
     where w.id = r.work_item_id;
    perform app.run_end_internal(r.id, 'could_not_finish', 'ASAP was interrupted. Check this item and start again.',
                                 coalesce(v_steps, '[]'::jsonb), 'needs_you', null, null, 'system');
    return next r.id;
  end loop;
end;
$$;
revoke all on function public.runs_recover(text) from public, anon, authenticated, asap_worker;
grant execute on function public.runs_recover(text) to service_role;
