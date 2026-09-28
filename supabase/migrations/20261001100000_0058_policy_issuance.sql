-- 0058 — Policy issuance (4B-5): from a placement ready for issuance to a verified policy.
--
-- Additive. The lifecycle this records, and refuses to shortcut:
--
--   placement ready → issuance request prepared (a frozen, digested version)
--   → approval of that exact digest → submitted, with evidence of how (never "sent" by a draft)
--   → the insurer's policy document received into the existing document pipeline
--   → its fields and terms reviewed by a person
--   → the issued policy compared, field by field, with the accepted instruction, the frozen
--     placement basis and the insurer's cover confirmation
--   → every material difference resolved with a reason and evidence
--   → a person applies it: one policy and period, created or a named one updated, exactly once
--
-- No second policy system: the application writes the existing `policies`, `policy_versions`
-- and `policy_periods`, and records itself as the evidence link (like 0043's
-- document_applications). Every table here is written through the API only (the 0056 gate).
--
-- Also here, because issuance depends on it:
--   * the accepted basis keeps the end date it derived from an explicit period, and the
--     calculation, frozen with it — and an incorrectly recorded period can be corrected, as a new
--     instruction and basis version, before issuance (D-101, confirmed);
--   * a term read from an issued policy can be reviewed without inventing a quotation term.

/* =============================================================================================
 * 1. The accepted basis: the derived end, frozen; and a corrected period as its own version.
 * ============================================================================================= */

alter table placement_basis_versions
  add column derived_expiry_at timestamptz,
  add column derivation        text,
  add constraint placement_basis_versions_derivation_is_whole check (
    (derived_expiry_at is null) = (derivation is null));

alter table placement_basis_versions drop constraint placement_basis_versions_origin_check;
alter table placement_basis_versions add constraint placement_basis_versions_origin_check
  check (origin in ('instruction', 'client_accepted_changes', 'period_corrected'));

/* =============================================================================================
 * 2. A term read from an issued policy is reviewed for the issued policy, not for a quotation.
 * ============================================================================================= */

alter table document_term_proposals
  add column reviewed_for text not null default 'quotation'
    check (reviewed_for in ('quotation', 'issued_policy'));
alter table document_term_proposals drop constraint document_term_proposals_applied_has_a_term;
alter table document_term_proposals add constraint document_term_proposals_applied_has_a_term
  check (state not in ('accepted', 'corrected') or quote_term_id is not null or reviewed_for = 'issued_policy');

/* =============================================================================================
 * 3. The issuance request, frozen, versioned and digested.
 * ============================================================================================= */

create table issuance_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  version           integer not null check (version >= 1),
  -- Everything the request rests on, frozen: client, insurer, class, placement, instruction,
  -- basis, quote, cover confirmation, dates and their basis, premium, terms, conditions, required
  -- documents, the words of the request and its evidence. Written once.
  payload           jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- Computed by the database from the payload. An approval covers exactly this.
  sha256            text not null check (length(sha256) = 64),
  prepared_by       uuid not null references users(id),
  prepared_at       timestamptz not null default now(),
  superseded_at     timestamptz,
  superseded_reason text,
  constraint issuance_requests_one_per_version unique (placement_id, version),
  constraint issuance_requests_superseded_is_whole check (
    (superseded_at is null) = (superseded_reason is null))
);
create unique index issuance_requests_one_live on issuance_requests (placement_id) where superseded_at is null;
create index issuance_requests_organization_id_idx on issuance_requests (organization_id);
create index issuance_requests_placement_id_idx on issuance_requests (placement_id);
create index issuance_requests_prepared_by_idx on issuance_requests (prepared_by);

create table issuance_request_approvals (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  issuance_request_id uuid not null references issuance_requests(id) on delete cascade,
  sha256              text not null check (length(sha256) = 64),
  approved_by         uuid not null references users(id),
  approved_at         timestamptz not null default now(),
  superseded_at       timestamptz,
  superseded_reason   text,
  constraint issuance_request_approvals_superseded_is_whole check (
    (superseded_at is null) = (superseded_reason is null))
);
create unique index issuance_request_approvals_one_live
  on issuance_request_approvals (issuance_request_id) where superseded_at is null;
create index issuance_request_approvals_organization_id_idx on issuance_request_approvals (organization_id);
create index issuance_request_approvals_request_idx on issuance_request_approvals (issuance_request_id);
create index issuance_request_approvals_approved_by_idx on issuance_request_approvals (approved_by);

/*
 * Sending from ASAP is not connected. A request is submitted only with evidence of how: recorded
 * by a person who sent it themselves, or — the day a provider exists — with the provider's own
 * message id. A draft is never "sent".
 */
create table issuance_submissions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  issuance_request_id uuid not null references issuance_requests(id) on delete cascade,
  sha256              text not null check (length(sha256) = 64),
  method              text not null check (method in
                        ('provider_email','recorded_manual_email','recorded_portal','recorded_post','recorded_in_person')),
  provider_message_id text,
  recipient           text not null check (length(btrim(recipient)) >= 3),
  sent_at             timestamptz not null,
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_note       text,
  recorded_by         uuid not null references users(id),
  recorded_at         timestamptz not null default now(),
  idempotency_key     text not null check (length(btrim(idempotency_key)) between 8 and 200),
  constraint issuance_submissions_one_per_request unique (issuance_request_id),
  constraint issuance_submissions_one_per_key unique (organization_id, idempotency_key),
  constraint issuance_submissions_provider_names_its_message check (
    (method = 'provider_email') = (provider_message_id is not null)),
  constraint issuance_submissions_manual_has_evidence check (
    method = 'provider_email' or evidence_document_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 10))
);
create index issuance_submissions_organization_id_idx on issuance_submissions (organization_id);
create index issuance_submissions_request_idx on issuance_submissions (issuance_request_id);
create index issuance_submissions_evidence_document_idx on issuance_submissions (evidence_document_id);
create index issuance_submissions_recorded_by_idx on issuance_submissions (recorded_by);

/* The digest and version are the database's; a new version supersedes the old and its approval. */
create or replace function app.issuance_request_is_frozen()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.version := coalesce((select max(version) from issuance_requests where placement_id = new.placement_id), 0) + 1;
    new.sha256 := encode(extensions.digest(new.payload::text, 'sha256'), 'hex');
    new.superseded_at := null;
    new.superseded_reason := null;
    update issuance_request_approvals a
       set superseded_at = now(), superseded_reason = 'A new version of the issuance request was prepared.'
      from issuance_requests r
     where a.issuance_request_id = r.id and r.placement_id = new.placement_id
       and a.superseded_at is null and r.superseded_at is null;
    update issuance_requests
       set superseded_at = now(), superseded_reason = 'A new version of the issuance request was prepared.'
     where placement_id = new.placement_id and superseded_at is null;
    return new;
  end if;
  /* After it is written, only its superseding may be recorded, and only once. */
  if (new.organization_id, new.placement_id, new.version, new.payload, new.sha256, new.prepared_by, new.prepared_at)
     is distinct from (old.organization_id, old.placement_id, old.version, old.payload, old.sha256, old.prepared_by, old.prepared_at)
     or old.superseded_at is not null then
    raise exception 'An issuance request is frozen once prepared. Prepare a new version.' using errcode = '23514';
  end if;
  if new.superseded_at is not null then
    update issuance_request_approvals
       set superseded_at = now(), superseded_reason = coalesce(new.superseded_reason, 'The issuance request was superseded.')
     where issuance_request_id = new.id and superseded_at is null;
  end if;
  return new;
end $$;
revoke all on function app.issuance_request_is_frozen() from public;
create trigger issuance_requests_frozen before insert or update on issuance_requests
  for each row execute function app.issuance_request_is_frozen();

create or replace function app.issuance_approval_covers_the_request()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare r issuance_requests;
begin
  if tg_op = 'UPDATE' then
    if (new.issuance_request_id, new.sha256, new.approved_by, new.approved_at)
       is distinct from (old.issuance_request_id, old.sha256, old.approved_by, old.approved_at)
       or old.superseded_at is not null then
      raise exception 'An approval is kept as it was given; only its superseding is recorded.' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into r from issuance_requests where id = new.issuance_request_id;
  if r.id is null or r.superseded_at is not null then
    raise exception 'Only the current version of an issuance request can be approved.' using errcode = '23514';
  end if;
  if new.sha256 <> r.sha256 then
    raise exception 'An approval must cover the exact version it names.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.issuance_approval_covers_the_request() from public;
create trigger issuance_request_approvals_cover before insert or update on issuance_request_approvals
  for each row execute function app.issuance_approval_covers_the_request();

create or replace function app.issuance_submission_needs_live_approval()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from issuance_request_approvals a join issuance_requests r on r.id = a.issuance_request_id
     where a.issuance_request_id = new.issuance_request_id and a.superseded_at is null
       and r.superseded_at is null and a.sha256 = new.sha256 and r.sha256 = new.sha256)
  then
    raise exception 'Only an approved, current issuance request can be recorded as submitted.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.issuance_submission_needs_live_approval() from public;
create trigger issuance_submissions_need_approval before insert on issuance_submissions
  for each row execute function app.issuance_submission_needs_live_approval();

/* =============================================================================================
 * 4. The insurer's policy document, and the check of what it says.
 * ============================================================================================= */

create table issued_policy_documents (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  placement_id        uuid not null references placements(id) on delete cascade,
  document_id         uuid not null references documents(id),
  issuance_request_id uuid references issuance_requests(id),
  received_at         timestamptz not null,
  recorded_by         uuid not null references users(id),
  recorded_at         timestamptz not null default now(),
  note                text,
  constraint issued_policy_documents_once unique (placement_id, document_id)
);
create index issued_policy_documents_organization_id_idx on issued_policy_documents (organization_id);
create index issued_policy_documents_placement_id_idx on issued_policy_documents (placement_id);
create index issued_policy_documents_document_id_idx on issued_policy_documents (document_id);
create index issued_policy_documents_request_idx on issued_policy_documents (issuance_request_id);
create index issued_policy_documents_recorded_by_idx on issued_policy_documents (recorded_by);

/*
 * The issued policy against the three things it must agree with: the client's latest accepted
 * instruction, the frozen placement basis, and the insurer's cover confirmation. Names every
 * input, so a check is current only while all of them are.
 */
create table issued_policy_checks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  placement_id        uuid not null references placements(id) on delete cascade,
  issued_policy_document_id uuid not null references issued_policy_documents(id) on delete cascade,
  client_instruction_id uuid not null references client_instructions(id),
  basis_version_id    uuid not null references placement_basis_versions(id),
  placement_insurer_response_id uuid not null references placement_insurer_responses(id),
  -- A digest of the reviewed fields and terms it compared. A later review makes it stale.
  review_sha256       text not null check (length(review_sha256) = 64),
  compared_by         uuid references users(id),
  compared_at         timestamptz not null default now(),
  material_differences integer not null check (material_differences >= 0),
  unclear_count       integer not null check (unclear_count >= 0)
);
create index issued_policy_checks_organization_id_idx on issued_policy_checks (organization_id);
create index issued_policy_checks_placement_id_idx on issued_policy_checks (placement_id);
create index issued_policy_checks_document_idx on issued_policy_checks (issued_policy_document_id);
create index issued_policy_checks_instruction_idx on issued_policy_checks (client_instruction_id);
create index issued_policy_checks_basis_idx on issued_policy_checks (basis_version_id);
create index issued_policy_checks_response_idx on issued_policy_checks (placement_insurer_response_id);
create index issued_policy_checks_compared_by_idx on issued_policy_checks (compared_by);

create table issued_policy_check_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  issued_policy_check_id uuid not null references issued_policy_checks(id) on delete cascade,
  position            integer not null check (position >= 0),
  field               text not null check (length(btrim(field)) > 0),
  term_type           text,
  label               text not null,
  instruction_value   text,
  basis_value         text,
  confirmation_value  text,
  issued_value        text,
  -- Where the issued value was read: the reviewed field or term, its page and region.
  document_field_id   uuid references document_fields(id) on delete set null,
  document_term_proposal_id uuid references document_term_proposals(id) on delete set null,
  page_number         integer check (page_number is null or page_number >= 1),
  classification      text not null check (classification in
                        ('match','changed','missing_from_issued','added_by_insurer','unclear','not_applicable')),
  material            boolean not null,
  calculation         text,
  constraint issued_policy_check_items_one_per_position unique (issued_policy_check_id, position)
);
create index issued_policy_check_items_organization_id_idx on issued_policy_check_items (organization_id);
create index issued_policy_check_items_check_idx on issued_policy_check_items (issued_policy_check_id);
create index issued_policy_check_items_field_idx on issued_policy_check_items (document_field_id);
create index issued_policy_check_items_term_idx on issued_policy_check_items (document_term_proposal_id);

/*
 * A material difference, resolved by a person with a reason and evidence: the client accepted the
 * issued value, or it is confirmed immaterial. "The insurer will reissue" does not resolve
 * anything — a reissued document is received and checked again.
 */
create table issued_policy_resolutions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  placement_id        uuid not null references placements(id) on delete cascade,
  issued_policy_check_item_id uuid not null references issued_policy_check_items(id) on delete cascade,
  resolution          text not null check (resolution in ('client_accepted_issued_value','confirmed_immaterial')),
  reason              text not null check (length(btrim(reason)) >= 5),
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_note       text,
  resolved_at         timestamptz not null,
  recorded_by         uuid not null references users(id),
  recorded_at         timestamptz not null default now(),
  constraint issued_policy_resolutions_once unique (issued_policy_check_item_id),
  constraint issued_policy_resolutions_evidence check (
    evidence_email_message_id is not null or evidence_document_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 10))
);
create index issued_policy_resolutions_organization_id_idx on issued_policy_resolutions (organization_id);
create index issued_policy_resolutions_placement_id_idx on issued_policy_resolutions (placement_id);
create index issued_policy_resolutions_item_idx on issued_policy_resolutions (issued_policy_check_item_id);
create index issued_policy_resolutions_evidence_email_idx on issued_policy_resolutions (evidence_email_message_id);
create index issued_policy_resolutions_evidence_document_idx on issued_policy_resolutions (evidence_document_id);
create index issued_policy_resolutions_recorded_by_idx on issued_policy_resolutions (recorded_by);

/* =============================================================================================
 * 5. The application: the policy and period, and every link that evidences them. Written once.
 * ============================================================================================= */

create table policy_issuance_applications (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  placement_id        uuid not null references placements(id),
  target_mode         text not null check (target_mode in ('create','update')),
  policy_id           uuid not null references policies(id),
  policy_period_id    uuid not null references policy_periods(id),
  client_instruction_id uuid not null references client_instructions(id),
  basis_version_id    uuid not null references placement_basis_versions(id),
  insurer_response_id uuid not null references insurer_responses(id),
  placement_insurer_response_id uuid not null references placement_insurer_responses(id),
  issued_policy_document_id uuid not null references issued_policy_documents(id),
  document_id         uuid not null references documents(id),
  issued_policy_check_id uuid not null references issued_policy_checks(id),
  issuance_request_id uuid not null references issuance_requests(id),
  -- The receipt: every field written, with the value before, the value after, and where on the
  -- document it was read. What a person was shown and agreed to.
  changes             jsonb not null check (jsonb_typeof(changes) = 'array'),
  applied_by          uuid not null references users(id),
  applied_at          timestamptz not null default now(),
  idempotency_key     text not null check (length(btrim(idempotency_key)) between 8 and 200),
  constraint policy_issuance_applications_one_per_placement unique (placement_id),
  constraint policy_issuance_applications_one_per_key unique (organization_id, idempotency_key)
);
create index policy_issuance_applications_organization_id_idx on policy_issuance_applications (organization_id);
create index policy_issuance_applications_placement_idx on policy_issuance_applications (placement_id);
create index policy_issuance_applications_policy_idx on policy_issuance_applications (policy_id);
create index policy_issuance_applications_period_idx on policy_issuance_applications (policy_period_id);
create index policy_issuance_applications_instruction_idx on policy_issuance_applications (client_instruction_id);
create index policy_issuance_applications_basis_idx on policy_issuance_applications (basis_version_id);
create index policy_issuance_applications_quote_idx on policy_issuance_applications (insurer_response_id);
create index policy_issuance_applications_confirmation_idx on policy_issuance_applications (placement_insurer_response_id);
create index policy_issuance_applications_issued_doc_idx on policy_issuance_applications (issued_policy_document_id);
create index policy_issuance_applications_document_idx on policy_issuance_applications (document_id);
create index policy_issuance_applications_check_idx on policy_issuance_applications (issued_policy_check_id);
create index policy_issuance_applications_request_idx on policy_issuance_applications (issuance_request_id);
create index policy_issuance_applications_applied_by_idx on policy_issuance_applications (applied_by);

/*
 * The one path that writes a policy from an issued placement. SECURITY DEFINER with a fixed
 * search_path, API callers only, the caller a member with `placement:approve`, and every rule
 * re-checked here whatever the service already checked:
 *
 *   * the check is the latest for this placement and no material difference is unresolved;
 *   * the target is named: create a new policy and first period, or update a named policy and
 *     period of the same client — never guessed;
 *   * an update states the values it expects to find, and is refused if the record moved;
 *   * a policy number used by another policy in the brokerage is refused, never merged;
 *   * the same idempotency key, or a second application for the placement, returns the first
 *     receipt and writes nothing.
 */
create or replace function public.policy_issuance_apply(
  p_placement_id    uuid,
  p_check_id        uuid,
  p_request_id      uuid,
  p_mode            text,
  p_policy_id       uuid,
  p_period_id       uuid,
  p_expected        jsonb,
  p_values          jsonb,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := app.require_api_caller();
  v_org       uuid;
  v_client    uuid;
  v_insurer   uuid;
  v_quote     uuid;
  v_check     issued_policy_checks;
  v_latest    uuid;
  v_existing  policy_issuance_applications;
  v_policy    uuid;
  v_period    uuid;
  v_number    text := nullif(btrim(coalesce(p_values ->> 'policy_number', '')), '');
  v_start     date := (p_values ->> 'period_start')::date;
  v_end       date := (p_values ->> 'period_end')::date;
  v_amount    numeric := app.text_to_amount(p_values ->> 'premium');
  v_currency  text := upper(nullif(p_values ->> 'premium_currency', ''));
  v_basis     text := nullif(p_values ->> 'premium_basis', '');
  v_class     text := nullif(btrim(coalesce(p_values ->> 'class_of_business', '')), '');
  v_conflict  uuid;
  v_found     jsonb;
  v_app       uuid;
  v_unresolved integer;
begin
  select p.organization_id, p.client_id, p.insurer_id, ci.insurer_response_id
    into v_org, v_client, v_insurer, v_quote
    from placements p join client_instructions ci on ci.id = p.client_instruction_id
   where p.id = p_placement_id;
  if v_org is null then raise exception 'placement_not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(v_org, 'placement', 'approve') then
    raise exception 'not_permitted' using errcode = '42501';
  end if;

  select * into v_existing from policy_issuance_applications
   where organization_id = v_org and (idempotency_key = p_idempotency_key or placement_id = p_placement_id)
   order by applied_at limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('application_id', v_existing.id, 'policy_id', v_existing.policy_id,
      'policy_period_id', v_existing.policy_period_id, 'target_mode', v_existing.target_mode,
      'changes', v_existing.changes, 'applied_at', v_existing.applied_at, 'repeat', true);
  end if;

  select * into v_check from issued_policy_checks where id = p_check_id and placement_id = p_placement_id;
  if v_check.id is null then raise exception 'check_not_found' using errcode = 'P0002'; end if;
  select id into v_latest from issued_policy_checks where placement_id = p_placement_id
   order by compared_at desc, id desc limit 1;
  if v_latest <> v_check.id then raise exception 'check_not_current' using errcode = '40001'; end if;
  select count(*) into v_unresolved from issued_policy_check_items i
   where i.issued_policy_check_id = v_check.id and i.material
     and not exists (select 1 from issued_policy_resolutions r where r.issued_policy_check_item_id = i.id);
  if v_unresolved > 0 then raise exception 'differences_unresolved' using errcode = '23514'; end if;
  if not exists (select 1 from issuance_submissions s where s.issuance_request_id = p_request_id) then
    raise exception 'request_not_submitted' using errcode = '23514';
  end if;

  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'period_required' using errcode = '22023';
  end if;
  if v_amount is not null and (v_currency is null or v_basis is null) then
    raise exception 'premium_needs_currency_and_basis' using errcode = '22023';
  end if;

  /* A policy number another policy in this brokerage already carries is a conflict, not a merge. */
  if v_number is not null then
    select id into v_conflict from policies
     where organization_id = v_org and deleted_at is null
       and upper(btrim(policy_number)) = upper(v_number)
       and (p_mode = 'create' or id <> p_policy_id)
     limit 1;
    if v_conflict is not null then
      raise exception 'policy_number_conflict: %', v_conflict using errcode = '23505';
    end if;
  end if;

  if p_mode = 'create' then
    if p_policy_id is not null or p_period_id is not null then
      raise exception 'create_takes_no_target' using errcode = '22023';
    end if;
    insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (v_org, v_client, v_insurer, coalesce(v_class, (select class_of_business from opportunities o join placements p on p.opportunity_id = o.id where p.id = p_placement_id)), v_number)
    returning id into v_policy;
    insert into policy_versions (organization_id, policy_id, version, effective_from, effective_to, source, items, created_by)
    values (v_org, v_policy, 1, v_start, v_end, 'placement', '[]'::jsonb, v_user);
    insert into policy_periods (organization_id, policy_id, period_start, period_end)
    values (v_org, v_policy, v_start, v_end) returning id into v_period;
  elsif p_mode = 'update' then
    select p.id into v_policy from policies p
     where p.id = p_policy_id and p.organization_id = v_org and p.client_id = v_client and p.deleted_at is null;
    if v_policy is null then raise exception 'target_not_found' using errcode = 'P0002'; end if;
    select pp.id into v_period from policy_periods pp where pp.id = p_period_id and pp.policy_id = v_policy;
    if v_period is null then raise exception 'target_period_not_found' using errcode = 'P0002'; end if;
    select jsonb_build_object(
             'policy_number', p.policy_number,
             'period_start', pp.period_start::text,
             'period_end', pp.period_end::text,
             'premium', pp.premium_amount::text)
      into v_found
      from policies p join policy_periods pp on pp.policy_id = p.id
     where p.id = v_policy and pp.id = v_period;
    if coalesce(p_expected, '{}'::jsonb) is distinct from v_found then
      raise exception 'stale_target: %', v_found::text using errcode = '40001';
    end if;
    update policies set policy_number = v_number, updated_at = now() where id = v_policy;
    update policy_periods set period_start = v_start, period_end = v_end where id = v_period;
  else
    raise exception 'target_mode_unknown' using errcode = '22023';
  end if;

  if v_amount is not null then
    update policy_periods
       set premium_amount = v_amount, premium_currency = v_currency, premium_basis = v_basis,
           premium_source = 'document', premium_evidence_document_id = (select document_id from issued_policy_documents where id = v_check.issued_policy_document_id),
           premium_verified_at = now()
     where id = v_period;
  end if;

  insert into policy_issuance_applications (organization_id, placement_id, target_mode, policy_id, policy_period_id,
      client_instruction_id, basis_version_id, insurer_response_id, placement_insurer_response_id,
      issued_policy_document_id, document_id, issued_policy_check_id, issuance_request_id,
      changes, applied_by, idempotency_key)
  values (v_org, p_placement_id, p_mode, v_policy, v_period,
      v_check.client_instruction_id, v_check.basis_version_id, v_quote, v_check.placement_insurer_response_id,
      v_check.issued_policy_document_id, (select document_id from issued_policy_documents where id = v_check.issued_policy_document_id),
      v_check.id, p_request_id, coalesce(p_values -> 'changes', '[]'::jsonb), v_user, p_idempotency_key)
  returning id into v_app;

  perform app.engine_audit(v_org, v_user,
    case when p_mode = 'create' then 'policy.issued_from_placement' else 'policy.updated_from_placement' end,
    'policy', v_policy, v_found,
    jsonb_build_object('placement_id', p_placement_id, 'application_id', v_app, 'policy_period_id', v_period,
      'policy_number', v_number, 'period_start', v_start, 'period_end', v_end,
      'issued_policy_check_id', v_check.id));

  return jsonb_build_object('application_id', v_app, 'policy_id', v_policy, 'policy_period_id', v_period,
    'target_mode', p_mode, 'changes', coalesce(p_values -> 'changes', '[]'::jsonb), 'applied_at', now(), 'repeat', false);
end $$;
revoke all on function public.policy_issuance_apply(uuid, uuid, uuid, text, uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.policy_issuance_apply(uuid, uuid, uuid, text, uuid, uuid, jsonb, jsonb, text) to authenticated;

/* =============================================================================================
 * 6. Prepared actions may now be issuance actions.
 * ============================================================================================= */

alter table prepared_actions drop constraint prepared_actions_action_type_check;
alter table prepared_actions add constraint prepared_actions_action_type_check check (action_type in (
  'record_instruction','prepare_request','request_approval','approve_request','record_submission',
  'record_insurer_response','record_client_acceptance','prepare_issuance',
  'prepare_issuance_request','approve_issuance_request','record_issuance_submission',
  'resolve_issued_policy_difference','apply_issued_policy','correct_cover_period'));

/* =============================================================================================
 * Immutability, tenancy, grants, and the API-only gate.
 * ============================================================================================= */

create or replace function app.issuance_records_are_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'This issuance record is evidence and cannot be changed.' using errcode = 'restrict_violation';
end $$;
revoke all on function app.issuance_records_are_immutable() from public;

do $$
declare t text;
begin
  foreach t in array array['issuance_submissions','issued_policy_documents','issued_policy_checks',
                           'issued_policy_check_items','issued_policy_resolutions','policy_issuance_applications']
  loop
    execute format('create trigger %I before update or delete on %I for each row execute function app.issuance_records_are_immutable()',
                   t || '_immutable', t);
  end loop;
  foreach t in array array['issuance_requests','issuance_request_approvals','issuance_submissions','issued_policy_documents',
                           'issued_policy_checks','issued_policy_check_items','issued_policy_resolutions','policy_issuance_applications']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create trigger "000_through_api" before insert or update or delete on %I for each row execute function app.placement_writes_through_api()', t);
    execute format('create policy tenant_select on %I for select to authenticated, asap_worker using (app.can_access(organization_id))', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke delete on %I from authenticated, asap_worker', t);
  end loop;
end $$;

create policy tenant_insert on issuance_requests for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and prepared_by = (select auth.uid()));
create policy tenant_update on issuance_requests for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_insert on issuance_request_approvals for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and approved_by = (select auth.uid()));
create policy tenant_update on issuance_request_approvals for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_insert on issuance_submissions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));
create policy tenant_insert on issued_policy_documents for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));
create policy tenant_insert on issued_policy_checks for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_insert on issued_policy_check_items for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_insert on issued_policy_resolutions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));

grant select, insert, update on issuance_requests, issuance_request_approvals to authenticated, asap_worker;
grant select, insert on issuance_submissions, issued_policy_documents, issued_policy_checks,
  issued_policy_check_items, issued_policy_resolutions to authenticated, asap_worker;
/* Written only by policy_issuance_apply(): read-only to every other role. */
grant select on policy_issuance_applications to authenticated, asap_worker;
