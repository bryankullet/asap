-- 0056 — Client conditions, the accepted cover period, and placement writes through the API only.
--
-- Additive to 0055. Four corrections found while verifying 4B-4:
--
-- 1. **A client's condition is not a quotation difference.** "Subject to inspection", "install a
--    tracker", "provide the driver list" are the client's own terms. They are recorded one row
--    per condition, and each is resolved explicitly — confirmed by the insurer, satisfied with
--    evidence, or waived by the client with evidence — or it stays unresolved and blocks issuance.
--    Nothing here names a Kenyan condition: any condition in an accepted instruction works.
-- 2. **An end date can only match what the client accepted.** An instruction may carry an explicit
--    cover period; the cover check derives the exact end from it and shows the calculation. With
--    no accepted end and no accepted period, an insurer's end date is an added term. No default
--    annual term exists anywhere.
-- 3. **Placement records are written by the API, never by a browser session.** The browser holds
--    the anon key and the person's JWT; without this gate it could insert a placement row directly
--    and skip every check the API makes.
-- 4. **A prepared action is decided by the person who prepared it, and never after it expired.**

/* =============================================================================================
 * 1. Client conditions and their resolution.
 * ============================================================================================= */

create table placement_client_conditions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  -- The accepted instruction the condition was stated in.
  client_instruction_id uuid not null references client_instructions(id),
  position          integer not null check (position >= 0),
  condition_text    text not null check (length(btrim(condition_text)) between 3 and 1000),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  constraint placement_client_conditions_one_per_position unique (placement_id, position)
);
create index placement_client_conditions_organization_id_idx on placement_client_conditions (organization_id);
create index placement_client_conditions_placement_id_idx on placement_client_conditions (placement_id);
create index placement_client_conditions_instruction_idx on placement_client_conditions (client_instruction_id);
create index placement_client_conditions_created_by_idx on placement_client_conditions (created_by);

/*
 * How a condition was resolved. No row means unresolved. "Confirmed by insurer" is tied to one
 * insurer answer and lapses if that answer is superseded; "satisfied" and "waived" need a reason
 * and evidence, and a waiver names the new instruction version it produced.
 */
create table client_condition_resolutions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  condition_id      uuid not null references placement_client_conditions(id) on delete cascade,
  resolution        text not null check (resolution in ('confirmed_by_insurer','satisfied','waived')),
  placement_insurer_response_id uuid references placement_insurer_responses(id),
  reason            text,
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  evidence_document_id      uuid references documents(id) on delete set null,
  evidence_note     text,
  resolved_at       timestamptz not null,
  new_client_instruction_id uuid references client_instructions(id),
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  constraint client_condition_resolutions_insurer_names_the_answer check (
    (resolution = 'confirmed_by_insurer') = (placement_insurer_response_id is not null)),
  constraint client_condition_resolutions_waiver_names_the_new_instruction check (
    (resolution = 'waived') = (new_client_instruction_id is not null)),
  constraint client_condition_resolutions_person_gives_reason_and_evidence check (
    resolution = 'confirmed_by_insurer' or (
      reason is not null and length(btrim(reason)) >= 5 and (
        evidence_email_message_id is not null or evidence_document_id is not null
        or (evidence_note is not null and length(btrim(evidence_note)) >= 10))))
);
create unique index client_condition_resolutions_one_final
  on client_condition_resolutions (condition_id) where resolution in ('satisfied','waived');
create unique index client_condition_resolutions_one_per_answer
  on client_condition_resolutions (condition_id, placement_insurer_response_id)
  where resolution = 'confirmed_by_insurer';
create index client_condition_resolutions_organization_id_idx on client_condition_resolutions (organization_id);
create index client_condition_resolutions_placement_id_idx on client_condition_resolutions (placement_id);
create index client_condition_resolutions_condition_id_idx on client_condition_resolutions (condition_id);
create index client_condition_resolutions_response_idx on client_condition_resolutions (placement_insurer_response_id);
create index client_condition_resolutions_evidence_email_idx on client_condition_resolutions (evidence_email_message_id);
create index client_condition_resolutions_evidence_document_idx on client_condition_resolutions (evidence_document_id);
create index client_condition_resolutions_new_instruction_idx on client_condition_resolutions (new_client_instruction_id);
create index client_condition_resolutions_recorded_by_idx on client_condition_resolutions (recorded_by);

/* Every existing placement's conditions, one per non-empty line of its instruction's conditions. */
insert into placement_client_conditions (organization_id, placement_id, client_instruction_id, position,
                                         condition_text, created_by)
select p.organization_id, p.id, ci.id, l.n - 1, btrim(l.line), p.created_by
  from placements p
  join client_instructions ci on ci.id = p.client_instruction_id
  cross join lateral (
    select line, row_number() over () as n
      from regexp_split_to_table(coalesce(ci.client_conditions, ''), E'\n') as line
     where length(btrim(line)) >= 3
  ) l;

/* =============================================================================================
 * 2. The accepted cover period, and the calculation behind a derived match.
 * ============================================================================================= */

alter table client_instructions
  add column requested_period_months integer check (requested_period_months between 0 and 120),
  add column requested_period_days   integer check (requested_period_days between 0 and 400),
  add constraint client_instructions_period_is_a_period check (
    (requested_period_months is null and requested_period_days is null)
    or (coalesce(requested_period_months, 0) + coalesce(requested_period_days, 0) > 0));

alter table placement_basis_versions
  add column period_months integer check (period_months between 0 and 120),
  add column period_days   integer check (period_days between 0 and 400);

alter table cover_match_items add column calculation text;

/* =============================================================================================
 * 3. What happens once a Work item is done — shown on the board, from the server.
 * ============================================================================================= */

alter table work_items add column outcome_after text;

drop function public.work_item_ensure(uuid, text, uuid, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, uuid, uuid, uuid, text);

create function public.work_item_ensure(
  p_organization_id uuid, p_source_type text, p_source_id uuid, p_reason_code text,
  p_kind text, p_title text, p_reason text, p_required_action text, p_evidence_needed text,
  p_outcome_after text,
  p_task_status text, p_task_party text, p_task_since timestamptz, p_task_next_check timestamptz,
  p_owner_id uuid, p_client_id uuid, p_insurer_id uuid, p_class_of_business text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_id uuid;
begin
  if app.current_membership(p_organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if p_owner_id is not null and not exists (
    select 1 from organization_memberships m
     where m.organization_id = p_organization_id and m.user_id = p_owner_id and m.status = 'active')
  then
    raise exception 'owner_not_a_member' using errcode = '42501';
  end if;
  if p_task_status = 'with_party' and (p_task_party is null or p_task_since is null) then
    raise exception 'with_party_needs_party_and_since' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(
    p_organization_id::text || ':' || p_source_type || ':' || p_source_id::text || ':' || p_reason_code));

  select id into v_id from work_items
   where organization_id = p_organization_id and source_type = p_source_type
     and source_id = p_source_id and reason_code = p_reason_code
     and task_status <> 'done' and deleted_at is null
   limit 1;

  if v_id is not null then
    update work_items set
      title = p_title, reason = p_reason, required_action = p_required_action,
      evidence_needed = p_evidence_needed, outcome_after = p_outcome_after,
      task_status = p_task_status, task_party = p_task_party,
      task_since = coalesce(p_task_since, task_since), task_next_check = p_task_next_check,
      owner_id = coalesce(p_owner_id, owner_id), version = version + 1, updated_at = now()
     where id = v_id;
    perform app.engine_audit(p_organization_id, v_user, 'work_item.refreshed', 'work_item', v_id, null,
      jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'reason_code', p_reason_code));
    return jsonb_build_object('id', v_id, 'reopened', true);
  end if;

  insert into work_items (organization_id, title, kind, owner_id, task_status, task_party, task_since,
                          task_next_check, reason, required_action, evidence_needed, outcome_after, steps,
                          client_id, insurer_id, class_of_business, source_type, source_id, reason_code)
  values (p_organization_id, p_title, p_kind, coalesce(p_owner_id, v_user), p_task_status, p_task_party,
          case when p_task_status = 'with_party' then p_task_since else coalesce(p_task_since, now()) end,
          p_task_next_check, p_reason, p_required_action, p_evidence_needed, p_outcome_after, '[]'::jsonb,
          p_client_id, p_insurer_id, p_class_of_business, p_source_type, p_source_id, p_reason_code)
  returning id into v_id;

  perform app.engine_audit(p_organization_id, v_user, 'work_item.created', 'work_item', v_id, null,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'reason_code', p_reason_code));
  return jsonb_build_object('id', v_id, 'reopened', false);
end $$;

revoke all on function public.work_item_ensure(uuid, text, uuid, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.work_item_ensure(uuid, text, uuid, text, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, uuid, uuid, uuid, text) to authenticated, asap_worker;

/* =============================================================================================
 * 4. Placement records: written through the API only.
 *
 * A browser session and the API both reach the database as `authenticated`; only the API carries
 * the server-held key. For those two roles, every insert or update of a placement record requires
 * it. Owner sessions (migrations) and the worker role are not browser sessions and are unaffected.
 * ============================================================================================= */

create or replace function app.placement_writes_through_api()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    perform app.require_api_caller();
  end if;
  return coalesce(new, old);
end $$;
revoke all on function app.placement_writes_through_api() from public;

do $$
declare t text;
begin
  foreach t in array array[
    'client_instructions','placements','placement_basis_terms','placement_requests',
    'placement_request_approvals','placement_submissions','placement_insurer_responses',
    'placement_cancellations','placement_basis_versions','placement_confirmation_terms',
    'cover_match_results','cover_match_items','client_change_acceptances',
    'client_change_acceptance_items','placement_client_conditions','client_condition_resolutions']
  loop
    execute format(
      'create trigger %I before insert or update on %I for each row execute function app.placement_writes_through_api()',
      t || '_through_api', t);
  end loop;
end $$;

/* =============================================================================================
 * 5. Prepared actions: decided by the person who prepared them, and never after they expired.
 * ============================================================================================= */

create or replace function app.prepared_actions_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
begin
  if tg_op = 'INSERT' then
    if new.prepared_by <> v_user or new.state <> 'prepared' or new.decided_by is not null
       or new.decided_at is not null or new.receipt is not null then
      raise exception 'A prepared action is prepared by the caller, and starts undecided.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.state <> 'prepared' then
    raise exception 'This prepared action was already decided.' using errcode = '23514';
  end if;
  if (new.organization_id, new.placement_id, new.opportunity_id, new.action_type, new.payload,
      new.source_versions, new.fingerprint, new.changes, new.blockers, new.permitted,
      new.requires_confirmation, new.idempotency_key, new.prepared_by, new.prepared_at, new.expires_at)
     is distinct from
     (old.organization_id, old.placement_id, old.opportunity_id, old.action_type, old.payload,
      old.source_versions, old.fingerprint, old.changes, old.blockers, old.permitted,
      old.requires_confirmation, old.idempotency_key, old.prepared_by, old.prepared_at, old.expires_at)
  then
    raise exception 'What a prepared action will do cannot be changed. Prepare it again.'
      using errcode = '42501';
  end if;
  /* Somebody else's proposal is theirs to confirm or discard. */
  if new.state <> 'expired' and old.prepared_by <> v_user then
    raise exception 'A prepared action is decided by the person who prepared it.' using errcode = '42501';
  end if;
  if new.decided_by is not null and new.decided_by <> v_user then
    raise exception 'A prepared action is decided by the person deciding it.' using errcode = '42501';
  end if;
  if new.state = 'executed' and old.expires_at <= now() then
    raise exception 'This prepared action expired before it was confirmed.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.prepared_actions_guard() from public;

/* =============================================================================================
 * Tenancy for the new tables.
 * ============================================================================================= */

create or replace function app.client_conditions_are_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'A client condition is part of what was accepted and cannot be changed.'
    using errcode = 'restrict_violation';
end $$;
revoke all on function app.client_conditions_are_immutable() from public;
create trigger placement_client_conditions_immutable
  before update or delete on placement_client_conditions
  for each row execute function app.client_conditions_are_immutable();

alter table placement_client_conditions enable row level security;
alter table client_condition_resolutions enable row level security;

create policy tenant_select on placement_client_conditions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_client_conditions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_select on client_condition_resolutions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on client_condition_resolutions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));

grant select, insert on placement_client_conditions, client_condition_resolutions to authenticated, asap_worker;
revoke update, delete on placement_client_conditions, client_condition_resolutions from authenticated, asap_worker, anon;
revoke all on placement_client_conditions, client_condition_resolutions from anon;

/* =============================================================================================
 * 6. Ask can be opened on quotation work and on a placement.
 *
 * The contract has allowed `opportunity` and `placement` scopes since 4B-3 and 4B-4, but this
 * check still allowed only three, so asking from either screen failed against a real database.
 * Found by the connected lifecycle test; the in-memory stand-in enforced no constraint.
 * ============================================================================================= */

alter table conversations drop constraint conversations_scope_kind_check;
alter table conversations add constraint conversations_scope_kind_check
  check (scope_kind in ('brokerage', 'client', 'record', 'opportunity', 'placement'));
