-- 0023 — UI Build Spec v1 Phase 2: the work item engine's database half
--
-- 0022 made work_items and runs readable. This migration gives them their engine:
--   1. Writes happen only through the functions below. Tables keep SELECT-only grants for
--      `authenticated`; the functions are SECURITY DEFINER and refuse any caller that is not the
--      ASAP API (app.require_api_caller: a per-deployment key in a request header, stored hashed).
--      The web app therefore cannot write a work item, a run or a draft except via the API, which
--      evaluates guards and re-checks them here at execution time (spec Part 5.3, Part 1.2).
--   2. Runs are never the only place something lives: run_end() writes the run outcome and the
--      work item's steps and task in one transaction, and creates a work item when a run that
--      paused or could not finish has none (Part 5.4 invariant 2, Part 8).
--   3. Drafts: sent_at and sent_evidence exist together or not at all (Part 7), at the row.
--   4. Task status is passed in by the API, which derives it from the steps (Architecture §45
--      rule 10); the 0022 row constraints still refuse with_party without a party and a since.
--   5. Every function writes its own audit row.

-- ---------------------------------------------------------------------------
-- 1. API caller gate
-- ---------------------------------------------------------------------------
create table app.api_keys (
  key_hash    text primary key,
  label       text not null default 'api',
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
revoke all on app.api_keys from public, anon, authenticated, asap_worker;

-- True when the request carried x-asap-api-key whose sha256 matches an unrevoked key.
-- PostgREST exposes request headers as the `request.headers` setting.
create or replace function app.is_api_caller()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_key     text;
begin
  if v_headers is null or v_headers = '' then return false; end if;
  v_key := (v_headers::json ->> 'x-asap-api-key');
  if v_key is null or v_key = '' then return false; end if;
  return exists (
    select 1 from app.api_keys k
    where k.key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex') and k.revoked_at is null);
end;
$$;

create or replace function app.require_api_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not app.is_api_caller() then
    raise exception 'api_only' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function app.is_api_caller() from public;
revoke all on function app.require_api_caller() from public;

-- ---------------------------------------------------------------------------
-- 2. Columns and tables
-- ---------------------------------------------------------------------------
alter table work_items
  add column exception jsonb check (exception is null or jsonb_typeof(exception) = 'object'),
  add column version integer not null default 1;

create table run_events (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references organizations(id) on delete cascade,
  run_id           uuid not null references runs(id) on delete cascade,
  seq              integer not null,
  kind             text not null check (kind in ('step','paused','finished','error')),
  message          text not null,
  created_at       timestamptz not null default now(),
  constraint run_events_run_id_seq_key unique (run_id, seq)
);
create index run_events_organization_id_idx on run_events (organization_id);

create table drafts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  work_item_id     uuid not null references work_items(id) on delete cascade,
  step_id          text not null,
  to_address       text not null default '',
  subject          text not null default '',
  body             text not null default '',
  copied_at        timestamptz,
  sent_at          timestamptz,
  sent_evidence    text,
  outcome_unknown  boolean not null default false,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Part 7: sentAt may only be set together with sentEvidence.
  constraint drafts_sent_needs_evidence check (
    (sent_at is null and sent_evidence is null) or
    (sent_at is not null and sent_evidence is not null and length(btrim(sent_evidence)) > 0))
);
create index drafts_organization_id_idx on drafts (organization_id);
create index drafts_work_item_id_idx on drafts (work_item_id);
create index drafts_created_by_idx on drafts (created_by);

alter table run_events enable row level security;
alter table drafts enable row level security;

create policy tenant_read on run_events for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on run_events for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_delete on run_events for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

create policy tenant_read on drafts for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on drafts for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on drafts for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on drafts for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

grant select on run_events, drafts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function app.engine_audit(
  p_org uuid, p_user uuid, p_action text, p_object_type text, p_object_id uuid,
  p_previous jsonb, p_new jsonb, p_result text default 'success', p_failure text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id,
                         previous_state, new_state, result, failure_reason)
  values (p_org, 'user', p_user, p_action, p_object_type, p_object_id, p_previous, p_new, p_result, p_failure);
$$;
revoke all on function app.engine_audit(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text) from public;

-- ---------------------------------------------------------------------------
-- 4. Work items
-- ---------------------------------------------------------------------------

-- Creates a work item, or returns the open one with the same kind and title in the same
-- brokerage (Part 5.4 invariant 1: asking twice reopens the same item). Returns {id, reopened}.
create or replace function public.work_item_create(
  p_organization_id uuid, p_kind text, p_title text, p_client_name text, p_steps jsonb,
  p_task_status text, p_task_party text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_id   uuid;
begin
  if app.current_membership(p_organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- no_duplicate_open, atomically
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_kind || ':' || p_title));
  select id into v_id from work_items
   where organization_id = p_organization_id and kind = p_kind and title = p_title
     and task_status <> 'done' and exception is null and deleted_at is null
   limit 1;
  if v_id is not null then
    perform app.engine_audit(p_organization_id, v_user, 'work_item.reopened', 'work_item', v_id, null,
                             jsonb_build_object('title', p_title));
    return jsonb_build_object('id', v_id, 'reopened', true);
  end if;
  insert into work_items (organization_id, title, kind, owner_id, task_status, task_party, task_since,
                          reason, steps)
  values (p_organization_id, p_title, p_kind, v_user, p_task_status, p_task_party,
          case when p_task_status = 'with_party' then now() end,
          'Opened from Ask for ' || p_client_name || '.', p_steps)
  returning id into v_id;
  perform app.engine_audit(p_organization_id, v_user, 'work_item.created', 'work_item', v_id, null,
                           jsonb_build_object('title', p_title, 'kind', p_kind));
  return jsonb_build_object('id', v_id, 'reopened', false);
end;
$$;
revoke all on function public.work_item_create(uuid, text, text, text, jsonb, text, text) from public;
grant execute on function public.work_item_create(uuid, text, text, text, jsonb, text, text) to authenticated;

-- Applies an engine result. Compare-and-swap on version: a stale version raises version_stale,
-- which the API reports as the version_current guard failing.
create or replace function public.work_item_apply(
  p_id uuid, p_expected_version integer, p_steps jsonb,
  p_task_status text, p_task_party text, p_task_since timestamptz, p_task_next_check timestamptz,
  p_cover_status text, p_money_status text, p_exception jsonb, p_completed_at timestamptz,
  p_audit_action text, p_audit_new_state jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_row  work_items%rowtype;
begin
  select * into v_row from work_items where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_row.organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'version_stale' using errcode = '40001';
  end if;
  update work_items set
    steps = p_steps, task_status = p_task_status, task_party = p_task_party, task_since = p_task_since,
    task_next_check = p_task_next_check, cover_status = p_cover_status, money_status = p_money_status,
    exception = p_exception, completed_at = p_completed_at, version = version + 1, updated_at = now()
  where id = p_id;
  perform app.engine_audit(v_row.organization_id, v_user, p_audit_action, 'work_item', p_id,
                           jsonb_build_object('task_status', v_row.task_status, 'version', v_row.version),
                           p_audit_new_state);
  return v_row.version + 1;
end;
$$;
revoke all on function public.work_item_apply(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text, text, jsonb, timestamptz, text, jsonb) from public;
grant execute on function public.work_item_apply(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text, text, jsonb, timestamptz, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Runs
-- ---------------------------------------------------------------------------
create or replace function public.run_start(
  p_work_item_id uuid, p_expected_version integer, p_title text, p_steps jsonb)
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
  insert into runs (organization_id, work_item_id, title, status, started_by)
  values (v_row.organization_id, p_work_item_id, p_title, 'working', v_user)
  returning id into v_run;
  update work_items set steps = p_steps, task_status = 'in_progress', task_party = null, task_since = null,
    version = version + 1, updated_at = now()
  where id = p_work_item_id;
  perform app.engine_audit(v_row.organization_id, v_user, 'run.started', 'run', v_run, null,
                           jsonb_build_object('title', p_title, 'work_item_id', p_work_item_id));
  return v_run;
end;
$$;
revoke all on function public.run_start(uuid, integer, text, jsonb) from public;
grant execute on function public.run_start(uuid, integer, text, jsonb) to authenticated;

create or replace function public.run_event_append(p_run_id uuid, p_kind text, p_message text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_run  runs%rowtype;
  v_seq  integer;
begin
  select * into v_run from runs where id = p_run_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_run.organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from run_events where run_id = p_run_id;
  insert into run_events (organization_id, run_id, seq, kind, message)
  values (v_run.organization_id, p_run_id, v_seq, p_kind, p_message);
  return v_seq;
end;
$$;
revoke all on function public.run_event_append(uuid, text, text) from public;
grant execute on function public.run_event_append(uuid, text, text) to authenticated;

-- Ends a run and writes its consequence for the work item in the same transaction. A run that
-- paused or could not finish leaves a work item in needs_you; if it had none, one is created.
create or replace function public.run_end(
  p_run_id uuid, p_status text, p_next_step text,
  p_steps jsonb, p_task_status text, p_task_party text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_run  runs%rowtype;
  v_item uuid;
  v_kind text;
begin
  select * into v_run from runs where id = p_run_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_run.organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
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
  select v_run.organization_id, p_run_id, coalesce(max(seq), 0) + 1, v_kind,
         coalesce(p_next_step, v_run.title)
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
    -- The prototype's "missing-record" case: a run with no work item still lands with a person.
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

  perform app.engine_audit(v_run.organization_id, v_user, 'run.' || p_status, 'run', p_run_id,
                           jsonb_build_object('status', 'working'),
                           jsonb_build_object('status', p_status, 'work_item_id', v_item, 'next_step', p_next_step));
  return v_item;
end;
$$;
revoke all on function public.run_end(uuid, text, text, jsonb, text, text) from public;
grant execute on function public.run_end(uuid, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Drafts
-- ---------------------------------------------------------------------------
create or replace function public.draft_create(
  p_work_item_id uuid, p_step_id text, p_to text, p_subject text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_org  uuid;
  v_id   uuid;
begin
  select organization_id into v_org from work_items where id = p_work_item_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  insert into drafts (organization_id, work_item_id, step_id, to_address, subject, body, created_by)
  values (v_org, p_work_item_id, p_step_id, p_to, p_subject, p_body, v_user)
  returning id into v_id;
  perform app.engine_audit(v_org, v_user, 'draft.created', 'draft', v_id, null,
                           jsonb_build_object('work_item_id', p_work_item_id, 'step_id', p_step_id, 'to', p_to));
  return v_id;
end;
$$;
revoke all on function public.draft_create(uuid, text, text, text, text) from public;
grant execute on function public.draft_create(uuid, text, text, text, text) to authenticated;

-- Copying advances nothing. It is a fact about the draft.
create or replace function public.draft_mark_copied(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_org  uuid;
begin
  select organization_id into v_org from drafts where id = p_id;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  update drafts set copied_at = coalesce(copied_at, now()), updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.draft_mark_copied(uuid) from public;
grant execute on function public.draft_mark_copied(uuid) to authenticated;

-- A send is recorded only by a person, with evidence. Empty evidence is refused before the row
-- constraint would refuse it, with a token the API can name.
create or replace function public.draft_record_send(p_id uuid, p_evidence text, p_outcome_unknown boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_row  drafts%rowtype;
begin
  select * into v_row from drafts where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_row.organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p_evidence is null or length(btrim(p_evidence)) = 0 then
    raise exception 'evidence_required' using errcode = '22023';
  end if;
  if v_row.sent_at is not null then
    raise exception 'already_sent' using errcode = '23505';
  end if;
  update drafts set sent_at = now(), sent_evidence = btrim(p_evidence),
    outcome_unknown = coalesce(p_outcome_unknown, false), updated_at = now()
  where id = p_id;
  perform app.engine_audit(v_row.organization_id, v_user, 'External send recorded by human', 'draft', p_id,
                           jsonb_build_object('sent_at', null),
                           jsonb_build_object('to', v_row.to_address, 'evidence', btrim(p_evidence),
                                              'outcome_unknown', coalesce(p_outcome_unknown, false)));
end;
$$;
revoke all on function public.draft_record_send(uuid, text, boolean) from public;
grant execute on function public.draft_record_send(uuid, text, boolean) to authenticated;
