-- 0055 — Work that knows what it is for, cover that is checked against what was agreed, and
-- actions Ask prepares for a person to confirm.
--
-- Four corrections to 4B-4, each closing a gap that would otherwise mislead somebody.
--
-- 1. **Work identity was display text.** The engine deduplicated on title, so two placements whose
--    titles happened to match would share one Work item — and completing one would complete the
--    other's. Work now carries the business identity it is about (source type, source id, reason)
--    and a partial unique index refuses a second open item for the same thing.
--
-- 2. **Work said "Yours" and nothing else.** It now carries the reason, the action required and
--    the evidence needed, as server-owned fields a broker can read without opening Activity.
--
-- 3. **A confirmation was never compared with what the client accepted.** The accepted basis is now
--    versioned, a confirmation carries structured terms, and a cover-match result records, field
--    by field, what matches and what does not — against immutable revisions on both sides.
--
-- 4. **Ask could only describe.** A prepared action is a server-held proposal with the exact
--    source versions it was built from; it executes only when a person confirms it, and only if
--    nothing it rests on has moved.

/* =============================================================================================
 * 1 and 2. Work that knows what it is for.
 * ============================================================================================= */

alter table work_items
  add column source_type     text,
  add column source_id       uuid,
  add column reason_code     text,
  add column required_action text,
  add column evidence_needed text,
  add constraint work_items_source_is_whole check (
    (source_type is null and source_id is null and reason_code is null)
    or (source_type is not null and source_id is not null and reason_code is not null)),
  add constraint work_items_reason_code_shape check (
    reason_code is null or reason_code ~ '^[a-z][a-z_]{2,60}$');

/*
 * The guarantee. One open Work item per thing and reason — whatever its title says. Two
 * placements with identical titles are two sources, so two items; the same placement asking for
 * the same approval twice is one.
 */
create unique index work_items_one_open_per_source_reason
  on work_items (organization_id, source_type, source_id, reason_code)
  where source_id is not null and task_status <> 'done' and deleted_at is null;
create index work_items_source_idx on work_items (organization_id, source_type, source_id);

/*
 * The engine's way in. `work_items` is engine-owned: a signed-in person has no write grant on
 * it (0018, 0023), so this follows the same pattern as `work_item_create` — SECURITY DEFINER,
 * a fixed search_path, API callers only, membership checked, every write audited.
 *
 * Retrying the same blocker refreshes the open item rather than duplicating it: the reason, the
 * party and the dates may have moved, and the item should say so.
 */
create or replace function public.work_item_ensure(
  p_organization_id uuid, p_source_type text, p_source_id uuid, p_reason_code text,
  p_kind text, p_title text, p_reason text, p_required_action text, p_evidence_needed text,
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
  /* Nobody is made responsible for work in a brokerage they do not belong to. */
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
      evidence_needed = p_evidence_needed, task_status = p_task_status, task_party = p_task_party,
      task_since = coalesce(p_task_since, task_since), task_next_check = p_task_next_check,
      owner_id = coalesce(p_owner_id, owner_id), version = version + 1, updated_at = now()
     where id = v_id;
    perform app.engine_audit(p_organization_id, v_user, 'work_item.refreshed', 'work_item', v_id, null,
      jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'reason_code', p_reason_code));
    return jsonb_build_object('id', v_id, 'reopened', true);
  end if;

  insert into work_items (organization_id, title, kind, owner_id, task_status, task_party, task_since,
                          task_next_check, reason, required_action, evidence_needed, steps,
                          client_id, insurer_id, class_of_business, source_type, source_id, reason_code)
  values (p_organization_id, p_title, p_kind, coalesce(p_owner_id, v_user), p_task_status, p_task_party,
          case when p_task_status = 'with_party' then p_task_since else coalesce(p_task_since, now()) end,
          p_task_next_check, p_reason, p_required_action, p_evidence_needed, '[]'::jsonb,
          p_client_id, p_insurer_id, p_class_of_business, p_source_type, p_source_id, p_reason_code)
  returning id into v_id;

  perform app.engine_audit(p_organization_id, v_user, 'work_item.created', 'work_item', v_id, null,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'reason_code', p_reason_code));
  return jsonb_build_object('id', v_id, 'reopened', false);
end $$;

revoke all on function public.work_item_ensure(uuid, text, uuid, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.work_item_ensure(uuid, text, uuid, text, text, text, text, text, text,
  text, text, timestamptz, timestamptz, uuid, uuid, uuid, text) to authenticated, asap_worker;

/*
 * Resolving a blocker completes exactly the item for that source and reason — never another
 * placement's, never a different reason on the same placement.
 */
create or replace function public.work_item_resolve(
  p_organization_id uuid, p_source_type text, p_source_id uuid, p_reason_code text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_id uuid;
  v_count integer := 0;
begin
  if app.current_membership(p_organization_id) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  for v_id in
    update work_items set task_status = 'done', task_party = null, completed_at = now(),
                          version = version + 1, updated_at = now()
     where organization_id = p_organization_id and source_type = p_source_type
       and source_id = p_source_id and reason_code = p_reason_code
       and task_status <> 'done' and deleted_at is null
    returning id
  loop
    v_count := v_count + 1;
    perform app.engine_audit(p_organization_id, v_user, 'work_item.resolved', 'work_item', v_id, null,
      jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'reason_code', p_reason_code));
  end loop;
  return v_count;
end $$;

revoke all on function public.work_item_resolve(uuid, text, uuid, text) from public, anon;
grant execute on function public.work_item_resolve(uuid, text, uuid, text) to authenticated, asap_worker;

/* =============================================================================================
 * 3. What the client accepted, as versions — and what the insurer confirmed, as structure.
 * ============================================================================================= */

/*
 * The accepted basis, versioned. Version 1 is what the client instructed; a later version exists
 * only where the client accepted an insurer's changes, and it never overwrites the earlier one.
 */
create table placement_basis_versions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  version           integer not null check (version >= 1),
  client_instruction_id uuid not null references client_instructions(id),
  insurer_id        uuid not null references insurers(id),
  class_of_business text,
  subject           text,
  effective_at      timestamptz,
  expiry_at         timestamptz,
  premium_amount    numeric(14,2),
  premium_currency  text,
  premium_basis     text,
  client_conditions text,
  outstanding_requirements text,
  -- Why this version exists: the original instruction, or a client accepting changes.
  origin            text not null check (origin in ('instruction','client_accepted_changes')),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  constraint placement_basis_versions_one_per_version unique (placement_id, version)
);
create index placement_basis_versions_organization_id_idx on placement_basis_versions (organization_id);
create index placement_basis_versions_placement_id_idx on placement_basis_versions (placement_id);
create index placement_basis_versions_client_instruction_id_idx on placement_basis_versions (client_instruction_id);
create index placement_basis_versions_insurer_id_idx on placement_basis_versions (insurer_id);
create index placement_basis_versions_created_by_idx on placement_basis_versions (created_by);

alter table placement_basis_terms
  add column basis_version_id uuid references placement_basis_versions(id);
create index placement_basis_terms_basis_version_id_idx on placement_basis_terms (basis_version_id);
/* A term copied from an insurer confirmation has no quote revision behind it. */
alter table placement_basis_terms alter column quote_term_revision_id drop not null;
alter table placement_basis_terms drop constraint placement_basis_terms_one_per_revision;
create unique index placement_basis_terms_one_per_version_term
  on placement_basis_terms (basis_version_id, term_type, label) where basis_version_id is not null;

/* Every existing placement gets its version 1, and its terms are attached to it. */
insert into placement_basis_versions (organization_id, placement_id, version, client_instruction_id,
  insurer_id, class_of_business, effective_at, expiry_at, premium_amount, premium_currency,
  client_conditions, origin, created_by)
select p.organization_id, p.id, 1, p.client_instruction_id, p.insurer_id, o.class_of_business,
       p.requested_effective_at, p.requested_expiry_at, p.basis_premium_amount, p.basis_premium_currency,
       ci.client_conditions, 'instruction', p.created_by
  from placements p
  join opportunities o on o.id = p.opportunity_id
  join client_instructions ci on ci.id = p.client_instruction_id;
update placement_basis_terms t set basis_version_id = v.id
  from placement_basis_versions v where v.placement_id = t.placement_id and v.version = 1;

/* The response-level confirmed facts, beside the words the insurer used. */
alter table placement_insurer_responses
  add column confirmed_insurer_name     text,
  add column confirmed_class_of_business text,
  add column confirmed_subject          text,
  add column confirmed_premium_amount   numeric(14,2),
  add column confirmed_premium_currency text,
  add column confirmed_premium_basis    text;

/* The terms the insurer confirmed, one row each. Immutable: a correction is a new response. */
create table placement_confirmation_terms (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_insurer_response_id uuid not null references placement_insurer_responses(id) on delete cascade,
  term_type         text not null check (term_type in
                      ('excess','limit','condition','exclusion','benefit','levy','tax','subjectivity','other')),
  label             text not null check (length(btrim(label)) > 0),
  value             text,
  amount            numeric(14,2),
  currency          text,
  unclear           boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint placement_confirmation_terms_one_per_term unique (placement_insurer_response_id, term_type, label)
);
create index placement_confirmation_terms_organization_id_idx on placement_confirmation_terms (organization_id);
create index placement_confirmation_terms_response_idx on placement_confirmation_terms (placement_insurer_response_id);

/* ---------------------------------------------------------------------------------------------
 * The cover match: the confirmation against the accepted basis, field by field.
 *
 * It names the two exact inputs it compared. A newer basis version or a newer insurer answer
 * makes it stale — derived by comparing ids, so nothing has to remember to mark it.
 */
create table cover_match_results (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  basis_version_id  uuid not null references placement_basis_versions(id),
  placement_insurer_response_id uuid not null references placement_insurer_responses(id),
  -- Null when the system compared it on recording the confirmation; a person when asked.
  compared_by       uuid references users(id),
  compared_at       timestamptz not null default now(),
  material_differences integer not null default 0 check (material_differences >= 0),
  unclear_count     integer not null default 0 check (unclear_count >= 0)
);
create index cover_match_results_organization_id_idx on cover_match_results (organization_id);
create index cover_match_results_placement_id_idx on cover_match_results (placement_id);
create index cover_match_results_basis_version_id_idx on cover_match_results (basis_version_id);
create index cover_match_results_response_idx on cover_match_results (placement_insurer_response_id);
create index cover_match_results_compared_by_idx on cover_match_results (compared_by);

create table cover_match_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  cover_match_result_id uuid not null references cover_match_results(id) on delete cascade,
  field             text not null check (length(btrim(field)) > 0),
  term_type         text,
  label             text not null,
  accepted_value    text,
  confirmed_value   text,
  classification    text not null check (classification in
                      ('match','changed','missing_from_confirmation','added_by_insurer','unclear','not_applicable')),
  material          boolean not null default false,
  position          integer not null default 0,
  constraint cover_match_items_one_per_position unique (cover_match_result_id, position)
);
create index cover_match_items_organization_id_idx on cover_match_items (organization_id);
create index cover_match_items_result_idx on cover_match_items (cover_match_result_id);

/* =============================================================================================
 * The client's answer to an insurer's changes.
 * ============================================================================================= */

alter table client_instructions
  add column revises_instruction_id uuid references client_instructions(id);
create index client_instructions_revises_instruction_id_idx on client_instructions (revises_instruction_id);

create table client_change_acceptances (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  placement_insurer_response_id uuid not null references placement_insurer_responses(id),
  cover_match_result_id uuid not null references cover_match_results(id),
  decision          text not null check (decision in ('accept_all','reject','partial')),
  source            text not null check (source in
                      ('email','document','telephone','meeting','signed_acceptance','in_person')),
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  evidence_document_id      uuid references documents(id) on delete set null,
  evidence_note     text,
  decided_at        timestamptz not null,
  -- Set when acceptance produced a new instruction revision and basis version.
  new_client_instruction_id uuid references client_instructions(id),
  new_basis_version_id      uuid references placement_basis_versions(id),
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  constraint client_change_acceptances_evidence_is_required check (
    evidence_email_message_id is not null or evidence_document_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 10)),
  /* Only a full acceptance changes what was agreed. A partial one never does. */
  constraint client_change_acceptances_only_full_changes_the_basis check (
    decision = 'accept_all' or (new_client_instruction_id is null and new_basis_version_id is null)),
  constraint client_change_acceptances_one_per_match unique (cover_match_result_id)
);
create index client_change_acceptances_organization_id_idx on client_change_acceptances (organization_id);
create index client_change_acceptances_placement_id_idx on client_change_acceptances (placement_id);
create index client_change_acceptances_client_id_idx on client_change_acceptances (client_id);
create index client_change_acceptances_response_idx on client_change_acceptances (placement_insurer_response_id);
create index client_change_acceptances_match_idx on client_change_acceptances (cover_match_result_id);
create index client_change_acceptances_evidence_email_idx on client_change_acceptances (evidence_email_message_id);
create index client_change_acceptances_evidence_document_idx on client_change_acceptances (evidence_document_id);
create index client_change_acceptances_new_instruction_idx on client_change_acceptances (new_client_instruction_id);
create index client_change_acceptances_new_basis_idx on client_change_acceptances (new_basis_version_id);
create index client_change_acceptances_recorded_by_idx on client_change_acceptances (recorded_by);

create table client_change_acceptance_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  client_change_acceptance_id uuid not null references client_change_acceptances(id) on delete cascade,
  cover_match_item_id uuid not null references cover_match_items(id),
  decision          text not null check (decision in ('accepted','rejected','clarify')),
  constraint client_change_acceptance_items_one_per_item unique (client_change_acceptance_id, cover_match_item_id)
);
create index client_change_acceptance_items_organization_id_idx on client_change_acceptance_items (organization_id);
create index client_change_acceptance_items_acceptance_idx on client_change_acceptance_items (client_change_acceptance_id);
create index client_change_acceptance_items_match_item_idx on client_change_acceptance_items (cover_match_item_id);

/* =============================================================================================
 * 4. What Ask prepared, held on the server until a person confirms it.
 * ============================================================================================= */

create table prepared_actions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  -- Null only for an instruction, which is what creates the placement.
  placement_id      uuid references placements(id) on delete cascade,
  opportunity_id    uuid references opportunities(id) on delete cascade,
  action_type       text not null check (action_type in
                      ('record_instruction','prepare_request','request_approval','approve_request',
                       'record_submission','record_insurer_response','record_client_acceptance',
                       'prepare_issuance')),
  -- The exact typed action that will run. Validated against the contract before it is stored.
  payload           jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- The source versions it was built from, and a digest of them. Moving any one makes it stale.
  source_versions   jsonb not null check (jsonb_typeof(source_versions) = 'object'),
  fingerprint       text not null check (length(fingerprint) = 64),
  -- What will change, in words, for the confirmation panel. Composed by the server, not a model.
  changes           jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  blockers          jsonb not null default '[]'::jsonb check (jsonb_typeof(blockers) = 'array'),
  permitted         boolean not null,
  requires_confirmation boolean not null default true,
  idempotency_key   text not null check (length(btrim(idempotency_key)) between 8 and 200),
  state             text not null default 'prepared'
                      check (state in ('prepared','executed','stale','refused','discarded','expired')),
  prepared_by       uuid not null references users(id),
  prepared_at       timestamptz not null default now(),
  expires_at        timestamptz not null,
  decided_by        uuid references users(id),
  decided_at        timestamptz,
  receipt           jsonb,
  constraint prepared_actions_one_per_key unique (organization_id, idempotency_key),
  constraint prepared_actions_has_a_subject check (placement_id is not null or opportunity_id is not null),
  constraint prepared_actions_decision_is_whole check (
    state in ('prepared','expired') or (decided_by is not null and decided_at is not null)),
  constraint prepared_actions_executed_has_receipt check (state <> 'executed' or receipt is not null)
);
create index prepared_actions_organization_id_idx on prepared_actions (organization_id);
create index prepared_actions_placement_id_idx on prepared_actions (placement_id);
create index prepared_actions_opportunity_id_idx on prepared_actions (opportunity_id);
create index prepared_actions_prepared_by_idx on prepared_actions (prepared_by);
create index prepared_actions_decided_by_idx on prepared_actions (decided_by);

/* =============================================================================================
 * Immutability and tenancy.
 * ============================================================================================= */

create or replace function app.basis_versions_are_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'An accepted basis version records what was agreed and cannot be changed.'
    using errcode = 'restrict_violation';
end $$;
revoke all on function app.basis_versions_are_immutable() from public;

create trigger placement_basis_versions_immutable
  before update or delete on placement_basis_versions
  for each row execute function app.basis_versions_are_immutable();

/*
 * A prepared action is written only by the API, on behalf of the signed-in person — never by the
 * browser with its own session. What it will do cannot be edited after it is prepared; it moves
 * only out of `prepared`, once; and whoever decides it is the caller. Without this, anyone in the
 * brokerage could rewrite a colleague's prepared action before they confirmed it.
 */
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
  if new.decided_by is not null and new.decided_by <> v_user then
    raise exception 'A prepared action is decided by the person deciding it.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app.prepared_actions_guard() from public;

create trigger prepared_actions_guard
  before insert or update on prepared_actions
  for each row execute function app.prepared_actions_guard();

alter table placement_basis_versions enable row level security;
alter table placement_confirmation_terms enable row level security;
alter table cover_match_results enable row level security;
alter table cover_match_items enable row level security;
alter table client_change_acceptances enable row level security;
alter table client_change_acceptance_items enable row level security;
alter table prepared_actions enable row level security;

create policy tenant_select on placement_basis_versions for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on placement_basis_versions for insert to authenticated, asap_worker with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_select on placement_confirmation_terms for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on placement_confirmation_terms for insert to authenticated, asap_worker with check (app.can_access(organization_id));
create policy tenant_select on cover_match_results for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on cover_match_results for insert to authenticated, asap_worker with check (app.can_access(organization_id));
create policy tenant_select on cover_match_items for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on cover_match_items for insert to authenticated, asap_worker with check (app.can_access(organization_id));
create policy tenant_select on client_change_acceptances for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on client_change_acceptances for insert to authenticated, asap_worker with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));
create policy tenant_select on client_change_acceptance_items for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on client_change_acceptance_items for insert to authenticated, asap_worker with check (app.can_access(organization_id));
create policy tenant_select on prepared_actions for select to authenticated, asap_worker using (app.can_access(organization_id));
create policy tenant_insert on prepared_actions for insert to authenticated, asap_worker with check (app.can_access(organization_id) and prepared_by = (select auth.uid()));
create policy tenant_update on prepared_actions for update to authenticated, asap_worker using (app.can_access(organization_id)) with check (app.can_access(organization_id));

grant select, insert on placement_basis_versions, placement_confirmation_terms, cover_match_results,
  cover_match_items, client_change_acceptances, client_change_acceptance_items to authenticated, asap_worker;
grant select, insert, update on prepared_actions to authenticated, asap_worker;
revoke update, delete on placement_basis_versions, placement_confirmation_terms, cover_match_results,
  cover_match_items, client_change_acceptances, client_change_acceptance_items from asap_worker, authenticated;
revoke delete on prepared_actions from asap_worker, authenticated;
