-- 0060 — A quotation request delivered by a person, with evidence.
--
-- No mailbox is connected, so ASAP cannot send a quotation request, and `quote_requests.sent_at`
-- stays reserved for a real provider send (0048 requires the provider's message id for it). A
-- broker still has to get the approved request to the insurer — copied into their own email,
-- printed, uploaded to a portal. This records that a person did so, how, and the reference that
-- proves it. Only then is the insurer "holding" the request, and only then does a reply make sense.
--
-- Rules, written where code cannot route around them:
--   * one delivery per request — a retry finds it, it never records a second;
--   * only an approved request can be delivered, and only the exact text that was approved;
--   * a delivery cannot be dated in the future;
--   * append-only: no one updates or deletes a delivery (an owner session aside);
--   * written only through the API, like every other quotation table (0057).

create table quote_request_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  quote_request_id     uuid not null references quote_requests(id) on delete cascade,
  method               text not null check (method in ('own_email', 'printed', 'portal', 'hand_delivered', 'phone', 'other')),
  -- What proves it: an email subject and time, a portal reference, who received it.
  reference            text not null check (length(btrim(reference)) >= 3 and length(reference) <= 300),
  evidence_document_id uuid references documents(id) on delete set null,
  -- The approved content this delivery carried; must match the request's approval.
  delivered_body_sha256 text not null,
  delivered_at         timestamptz not null,
  recorded_by          uuid not null references users(id),
  recorded_at          timestamptz not null default now(),
  constraint quote_request_deliveries_one_per_request unique (quote_request_id)
);
create index quote_request_deliveries_organization_id_idx on quote_request_deliveries (organization_id);
create index quote_request_deliveries_recorded_by_idx on quote_request_deliveries (recorded_by);
create index quote_request_deliveries_evidence_document_id_idx on quote_request_deliveries (evidence_document_id);

create or replace function app.quote_request_delivery_is_of_approved_content()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r quote_requests;
begin
  select * into r from quote_requests where id = new.quote_request_id;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if r.organization_id <> new.organization_id then raise exception 'wrong_organization' using errcode = '42501'; end if;
  if r.approved_at is null or r.approved_body_sha256 is null then
    raise exception 'not_approved: a request must be approved before it is delivered' using errcode = '23514';
  end if;
  if new.delivered_body_sha256 <> r.approved_body_sha256 then
    raise exception 'not_the_approved_text: the delivered text must be the approved text' using errcode = '23514';
  end if;
  if new.delivered_at > now() + interval '5 minutes' then
    raise exception 'delivered_in_future' using errcode = '23514';
  end if;
  if new.delivered_at < r.approved_at - interval '5 minutes' then
    raise exception 'delivered_before_approval' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.quote_request_delivery_is_of_approved_content() from public;

create trigger quote_request_delivery_is_of_approved_content
  before insert on quote_request_deliveries
  for each row execute function app.quote_request_delivery_is_of_approved_content();

-- Named to sort first: the API gate answers a browser write before any validation does.
create trigger "000_through_api"
  before insert or update or delete on quote_request_deliveries
  for each row execute function app.placement_writes_through_api();

alter table quote_request_deliveries enable row level security;

create policy tenant_select on quote_request_deliveries for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_request_deliveries for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));

grant select, insert on quote_request_deliveries to authenticated, asap_worker;
revoke update, delete on quote_request_deliveries from authenticated, asap_worker, anon;

comment on table quote_request_deliveries is
  'A person delivered an approved quotation request outside ASAP (no mailbox connected). Evidence-bearing, append-only, API-only. sent_at on quote_requests stays reserved for a real provider send.';

-- ---------------------------------------------------------------------------------------------
-- The next action on a Work item, derived by the server from the record it is about.
--
-- Today, Work, Ask and the record's own Space all read the same work_items fields, so they cannot
-- contradict each other — provided one place writes them. This is that place for work items that
-- are not driven by steps (quotation work, claims, servicing): the API derives what must happen,
-- who holds it and what is missing from the record's state, and writes it here. Never the model.
create or replace function public.work_item_set_state(
  p_work_item_id uuid, p_task_status text, p_task_party text, p_task_since timestamptz,
  p_task_next_check timestamptz, p_reason text, p_required_action text, p_evidence_needed text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  w work_items;
begin
  select * into w from work_items where id = p_work_item_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(w.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if p_task_status not in ('needs_you', 'with_party', 'in_progress', 'done') then
    raise exception 'bad_task_status' using errcode = '23514';
  end if;
  if p_task_status = 'with_party' and (p_task_party is null or btrim(p_task_party) = '' or p_task_since is null) then
    raise exception 'with_party_needs_party_and_since' using errcode = '23514';
  end if;
  -- Nothing changed: no new version, no audit noise.
  if w.task_status = p_task_status and w.task_party is not distinct from p_task_party
     and w.task_next_check is not distinct from p_task_next_check
     and w.required_action is not distinct from p_required_action
     and w.evidence_needed is not distinct from p_evidence_needed
     and w.reason is not distinct from p_reason then
    return jsonb_build_object('id', w.id, 'changed', false, 'version', w.version);
  end if;
  update work_items set
    task_status = p_task_status,
    task_party = case when p_task_status = 'with_party' then p_task_party else null end,
    task_since = case when p_task_status = 'with_party' then p_task_since
                      when w.task_status <> p_task_status then now() else w.task_since end,
    task_next_check = p_task_next_check,
    reason = p_reason, required_action = p_required_action, evidence_needed = p_evidence_needed,
    completed_at = case when p_task_status = 'done' then coalesce(w.completed_at, now()) else null end,
    version = version + 1, updated_at = now()
   where id = w.id;
  perform app.engine_audit(w.organization_id, v_user, 'work_item.state_derived', 'work_item', w.id,
    jsonb_build_object('task_status', w.task_status, 'task_party', w.task_party, 'required_action', w.required_action),
    jsonb_build_object('task_status', p_task_status, 'task_party', p_task_party, 'required_action', p_required_action));
  return jsonb_build_object('id', w.id, 'changed', true, 'version', w.version + 1);
end $$;
revoke all on function public.work_item_set_state(uuid, text, text, timestamptz, timestamptz, text, text, text) from public, anon;
grant execute on function public.work_item_set_state(uuid, text, text, timestamptz, timestamptz, text, text, text) to authenticated, asap_worker;
