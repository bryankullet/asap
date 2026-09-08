-- 0026 — UI Build Spec Phase 4: client files (K01–K03), agency agreements (G01–G02), the gate
--
-- Screen Map v3 Part 4.1 and 4.2. Rules enforced here, not only in the interface:
--   - A client lands as not_started. No row can be created as anything else (trigger), and only
--     client_file_clear() can set cleared, after a named person gives a reason and the file holds
--     the documents the client's kind requires. Imported clients are never assumed cleared.
--   - Screening (K03) is parked: no screening source exists, so no function can record a screen.
--   - One agreement per insurer, versioned. A rate is usable only once a person confirms it;
--     app.agreed_rate() returns confirmed rates only, for the version effective on a date.
--   - The placement gate: client_file_cleared is evaluated by the API from client_file_state() and
--     re-checked here at approval time (work_item_approve). A principal-officer override needs a
--     typed reason, is audited, and creates a work item on the principal's Today.
--   - work_items.client_id gains its foreign key (promised in 0022).
-- Grants: SELECT for authenticated; every write through an API-gated function (D-042).

create table insurers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null check (length(btrim(name)) > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint insurers_organization_id_name_key unique (organization_id, name)
);

create table clients (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  name                  text not null check (length(btrim(name)) > 0),
  kind                  text not null check (kind in ('individual', 'corporate')),
  source                text not null check (source in ('imported', 'manual', 'seed')),
  file_status           text not null default 'not_started'
                        check (file_status in ('not_started','incomplete','in_review','cleared','refresh_due')),
  file_owner_id         uuid references users(id),
  file_decided_by       uuid references users(id),
  file_decided_at       timestamptz,
  file_decision_reason  text,
  refresh_interval_days integer check (refresh_interval_days is null or refresh_interval_days between 30 and 1825),
  refresh_due_at        timestamptz,
  search                tsvector generated always as (to_tsvector('simple', coalesce(name, ''))) stored,
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint clients_organization_id_name_key unique (organization_id, name),
  constraint clients_cleared_is_decided check (
    file_status <> 'cleared' or (file_decided_by is not null and file_decided_at is not null
                                 and file_decision_reason is not null and refresh_due_at is not null))
);
create index clients_organization_id_file_status_idx on clients (organization_id, file_status);
create index clients_file_owner_id_idx on clients (file_owner_id);
create index clients_file_decided_by_idx on clients (file_decided_by);
create index clients_created_by_idx on clients (created_by);
create index clients_search_idx on clients using gin (search);

-- Every client lands as not_started, whatever the caller says (import, seed, manual, anything).
create or replace function app.clients_land_not_started()
returns trigger language plpgsql as $$
begin
  if new.file_status <> 'not_started' then
    raise exception 'client_must_land_not_started' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.clients_land_not_started() from public, anon, authenticated;
create trigger clients_land_not_started before insert on clients
  for each row execute function app.clients_land_not_started();

create table client_file_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  client_id        uuid not null references clients(id) on delete cascade,
  kind             text not null check (kind in ('identity','beneficial_ownership','source_of_funds','other')),
  label            text not null check (length(btrim(label)) > 0),
  reference        text,
  requested_at     timestamptz,
  received_at      timestamptz,
  recorded_by      uuid references users(id),
  created_at       timestamptz not null default now(),
  constraint client_file_documents_received_has_reference check (
    (received_at is null and reference is null) or (received_at is not null and reference is not null and length(btrim(reference)) > 0)),
  constraint client_file_documents_requested_or_received check (requested_at is not null or received_at is not null)
);
create index client_file_documents_organization_id_idx on client_file_documents (organization_id);
create index client_file_documents_client_id_idx on client_file_documents (client_id);
create index client_file_documents_recorded_by_idx on client_file_documents (recorded_by);

create table agreements (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  insurer_id          uuid not null references insurers(id) on delete cascade,
  status              text not null default 'active' check (status in ('draft','active','expired')),
  document_reference  text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint agreements_organization_id_insurer_id_key unique (organization_id, insurer_id)
);
create index agreements_insurer_id_idx on agreements (insurer_id);
create index agreements_created_by_idx on agreements (created_by);

create table agreement_versions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  agreement_id        uuid not null references agreements(id) on delete cascade,
  version             integer not null check (version >= 1),
  effective_from      date not null,
  effective_to        date check (effective_to is null or effective_to >= effective_from),
  payment_terms_days  integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  document_reference  text,
  notes               text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  constraint agreement_versions_agreement_id_version_key unique (agreement_id, version)
);
create index agreement_versions_organization_id_idx on agreement_versions (organization_id);
create index agreement_versions_created_by_idx on agreement_versions (created_by);

create table agreement_rates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  version_id         uuid not null references agreement_versions(id) on delete cascade,
  class_of_business  text not null check (length(btrim(class_of_business)) > 0),
  rate_basis_points  integer not null check (rate_basis_points between 0 and 10000),
  clause_reference   text,
  proposed_by        text not null check (proposed_by in ('asap','person')),
  proposed_by_user   uuid references users(id),
  confirmed_by       uuid references users(id),
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  constraint agreement_rates_version_id_class_key unique (version_id, class_of_business),
  constraint agreement_rates_confirmed_together check ((confirmed_by is null) = (confirmed_at is null))
);
create index agreement_rates_organization_id_idx on agreement_rates (organization_id);
create index agreement_rates_proposed_by_user_idx on agreement_rates (proposed_by_user);
create index agreement_rates_confirmed_by_idx on agreement_rates (confirmed_by);

alter table work_items
  add constraint work_items_client_id_fkey foreign key (client_id) references clients(id),
  add column insurer_id uuid references insurers(id),
  add column class_of_business text,
  add column cover_inception_at timestamptz;
create index work_items_client_id_idx on work_items (client_id);
create index work_items_insurer_id_idx on work_items (insurer_id);

do $$
declare t text;
begin
  foreach t in array array['insurers','clients','client_file_documents','agreements','agreement_versions','agreement_rates'] loop
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
-- Client file state and gate
-- ---------------------------------------------------------------------------
-- Effective state: cleared past its refresh date reads as refresh_due.
create or replace function public.client_file_state(p_client_id uuid)
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  select case when c.file_status = 'cleared' and c.refresh_due_at <= now() then 'refresh_due' else c.file_status end
  from clients c where c.id = p_client_id and c.deleted_at is null
$$;
revoke all on function public.client_file_state(uuid) from public;
grant execute on function public.client_file_state(uuid) to authenticated, asap_worker;

create or replace function public.client_create(p_organization_id uuid, p_name text, p_kind text, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_id uuid;
begin
  if app.current_membership(p_organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  select id into v_id from clients where organization_id = p_organization_id and name = btrim(p_name) and deleted_at is null;
  if v_id is not null then return jsonb_build_object('id', v_id, 'created', false); end if;
  insert into clients (organization_id, name, kind, source, created_by)
  values (p_organization_id, btrim(p_name), p_kind, p_source, v_user) returning id into v_id;
  perform app.engine_audit(p_organization_id, v_user, 'client.created', 'client', v_id, null,
                           jsonb_build_object('name', btrim(p_name), 'kind', p_kind, 'source', p_source, 'file_status', 'not_started'));
  return jsonb_build_object('id', v_id, 'created', true);
end; $$;
revoke all on function public.client_create(uuid, text, text, text) from public;
grant execute on function public.client_create(uuid, text, text, text) to authenticated;

create or replace function app.client_for_write(p_client_id uuid) returns clients
language plpgsql security definer set search_path = public, pg_temp as $$
declare c clients;
begin
  select * into c from clients where id = p_client_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(c.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return c;
end; $$;
revoke all on function app.client_for_write(uuid) from public;

-- Requesting a document: recorded here; the request itself is drafted and sent by a person.
create or replace function public.client_file_request_document(p_client_id uuid, p_kind text, p_label text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c clients; v_id uuid;
begin
  c := app.client_for_write(p_client_id);
  insert into client_file_documents (organization_id, client_id, kind, label, requested_at, recorded_by)
  values (c.organization_id, p_client_id, p_kind, btrim(p_label), now(), v_user) returning id into v_id;
  if c.file_status = 'not_started' then
    update clients set file_status = 'incomplete', file_owner_id = coalesce(file_owner_id, v_user), updated_at = now() where id = p_client_id;
  end if;
  perform app.engine_audit(c.organization_id, v_user, 'client_file.document_requested', 'client', p_client_id, null,
                           jsonb_build_object('kind', p_kind, 'label', btrim(p_label)));
  return v_id;
end; $$;
revoke all on function public.client_file_request_document(uuid, text, text) from public;
grant execute on function public.client_file_request_document(uuid, text, text) to authenticated;

create or replace function public.client_file_record_document(p_client_id uuid, p_kind text, p_label text, p_reference text, p_received_at timestamptz)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c clients; v_id uuid;
begin
  c := app.client_for_write(p_client_id);
  if p_reference is null or length(btrim(p_reference)) = 0 then raise exception 'evidence_required' using errcode = '22023'; end if;
  -- A pending request of the same kind and label is fulfilled rather than duplicated.
  update client_file_documents set reference = btrim(p_reference), received_at = coalesce(p_received_at, now()), recorded_by = v_user
   where client_id = p_client_id and kind = p_kind and label = btrim(p_label) and received_at is null
  returning id into v_id;
  if v_id is null then
    insert into client_file_documents (organization_id, client_id, kind, label, reference, received_at, recorded_by)
    values (c.organization_id, p_client_id, p_kind, btrim(p_label), btrim(p_reference), coalesce(p_received_at, now()), v_user)
    returning id into v_id;
  end if;
  if c.file_status in ('not_started', 'refresh_due') then
    update clients set file_status = 'incomplete', file_owner_id = coalesce(file_owner_id, v_user), updated_at = now() where id = p_client_id;
  end if;
  perform app.engine_audit(c.organization_id, v_user, 'client_file.document_recorded', 'client', p_client_id, null,
                           jsonb_build_object('kind', p_kind, 'label', btrim(p_label), 'reference', btrim(p_reference)));
  return v_id;
end; $$;
revoke all on function public.client_file_record_document(uuid, text, text, text, timestamptz) from public;
grant execute on function public.client_file_record_document(uuid, text, text, text, timestamptz) to authenticated;

-- What a file still needs before it can be cleared, for this client's kind.
create or replace function app.client_file_missing(p_client_id uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(array[
    case when not exists (select 1 from client_file_documents d where d.client_id = c.id and d.kind = 'identity' and d.received_at is not null)
         then 'An identity document received' end,
    case when c.kind = 'corporate' and not exists (select 1 from client_file_documents d where d.client_id = c.id and d.kind = 'beneficial_ownership' and d.received_at is not null)
         then 'A beneficial ownership declaration received' end
  ], null)
  from clients c where c.id = p_client_id
$$;
revoke all on function app.client_file_missing(uuid) from public;
grant execute on function app.client_file_missing(uuid) to authenticated, service_role;

create or replace function public.client_file_start_review(p_client_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c clients;
begin
  c := app.client_for_write(p_client_id);
  if not exists (select 1 from client_file_documents where client_id = p_client_id and received_at is not null) then
    raise exception 'nothing_to_review' using errcode = '22023';
  end if;
  update clients set file_status = 'in_review', file_owner_id = coalesce(file_owner_id, v_user), updated_at = now() where id = p_client_id;
  perform app.engine_audit(c.organization_id, v_user, 'client_file.review_started', 'client', p_client_id,
                           jsonb_build_object('file_status', c.file_status), jsonb_build_object('file_status', 'in_review'));
end; $$;
revoke all on function public.client_file_start_review(uuid) from public;
grant execute on function public.client_file_start_review(uuid) to authenticated;

-- Clearing is a named human decision with a reason. ASAP prepares; it never clears.
create or replace function public.client_file_clear(p_client_id uuid, p_reason text, p_refresh_interval_days integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c clients; v_missing text[];
begin
  c := app.client_for_write(p_client_id);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'reason_required' using errcode = '22023'; end if;
  v_missing := app.client_file_missing(p_client_id);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'file_incomplete' using errcode = '22023', detail = array_to_string(v_missing, '; ');
  end if;
  update clients set file_status = 'cleared', file_decided_by = v_user, file_decided_at = now(),
    file_decision_reason = btrim(p_reason), refresh_interval_days = p_refresh_interval_days,
    refresh_due_at = now() + make_interval(days => p_refresh_interval_days), updated_at = now()
  where id = p_client_id;
  perform app.engine_audit(c.organization_id, v_user, 'client_file.cleared', 'client', p_client_id,
                           jsonb_build_object('file_status', c.file_status),
                           jsonb_build_object('file_status', 'cleared', 'reason', btrim(p_reason), 'refresh_interval_days', p_refresh_interval_days));
end; $$;
revoke all on function public.client_file_clear(uuid, text, integer) from public;
grant execute on function public.client_file_clear(uuid, text, integer) to authenticated;

create or replace function public.client_file_reopen(p_client_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c clients;
begin
  c := app.client_for_write(p_client_id);
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'reason_required' using errcode = '22023'; end if;
  update clients set file_status = 'incomplete', file_decided_by = null, file_decided_at = null, file_decision_reason = null,
    refresh_due_at = null, updated_at = now() where id = p_client_id;
  perform app.engine_audit(c.organization_id, v_user, 'client_file.reopened', 'client', p_client_id,
                           jsonb_build_object('file_status', c.file_status), jsonb_build_object('file_status', 'incomplete', 'reason', btrim(p_reason)));
end; $$;
revoke all on function public.client_file_reopen(uuid, text) from public;
grant execute on function public.client_file_reopen(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Insurers and agreements
-- ---------------------------------------------------------------------------
create or replace function public.insurer_create(p_organization_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_id uuid;
begin
  if app.current_membership(p_organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  insert into insurers (organization_id, name) values (p_organization_id, btrim(p_name))
  on conflict (organization_id, name) do update set updated_at = now(), deleted_at = null
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.insurer_create(uuid, text) from public;
grant execute on function public.insurer_create(uuid, text) to authenticated;

create or replace function public.agreement_create(p_insurer_id uuid, p_effective_from date, p_document_reference text, p_payment_terms_days integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from insurers where id = p_insurer_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  insert into agreements (organization_id, insurer_id, document_reference, created_by)
  values (v_org, p_insurer_id, p_document_reference, v_user) returning id into v_id;
  insert into agreement_versions (organization_id, agreement_id, version, effective_from, payment_terms_days, document_reference, created_by)
  values (v_org, v_id, 1, p_effective_from, p_payment_terms_days, p_document_reference, v_user);
  perform app.engine_audit(v_org, v_user, 'agreement.created', 'agreement', v_id, null,
                           jsonb_build_object('insurer_id', p_insurer_id, 'effective_from', p_effective_from));
  return v_id;
end; $$;
revoke all on function public.agreement_create(uuid, date, text, integer) from public;
grant execute on function public.agreement_create(uuid, date, text, integer) to authenticated;

-- A new version closes the previous one the day before. History is never rewritten.
create or replace function public.agreement_version_create(p_agreement_id uuid, p_effective_from date, p_document_reference text, p_payment_terms_days integer, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_n integer; v_id uuid;
begin
  select organization_id into v_org from agreements where id = p_agreement_id and deleted_at is null for update;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  select coalesce(max(version), 0) into v_n from agreement_versions where agreement_id = p_agreement_id;
  if exists (select 1 from agreement_versions where agreement_id = p_agreement_id and effective_from >= p_effective_from) then
    raise exception 'version_not_after_previous' using errcode = '22023';
  end if;
  update agreement_versions set effective_to = p_effective_from - 1
   where agreement_id = p_agreement_id and version = v_n and effective_to is null;
  insert into agreement_versions (organization_id, agreement_id, version, effective_from, payment_terms_days, document_reference, notes, created_by)
  values (v_org, p_agreement_id, v_n + 1, p_effective_from, p_payment_terms_days, p_document_reference, p_notes, v_user)
  returning id into v_id;
  update agreements set updated_at = now(), document_reference = coalesce(p_document_reference, document_reference) where id = p_agreement_id;
  perform app.engine_audit(v_org, v_user, 'agreement.version_created', 'agreement', p_agreement_id, null,
                           jsonb_build_object('version', v_n + 1, 'effective_from', p_effective_from));
  return v_id;
end; $$;
revoke all on function public.agreement_version_create(uuid, date, text, integer, text) from public;
grant execute on function public.agreement_version_create(uuid, date, text, integer, text) to authenticated;

create or replace function public.agreement_rate_propose(p_version_id uuid, p_class text, p_rate_basis_points integer, p_clause text, p_proposed_by text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from agreement_versions where id = p_version_id;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  insert into agreement_rates (organization_id, version_id, class_of_business, rate_basis_points, clause_reference, proposed_by, proposed_by_user)
  values (v_org, p_version_id, btrim(p_class), p_rate_basis_points, p_clause, p_proposed_by, case when p_proposed_by = 'person' then v_user end)
  returning id into v_id;
  perform app.engine_audit(v_org, v_user, 'agreement.rate_proposed', 'agreement_rate', v_id, null,
                           jsonb_build_object('class', btrim(p_class), 'rate_basis_points', p_rate_basis_points, 'proposed_by', p_proposed_by));
  return v_id;
end; $$;
revoke all on function public.agreement_rate_propose(uuid, text, integer, text, text) from public;
grant execute on function public.agreement_rate_propose(uuid, text, integer, text, text) to authenticated;

-- A person confirms each rate before it becomes live. Never automated.
create or replace function public.agreement_rate_confirm(p_rate_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); r agreement_rates;
begin
  select * into r from agreement_rates where id = p_rate_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(r.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if r.confirmed_at is not null then raise exception 'already_confirmed' using errcode = '23505'; end if;
  update agreement_rates set confirmed_by = v_user, confirmed_at = now() where id = p_rate_id;
  perform app.engine_audit(r.organization_id, v_user, 'agreement.rate_confirmed', 'agreement_rate', p_rate_id,
                           jsonb_build_object('confirmed', false), jsonb_build_object('confirmed', true, 'class', r.class_of_business, 'rate_basis_points', r.rate_basis_points));
end; $$;
revoke all on function public.agreement_rate_confirm(uuid) from public;
grant execute on function public.agreement_rate_confirm(uuid) to authenticated;

-- The confirmed rate for a class with an insurer on a date, or nothing. Unconfirmed rates never count.
create or replace function public.agreed_rate(p_insurer_id uuid, p_class text, p_as_of date default current_date)
returns table (rate_basis_points integer, clause_reference text, version integer, effective_from date)
language sql stable security invoker set search_path = public, pg_temp as $$
  select r.rate_basis_points, r.clause_reference, v.version, v.effective_from
  from agreements a
  join agreement_versions v on v.agreement_id = a.id
  join agreement_rates r on r.version_id = v.id
  where a.insurer_id = p_insurer_id and a.deleted_at is null and a.status = 'active'
    and v.effective_from <= p_as_of and (v.effective_to is null or v.effective_to >= p_as_of)
    and lower(r.class_of_business) = lower(btrim(p_class)) and r.confirmed_at is not null
  order by v.version desc limit 1
$$;
revoke all on function public.agreed_rate(uuid, text, date) from public;
grant execute on function public.agreed_rate(uuid, text, date) to authenticated, asap_worker;

-- ---------------------------------------------------------------------------
-- The gate at X01: re-checked at approval time; override audited and surfaced
-- ---------------------------------------------------------------------------
create or replace function public.work_item_approve(
  p_id uuid, p_expected_version integer, p_steps jsonb, p_task_status text, p_task_party text, p_task_since timestamptz, p_task_next_check timestamptz,
  p_override_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  v_row  work_items%rowtype;
  v_state text;
  v_role  text;
  v_override uuid;
  v_client text;
begin
  select * into v_row from work_items where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_row.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_row.version <> p_expected_version then raise exception 'version_stale' using errcode = '40001'; end if;

  v_state := case when v_row.client_id is null then null else public.client_file_state(v_row.client_id) end;
  if v_state is distinct from 'cleared' then
    -- A denied audit row cannot be written here: the exception rolls it back (D-026). The API
    -- records the denial under the caller's session.
    if p_override_reason is null or length(btrim(p_override_reason)) = 0 then
      raise exception 'client_file_not_cleared' using errcode = '42501', detail = coalesce(v_state, 'no client on this item');
    end if;
    select r.key into v_role
      from organization_memberships m join roles r on r.id = m.role_id
     where m.organization_id = v_row.organization_id and m.user_id = v_user and m.status = 'active';
    if v_role is distinct from 'brokerage_admin' then
      raise exception 'principal_officer_only' using errcode = '42501';
    end if;
    select name into v_client from clients where id = v_row.client_id;
    -- The permanent audit entry, and the item that puts it on the principal's Today.
    perform app.engine_audit(v_row.organization_id, v_user, 'placement.client_file_gate_overridden', 'work_item', p_id,
                             jsonb_build_object('client_file_state', v_state),
                             jsonb_build_object('reason', btrim(p_override_reason), 'client_id', v_row.client_id));
    insert into work_items (organization_id, title, kind, client_id, owner_id, task_status, reason, steps)
    values (v_row.organization_id, coalesce(v_client, 'Client') || ' — placement approved with client-file override', 'exception',
            v_row.client_id, v_user, 'needs_you',
            'Approved while the client file was ' || replace(coalesce(v_state, 'not on record'), '_', ' ') || '. Reason given: ' || btrim(p_override_reason),
            jsonb_build_array(jsonb_build_object('id', 'acknowledge', 'label', 'Acknowledge the override', 'actor', 'you', 'state', 'now',
              'guards', '[]'::jsonb, 'evidence', '[]'::jsonb,
              'actions', jsonb_build_array(jsonb_build_object('verb', 'complete', 'label', 'Acknowledged', 'guards', '[]'::jsonb, 'disabledReason', null)),
              'party', null, 'reason', null, 'recorded', '[]'::jsonb, 'runId', null)))
    returning id into v_override;
  end if;

  update work_items set steps = p_steps, task_status = p_task_status, task_party = p_task_party, task_since = p_task_since,
    task_next_check = p_task_next_check, version = version + 1, updated_at = now()
  where id = p_id;
  perform app.engine_audit(v_row.organization_id, v_user, 'placement.approved', 'work_item', p_id,
                           jsonb_build_object('version', v_row.version),
                           jsonb_build_object('client_file_state', v_state, 'override_item_id', v_override));
  return jsonb_build_object('override_item_id', v_override);
end; $$;
revoke all on function public.work_item_approve(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text) from public;
grant execute on function public.work_item_approve(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text) to authenticated;

-- work_item_create learns client, insurer and class. The 0023 signature is dropped, not kept beside it.
drop function public.work_item_create(uuid, text, text, text, jsonb, text, text);
create or replace function public.work_item_create(
  p_organization_id uuid, p_kind text, p_title text, p_client_name text, p_steps jsonb,
  p_task_status text, p_task_party text, p_client_id uuid, p_insurer_id uuid, p_class_of_business text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_id uuid;
begin
  if app.current_membership(p_organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text || ':' || p_kind || ':' || p_title));
  select id into v_id from work_items
   where organization_id = p_organization_id and kind = p_kind and title = p_title
     and task_status <> 'done' and exception is null and deleted_at is null limit 1;
  if v_id is not null then
    perform app.engine_audit(p_organization_id, v_user, 'work_item.reopened', 'work_item', v_id, null, jsonb_build_object('title', p_title));
    return jsonb_build_object('id', v_id, 'reopened', true);
  end if;
  insert into work_items (organization_id, title, kind, owner_id, task_status, task_party, task_since, reason, steps,
                          client_id, insurer_id, class_of_business)
  values (p_organization_id, p_title, p_kind, v_user, p_task_status, p_task_party,
          case when p_task_status = 'with_party' then now() end,
          'Opened from Ask for ' || p_client_name || '.', p_steps, p_client_id, p_insurer_id, p_class_of_business)
  returning id into v_id;
  perform app.engine_audit(p_organization_id, v_user, 'work_item.created', 'work_item', v_id, null,
                           jsonb_build_object('title', p_title, 'kind', p_kind, 'client_id', p_client_id));
  return jsonb_build_object('id', v_id, 'reopened', false);
end; $$;
revoke all on function public.work_item_create(uuid, text, text, text, jsonb, text, text, uuid, uuid, text) from public;
grant execute on function public.work_item_create(uuid, text, text, text, jsonb, text, text, uuid, uuid, text) to authenticated;

-- work_item_apply learns cover_inception_at.
drop function public.work_item_apply(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text, text, jsonb, timestamptz, text, jsonb);
create or replace function public.work_item_apply(
  p_id uuid, p_expected_version integer, p_steps jsonb,
  p_task_status text, p_task_party text, p_task_since timestamptz, p_task_next_check timestamptz,
  p_cover_status text, p_money_status text, p_exception jsonb, p_completed_at timestamptz,
  p_audit_action text, p_audit_new_state jsonb, p_cover_inception_at timestamptz)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_row work_items%rowtype;
begin
  select * into v_row from work_items where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_row.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if v_row.version <> p_expected_version then raise exception 'version_stale' using errcode = '40001'; end if;
  update work_items set
    steps = p_steps, task_status = p_task_status, task_party = p_task_party, task_since = p_task_since,
    task_next_check = p_task_next_check, cover_status = p_cover_status, cover_inception_at = coalesce(p_cover_inception_at, cover_inception_at),
    money_status = p_money_status, exception = p_exception, completed_at = p_completed_at, version = version + 1, updated_at = now()
  where id = p_id;
  perform app.engine_audit(v_row.organization_id, v_user, p_audit_action, 'work_item', p_id,
                           jsonb_build_object('task_status', v_row.task_status, 'version', v_row.version), p_audit_new_state);
  return v_row.version + 1;
end; $$;
revoke all on function public.work_item_apply(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text, text, jsonb, timestamptz, text, jsonb, timestamptz) from public;
grant execute on function public.work_item_apply(uuid, integer, jsonb, text, text, timestamptz, timestamptz, text, text, jsonb, timestamptz, text, jsonb, timestamptz) to authenticated;
