-- 0028 — UI Build Spec Phase 5a: policies with effective-dated versions, claims, endorsements
--
-- Part 6.6 (claims) and 6.3 (endorsements). Rules enforced here, not only in the interface:
--   - policy_periods is the thin client-policy-year table decided in D-029 (option B).
--   - A confirmed endorsement creates a new policy version effective on its date and keeps the
--     old row; the current version is whichever is effective on a day. Rejected items are written
--     into the new version as uncovered and visible.
--   - A claim from email is created as a draft. Only claim_register(), by a person choosing a
--     policy period, makes it registered.
--   - The notification clock needs a wording clause (with page and days) and a verified start
--     event (with date and evidence) together; claim_set_clock refuses anything less.
--   - A call note is a note (claim_notes.kind = 'call_note'); nothing can store it as the
--     insurer's response (claims.insurer_reference and the response step take a document).
--   - Settlement offered, client accepted and payment received are three column pairs, written
--     by claim_fact_record() one at a time; no function writes more than one.
--   - Transfer of ownership: endorsement_apply refuses unless the policyholder's own instruction
--     is on record.
-- Grants: SELECT for authenticated; every write through an API-gated function (D-042).

create table policies (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  client_id          uuid not null references clients(id),
  insurer_id         uuid not null references insurers(id),
  class_of_business  text not null check (length(btrim(class_of_business)) > 0),
  policy_number      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index policies_organization_id_idx on policies (organization_id);
create index policies_client_id_idx on policies (client_id);
create index policies_insurer_id_idx on policies (insurer_id);

-- D-029 option B: the thin client-policy-year. Nothing else lives here.
create table policy_periods (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  policy_id        uuid not null references policies(id) on delete cascade,
  period_start     date not null,
  period_end       date not null check (period_end >= period_start),
  created_at       timestamptz not null default now()
);
create index policy_periods_organization_id_idx on policy_periods (organization_id);
create index policy_periods_policy_id_idx on policy_periods (policy_id);

create table policy_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  policy_id        uuid not null references policies(id) on delete cascade,
  version          integer not null check (version >= 1),
  effective_from   date not null,
  effective_to     date check (effective_to is null or effective_to >= effective_from),
  source           text not null check (source in ('placement','endorsement','import','seed')),
  endorsement_id   uuid,
  items            jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  constraint policy_versions_policy_id_version_key unique (policy_id, version)
);
create index policy_versions_organization_id_idx on policy_versions (organization_id);
create index policy_versions_created_by_idx on policy_versions (created_by);

alter table work_items add constraint work_items_policy_period_id_fkey foreign key (policy_period_id) references policy_periods(id);
create index work_items_policy_period_id_idx on work_items (policy_period_id);

create table claims (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations(id) on delete cascade,
  work_item_id             uuid not null references work_items(id) on delete cascade,
  client_id                uuid not null references clients(id),
  policy_id                uuid references policies(id),
  policy_period_id         uuid references policy_periods(id),
  status                   text not null default 'draft' check (status in ('draft','registered','closed')),
  source                   text not null check (source in ('email','manual','ask')),
  incident_on              date not null,
  incident_summary         text not null,
  reported_on              date,
  insurer_reference        text,
  cover_review             text,
  cover_review_version_id  uuid references policy_versions(id),
  clock_clause_reference   text,
  clock_clause_page        integer check (clock_clause_page is null or clock_clause_page >= 1),
  clock_clause_days        integer check (clock_clause_days is null or clock_clause_days between 1 and 365),
  clock_start_event        text check (clock_start_event is null or clock_start_event in ('incident','client_aware','notified_to_us')),
  clock_start_on           date,
  clock_start_evidence     text,
  offer_reference          text,
  offer_recorded_at        timestamptz,
  acceptance_reference     text,
  acceptance_recorded_at   timestamptz,
  payment_reference        text,
  payment_recorded_at      timestamptz,
  registered_by            uuid references users(id),
  registered_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint claims_work_item_id_key unique (work_item_id),
  constraint claims_registered_has_period check (status = 'draft' or (policy_period_id is not null and registered_by is not null and registered_at is not null)),
  -- The clock is all-or-nothing: a partial clock never runs.
  constraint claims_clock_all_or_nothing check (
    (clock_clause_reference is null and clock_clause_page is null and clock_clause_days is null
     and clock_start_event is null and clock_start_on is null and clock_start_evidence is null)
    or (clock_clause_reference is not null and clock_clause_page is not null and clock_clause_days is not null
        and clock_start_event is not null and clock_start_on is not null and clock_start_evidence is not null)),
  -- Each fact carries its reference and its time together.
  constraint claims_offer_pair check ((offer_reference is null) = (offer_recorded_at is null)),
  constraint claims_acceptance_pair check ((acceptance_reference is null) = (acceptance_recorded_at is null)),
  constraint claims_payment_pair check ((payment_reference is null) = (payment_recorded_at is null))
);
create index claims_organization_id_idx on claims (organization_id);
create index claims_client_id_idx on claims (client_id);
create index claims_policy_id_idx on claims (policy_id);
create index claims_policy_period_id_idx on claims (policy_period_id);
create index claims_cover_review_version_id_idx on claims (cover_review_version_id);
create index claims_registered_by_idx on claims (registered_by);

create table claim_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  claim_id         uuid not null references claims(id) on delete cascade,
  label            text not null check (length(btrim(label)) > 0),
  holder           text not null check (holder in ('client','insurer','garage','police','assessor','us')),
  reference        text,
  requested_at     timestamptz,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint claim_documents_received_has_reference check ((received_at is null) = (reference is null))
);
create index claim_documents_organization_id_idx on claim_documents (organization_id);
create index claim_documents_claim_id_idx on claim_documents (claim_id);

create table claim_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  claim_id         uuid not null references claims(id) on delete cascade,
  kind             text not null check (kind in ('call_note','note')),
  spoke_with       text,
  body             text not null check (length(btrim(body)) > 0),
  noted_by         uuid references users(id),
  noted_at         timestamptz not null default now()
);
create index claim_notes_organization_id_idx on claim_notes (organization_id);
create index claim_notes_claim_id_idx on claim_notes (claim_id);
create index claim_notes_noted_by_idx on claim_notes (noted_by);

create table endorsements (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  work_item_id           uuid not null references work_items(id) on delete cascade,
  policy_id              uuid not null references policies(id),
  kind                   text check (kind is null or kind in ('add_item','remove_item','change_value','transfer_ownership','other')),
  requested_by           text not null check (requested_by in ('policyholder','other')),
  requested_by_name      text,
  request_text           text not null,
  effective_on           date,
  instruction_reference  text,
  instruction_from       text check (instruction_from is null or instruction_from in ('policyholder','other')),
  response_reference     text,
  items                  jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  applied_version_id     uuid references policy_versions(id),
  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint endorsements_work_item_id_key unique (work_item_id),
  constraint endorsements_instruction_pair check ((instruction_reference is null) = (instruction_from is null))
);
create index endorsements_organization_id_idx on endorsements (organization_id);
create index endorsements_policy_id_idx on endorsements (policy_id);
create index endorsements_applied_version_id_idx on endorsements (applied_version_id);
create index endorsements_created_by_idx on endorsements (created_by);

alter table policy_versions add constraint policy_versions_endorsement_id_fkey foreign key (endorsement_id) references endorsements(id);
create index policy_versions_endorsement_id_idx on policy_versions (endorsement_id);

do $$
declare t text;
begin
  foreach t in array array['policies','policy_periods','policy_versions','claims','claim_documents','claim_notes','endorsements'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_read on %I for select to authenticated, asap_worker using (app.can_access(organization_id))$p$, t);
    execute format($p$create policy tenant_insert on %I for insert to authenticated, asap_worker with check (app.can_access(organization_id))$p$, t);
    execute format($p$create policy tenant_update on %I for update to authenticated, asap_worker using (app.can_access(organization_id)) with check (app.can_access(organization_id))$p$, t);
    execute format($p$create policy tenant_delete on %I for delete to authenticated, asap_worker using (app.can_access(organization_id))$p$, t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create or replace function app.policy_for_write(p_policy_id uuid) returns policies
language plpgsql security definer set search_path = public, pg_temp as $$
declare p policies;
begin
  select * into p from policies where id = p_policy_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(p.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return p;
end; $$;
revoke all on function app.policy_for_write(uuid) from public;

create or replace function public.policy_create(
  p_client_id uuid, p_insurer_id uuid, p_class text, p_policy_number text, p_period_start date, p_period_end date, p_items jsonb, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from clients where id = p_client_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not exists (select 1 from insurers where id = p_insurer_id and organization_id = v_org and deleted_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
  values (v_org, p_client_id, p_insurer_id, btrim(p_class), p_policy_number) returning id into v_id;
  insert into policy_periods (organization_id, policy_id, period_start, period_end) values (v_org, v_id, p_period_start, p_period_end);
  insert into policy_versions (organization_id, policy_id, version, effective_from, source, items, created_by)
  values (v_org, v_id, 1, p_period_start, coalesce(p_source, 'placement'), coalesce(p_items, '[]'::jsonb), v_user);
  perform app.engine_audit(v_org, v_user, 'policy.created', 'policy', v_id, null,
                           jsonb_build_object('client_id', p_client_id, 'insurer_id', p_insurer_id, 'class', btrim(p_class)));
  return v_id;
end; $$;
revoke all on function public.policy_create(uuid, uuid, text, text, date, date, jsonb, text) from public;
grant execute on function public.policy_create(uuid, uuid, text, text, date, date, jsonb, text) to authenticated;

-- The version effective on a day. Versions are kept; only the dates decide.
create or replace function public.policy_version_on(p_policy_id uuid, p_on date)
returns setof policy_versions language sql stable security invoker set search_path = public, pg_temp as $$
  select * from policy_versions v
  where v.policy_id = p_policy_id and v.effective_from <= p_on and (v.effective_to is null or v.effective_to >= p_on)
  order by v.version desc limit 1
$$;
revoke all on function public.policy_version_on(uuid, date) from public;
grant execute on function public.policy_version_on(uuid, date) to authenticated, asap_worker;

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------
create or replace function app.claim_for_write(p_claim_id uuid) returns claims
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims;
begin
  select * into c from claims where id = p_claim_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(c.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return c;
end; $$;
revoke all on function app.claim_for_write(uuid) from public;

-- Always a draft. Registration is a person's act (claim_register).
create or replace function public.claim_create(p_work_item_id uuid, p_client_id uuid, p_policy_id uuid, p_incident_on date, p_summary text, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from work_items where id = p_work_item_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  insert into claims (organization_id, work_item_id, client_id, policy_id, source, incident_on, incident_summary)
  values (v_org, p_work_item_id, p_client_id, p_policy_id, p_source, p_incident_on, btrim(p_summary)) returning id into v_id;
  perform app.engine_audit(v_org, v_user, 'claim.captured', 'claim', v_id, null,
                           jsonb_build_object('source', p_source, 'incident_on', p_incident_on, 'status', 'draft'));
  return v_id;
end; $$;
revoke all on function public.claim_create(uuid, uuid, uuid, date, text, text) from public;
grant execute on function public.claim_create(uuid, uuid, uuid, date, text, text) to authenticated;

create or replace function public.claim_register(p_claim_id uuid, p_policy_period_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims; v_policy uuid;
begin
  c := app.claim_for_write(p_claim_id);
  select pp.policy_id into v_policy from policy_periods pp join policies p on p.id = pp.policy_id
   where pp.id = p_policy_period_id and pp.organization_id = c.organization_id and p.client_id = c.client_id and p.deleted_at is null;
  if v_policy is null then raise exception 'period_not_this_clients' using errcode = '22023'; end if;
  update claims set status = 'registered', policy_id = v_policy, policy_period_id = p_policy_period_id,
    registered_by = v_user, registered_at = now(), reported_on = coalesce(reported_on, current_date), updated_at = now()
  where id = p_claim_id;
  perform app.engine_audit(c.organization_id, v_user, 'claim.registered', 'claim', p_claim_id,
                           jsonb_build_object('status', c.status), jsonb_build_object('status', 'registered', 'policy_period_id', p_policy_period_id));
end; $$;
revoke all on function public.claim_register(uuid, uuid) from public;
grant execute on function public.claim_register(uuid, uuid) to authenticated;

-- The cover review sentence, as produced by the run. Text only; it decides nothing.
create or replace function public.claim_set_cover_review(p_claim_id uuid, p_review text, p_version_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims;
begin
  c := app.claim_for_write(p_claim_id);
  update claims set cover_review = p_review, cover_review_version_id = p_version_id, updated_at = now() where id = p_claim_id;
end; $$;
revoke all on function public.claim_set_cover_review(uuid, text, uuid) from public;
grant execute on function public.claim_set_cover_review(uuid, text, uuid) to authenticated;

-- All six inputs or nothing: a clock without a clause and a verified start never runs.
create or replace function public.claim_set_clock(p_claim_id uuid, p_clause text, p_page integer, p_days integer, p_start_event text, p_start_on date, p_start_evidence text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims;
begin
  c := app.claim_for_write(p_claim_id);
  if p_clause is null or length(btrim(p_clause)) = 0 or p_page is null or p_days is null
     or p_start_event is null or p_start_on is null or p_start_evidence is null or length(btrim(p_start_evidence)) = 0 then
    raise exception 'clock_inputs_incomplete' using errcode = '22023';
  end if;
  update claims set clock_clause_reference = btrim(p_clause), clock_clause_page = p_page, clock_clause_days = p_days,
    clock_start_event = p_start_event, clock_start_on = p_start_on, clock_start_evidence = btrim(p_start_evidence), updated_at = now()
  where id = p_claim_id;
  perform app.engine_audit(c.organization_id, v_user, 'claim.clock_set', 'claim', p_claim_id, null,
                           jsonb_build_object('clause', btrim(p_clause), 'page', p_page, 'days', p_days, 'start_event', p_start_event, 'start_on', p_start_on));
end; $$;
revoke all on function public.claim_set_clock(uuid, text, integer, integer, text, date, text) from public;
grant execute on function public.claim_set_clock(uuid, text, integer, integer, text, date, text) to authenticated;

create or replace function public.claim_document_add(p_claim_id uuid, p_label text, p_holder text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims; v_id uuid;
begin
  c := app.claim_for_write(p_claim_id);
  insert into claim_documents (organization_id, claim_id, label, holder, requested_at)
  values (c.organization_id, p_claim_id, btrim(p_label), p_holder, now()) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.claim_document_add(uuid, text, text) from public;
grant execute on function public.claim_document_add(uuid, text, text) to authenticated;

create or replace function public.claim_document_receive(p_document_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); d claim_documents; c claims;
begin
  select * into d from claim_documents where id = p_document_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  c := app.claim_for_write(d.claim_id);
  if p_reference is null or length(btrim(p_reference)) = 0 then raise exception 'evidence_required' using errcode = '22023'; end if;
  update claim_documents set reference = btrim(p_reference), received_at = now(), holder = 'us' where id = p_document_id;
  perform app.engine_audit(c.organization_id, v_user, 'claim.document_received', 'claim', d.claim_id, null,
                           jsonb_build_object('label', d.label, 'reference', btrim(p_reference)));
end; $$;
revoke all on function public.claim_document_receive(uuid, text) from public;
grant execute on function public.claim_document_receive(uuid, text) to authenticated;

-- A note is ours. kind = 'call_note' names who we spoke to; it is never the insurer's words.
create or replace function public.claim_note_add(p_claim_id uuid, p_kind text, p_spoke_with text, p_body text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims; v_id uuid;
begin
  c := app.claim_for_write(p_claim_id);
  insert into claim_notes (organization_id, claim_id, kind, spoke_with, body, noted_by)
  values (c.organization_id, p_claim_id, p_kind, p_spoke_with, btrim(p_body), v_user) returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.claim_note_add(uuid, text, text, text) from public;
grant execute on function public.claim_note_add(uuid, text, text, text) to authenticated;

create or replace function public.claim_set_insurer_reference(p_claim_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims;
begin
  c := app.claim_for_write(p_claim_id);
  update claims set insurer_reference = btrim(p_reference), updated_at = now() where id = p_claim_id;
end; $$;
revoke all on function public.claim_set_insurer_reference(uuid, text) from public;
grant execute on function public.claim_set_insurer_reference(uuid, text) to authenticated;

-- One fact at a time. Recording an offer touches nothing about acceptance or payment, and so on.
create or replace function public.claim_fact_record(p_claim_id uuid, p_fact text, p_reference text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims;
begin
  c := app.claim_for_write(p_claim_id);
  if p_reference is null or length(btrim(p_reference)) = 0 then raise exception 'evidence_required' using errcode = '22023'; end if;
  case p_fact
    when 'offer' then
      if c.offer_reference is not null then raise exception 'already_recorded' using errcode = '23505'; end if;
      update claims set offer_reference = btrim(p_reference), offer_recorded_at = now(), updated_at = now() where id = p_claim_id;
    when 'acceptance' then
      if c.acceptance_reference is not null then raise exception 'already_recorded' using errcode = '23505'; end if;
      update claims set acceptance_reference = btrim(p_reference), acceptance_recorded_at = now(), updated_at = now() where id = p_claim_id;
    when 'payment' then
      if c.payment_reference is not null then raise exception 'already_recorded' using errcode = '23505'; end if;
      update claims set payment_reference = btrim(p_reference), payment_recorded_at = now(), updated_at = now() where id = p_claim_id;
    else
      raise exception 'unknown_fact' using errcode = '22023';
  end case;
  perform app.engine_audit(c.organization_id, v_user, 'claim.' || p_fact || '_recorded', 'claim', p_claim_id, null,
                           jsonb_build_object('reference', btrim(p_reference)));
end; $$;
revoke all on function public.claim_fact_record(uuid, text, text) from public;
grant execute on function public.claim_fact_record(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Endorsements
-- ---------------------------------------------------------------------------
create or replace function app.endorsement_for_write(p_id uuid) returns endorsements
language plpgsql security definer set search_path = public, pg_temp as $$
declare e endorsements;
begin
  select * into e from endorsements where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(e.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return e;
end; $$;
revoke all on function app.endorsement_for_write(uuid) from public;

create or replace function public.endorsement_create(
  p_work_item_id uuid, p_policy_id uuid, p_kind text, p_requested_by text, p_requested_by_name text, p_request_text text,
  p_effective_on date, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from work_items where id = p_work_item_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not exists (select 1 from policies where id = p_policy_id and organization_id = v_org and deleted_at is null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into endorsements (organization_id, work_item_id, policy_id, kind, requested_by, requested_by_name, request_text, effective_on, items, created_by)
  values (v_org, p_work_item_id, p_policy_id, p_kind, p_requested_by, p_requested_by_name, btrim(p_request_text), p_effective_on, coalesce(p_items, '[]'::jsonb), v_user)
  returning id into v_id;
  perform app.engine_audit(v_org, v_user, 'endorsement.requested', 'endorsement', v_id, null,
                           jsonb_build_object('policy_id', p_policy_id, 'kind', p_kind, 'requested_by', p_requested_by, 'requested_by_name', p_requested_by_name));
  return v_id;
end; $$;
revoke all on function public.endorsement_create(uuid, uuid, text, text, text, text, date, jsonb) from public;
grant execute on function public.endorsement_create(uuid, uuid, text, text, text, text, date, jsonb) to authenticated;

create or replace function public.endorsement_update(p_id uuid, p_kind text, p_effective_on date, p_items jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); e endorsements;
begin
  e := app.endorsement_for_write(p_id);
  if e.applied_version_id is not null then raise exception 'already_applied' using errcode = '23505'; end if;
  update endorsements set kind = coalesce(p_kind, kind), effective_on = coalesce(p_effective_on, effective_on),
    items = coalesce(p_items, items), updated_at = now() where id = p_id;
end; $$;
revoke all on function public.endorsement_update(uuid, text, date, jsonb) from public;
grant execute on function public.endorsement_update(uuid, text, date, jsonb) to authenticated;

-- The instruction and who it came from are recorded whoever sent it. Only the policyholder's unblocks a transfer.
create or replace function public.endorsement_record_instruction(p_id uuid, p_reference text, p_from text, p_from_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); e endorsements;
begin
  e := app.endorsement_for_write(p_id);
  if p_reference is null or length(btrim(p_reference)) = 0 then raise exception 'evidence_required' using errcode = '22023'; end if;
  update endorsements set instruction_reference = btrim(p_reference), instruction_from = p_from,
    requested_by_name = coalesce(p_from_name, requested_by_name), updated_at = now() where id = p_id;
  perform app.engine_audit(e.organization_id, v_user, 'endorsement.instruction_recorded', 'endorsement', p_id, null,
                           jsonb_build_object('from', p_from, 'from_name', p_from_name, 'reference', btrim(p_reference)));
end; $$;
revoke all on function public.endorsement_record_instruction(uuid, text, text, text) from public;
grant execute on function public.endorsement_record_instruction(uuid, text, text, text) to authenticated;

-- Partial acceptance is itemised: one decision per item, from the insurer's written response.
create or replace function public.endorsement_item_decide(p_id uuid, p_item_id text, p_decision text, p_note text, p_response_reference text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); e endorsements; v_items jsonb; v_found boolean := false;
begin
  e := app.endorsement_for_write(p_id);
  if e.applied_version_id is not null then raise exception 'already_applied' using errcode = '23505'; end if;
  if p_decision not in ('accepted', 'rejected') then raise exception 'invalid_decision' using errcode = '22023'; end if;
  if p_response_reference is null or length(btrim(p_response_reference)) = 0 then raise exception 'evidence_required' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(case when (i ->> 'id') = p_item_id then i || jsonb_build_object('decision', p_decision, 'note', p_note) else i end), '[]'::jsonb),
         bool_or((i ->> 'id') = p_item_id)
    into v_items, v_found
    from jsonb_array_elements(e.items) i;
  if not coalesce(v_found, false) then raise exception 'not_found' using errcode = 'P0002'; end if;
  update endorsements set items = v_items, response_reference = btrim(p_response_reference), updated_at = now() where id = p_id;
  perform app.engine_audit(e.organization_id, v_user, 'endorsement.item_' || p_decision, 'endorsement', p_id, null,
                           jsonb_build_object('item_id', p_item_id, 'note', p_note, 'response_reference', btrim(p_response_reference)));
end; $$;
revoke all on function public.endorsement_item_decide(uuid, text, text, text, text) from public;
grant execute on function public.endorsement_item_decide(uuid, text, text, text, text) to authenticated;

-- Applies the insurer's decisions as a new effective-dated policy version. The old version stays.
-- Rejected items are written into the new version as uncovered, visible, with the insurer's note.
create or replace function public.endorsement_apply(p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  e       endorsements;
  prev    policy_versions;
  v_items jsonb;
  v_n     integer;
  v_id    uuid;
  it      jsonb;
begin
  e := app.endorsement_for_write(p_id);
  if e.applied_version_id is not null then raise exception 'already_applied' using errcode = '23505'; end if;
  if e.effective_on is null then raise exception 'effective_date_required' using errcode = '22023'; end if;
  if jsonb_array_length(e.items) = 0 then raise exception 'no_items' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(e.items) i where (i ->> 'decision') = 'pending') then
    raise exception 'items_undecided' using errcode = '22023';
  end if;
  if e.kind = 'transfer_ownership' and not (e.instruction_from = 'policyholder' and e.instruction_reference is not null) then
    raise exception 'policyholder_instruction_required' using errcode = '42501';
  end if;

  select * into prev from policy_version_on(e.policy_id, e.effective_on);
  if prev.id is null then raise exception 'no_version_on_effective_date' using errcode = '22023'; end if;
  if prev.effective_from >= e.effective_on then raise exception 'effective_date_not_after_current' using errcode = '22023'; end if;
  select coalesce(max(version), 0) + 1 into v_n from policy_versions where policy_id = e.policy_id;

  v_items := prev.items;
  for it in select * from jsonb_array_elements(e.items) loop
    if (it ->> 'decision') = 'accepted' then
      case e.kind
        when 'add_item' then
          v_items := v_items || jsonb_build_array(jsonb_build_object('id', it ->> 'id', 'label', it ->> 'label',
            'sumInsuredMinor', it -> 'sumInsuredMinor', 'covered', true, 'status', 'in_force', 'note', it -> 'note'));
        when 'remove_item' then
          select coalesce(jsonb_agg(case when (x ->> 'id') = (it ->> 'id')
                   then x || jsonb_build_object('covered', false, 'status', 'removed', 'note', coalesce(it -> 'note', to_jsonb('Removed at the client''s request'::text)))
                   else x end), '[]'::jsonb) into v_items from jsonb_array_elements(v_items) x;
        when 'change_value' then
          select coalesce(jsonb_agg(case when (x ->> 'id') = (it ->> 'id')
                   then x || jsonb_build_object('sumInsuredMinor', it -> 'sumInsuredMinor', 'label', coalesce(it ->> 'after', x ->> 'label'), 'note', it -> 'note')
                   else x end), '[]'::jsonb) into v_items from jsonb_array_elements(v_items) x;
        else
          -- transfer_ownership / other: the change is recorded on the item's note; the schedule itself is unchanged.
          select coalesce(jsonb_agg(case when (x ->> 'id') = (it ->> 'id')
                   then x || jsonb_build_object('note', coalesce(it -> 'note', to_jsonb((it ->> 'after')::text)))
                   else x end), '[]'::jsonb) into v_items from jsonb_array_elements(v_items) x;
      end case;
    else
      -- Rejected: uncovered and visible on the policy, with the insurer's note.
      v_items := v_items || jsonb_build_array(jsonb_build_object('id', 'rejected:' || (it ->> 'id'), 'label', it ->> 'label',
        'sumInsuredMinor', it -> 'sumInsuredMinor', 'covered', false, 'status', 'rejected_by_insurer',
        'note', coalesce(it -> 'note', to_jsonb('Rejected by the insurer'::text))));
    end if;
  end loop;

  update policy_versions set effective_to = e.effective_on - 1 where id = prev.id and effective_to is null;
  insert into policy_versions (organization_id, policy_id, version, effective_from, effective_to, source, endorsement_id, items, created_by)
  values (e.organization_id, e.policy_id, v_n, e.effective_on, prev.effective_to, 'endorsement', p_id, v_items, v_user)
  returning id into v_id;
  update endorsements set applied_version_id = v_id, updated_at = now() where id = p_id;
  update policies set updated_at = now() where id = e.policy_id;
  perform app.engine_audit(e.organization_id, v_user, 'endorsement.applied', 'policy', e.policy_id,
                           jsonb_build_object('version', prev.version), jsonb_build_object('version', v_n, 'effective_from', e.effective_on, 'endorsement_id', p_id));
  return v_id;
end; $$;
revoke all on function public.endorsement_apply(uuid) from public;
grant execute on function public.endorsement_apply(uuid) to authenticated;
