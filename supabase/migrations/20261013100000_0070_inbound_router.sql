-- 0070 — Autonomy build, phase 6 (D-144): the inbound router.
--
-- 1. A manual intake mailbox. A pasted email or an uploaded .eml lands in email_messages like a
--    synced one, so it needs a mailbox and a thread. One per brokerage, provider 'manual', status
--    'intake' — never 'connected', so nothing that asks "is a mailbox connected?" is fooled by it.
-- 2. inbound_classifications: what ASAP proposes an inbound message is, and where it belongs —
--    a proposal with a confidence and a source, never a fact. Read by members; written by the API.
-- 3. An Unsorted email is a Work item of its own kind.
-- 4. inbound_message_record() and inbound_decide(): the person's two write paths.

alter table mailboxes drop constraint mailboxes_provider_check;
alter table mailboxes add constraint mailboxes_provider_check check (provider in ('gmail', 'microsoft', 'manual'));
alter table mailboxes drop constraint mailboxes_status_check;
alter table mailboxes add constraint mailboxes_status_check check (status in ('connected', 'needs_reauthorisation', 'disconnected', 'intake'));
alter table mailboxes add constraint mailboxes_intake_is_manual check ((provider = 'manual') = (status = 'intake'));
create unique index mailboxes_one_intake_per_organization on mailboxes (organization_id) where provider = 'manual';

alter table work_items drop constraint work_items_kind_check;
alter table work_items add constraint work_items_kind_check check (kind in (
  'new_business', 'placement', 'endorsement', 'tor', 'certificate', 'claim', 'renewal', 'compliance',
  'money_in', 'money_out', 'reconciliation', 'wht', 'import', 'exception', 'inbound'));

create table inbound_classifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  email_message_id uuid not null unique references email_messages(id) on delete cascade,
  -- What the message is, as proposed. Null when no model answered: ASAP abstains.
  kind             text check (kind in ('insurer_quote', 'insurer_decline', 'insurer_confirmation', 'policy_document', 'claim_notice',
                                        'claim_update', 'endorsement_request', 'servicing_request', 'new_enquiry', 'other')),
  confidence       numeric(4, 3) check (confidence between 0 and 1),
  source           text not null check (source in ('model', 'none')),
  model            text,
  reason           text,
  -- The deterministic candidates: [{runId, workflow, party, score, why}], best first.
  candidates       jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array'),
  tie_break_run_id uuid references workflow_runs(id) on delete set null,
  state            text not null default 'proposed' check (state in ('proposed', 'routed', 'unsorted', 'dismissed')),
  routed_run_id    uuid references workflow_runs(id) on delete set null,
  routed_by        text check (routed_by in ('auto', 'person')),
  work_item_id     uuid references work_items(id) on delete set null,
  decided_by       uuid references users(id),
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint inbound_classifications_routed_whole check ((state = 'routed') = (routed_run_id is not null and routed_by is not null)),
  constraint inbound_classifications_model_named check ((source = 'model') = (model is not null)),
  constraint inbound_classifications_person_decides check (routed_by is distinct from 'person' or decided_by is not null)
);
create index inbound_classifications_organization_id_idx on inbound_classifications (organization_id);
create index inbound_classifications_routed_run_id_idx on inbound_classifications (routed_run_id);
create index inbound_classifications_tie_break_run_id_idx on inbound_classifications (tie_break_run_id);
create index inbound_classifications_work_item_id_idx on inbound_classifications (work_item_id);
create index inbound_classifications_decided_by_idx on inbound_classifications (decided_by);

comment on table inbound_classifications is
  'What ASAP proposes an inbound email is and where it belongs. A proposal with a confidence and a source; routed automatically only when exactly one run fits and the confidence clears the brokerage''s rule.';

alter table inbound_classifications enable row level security;
create policy tenant_select on inbound_classifications for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on inbound_classifications to authenticated, asap_worker;
revoke insert, update, delete on inbound_classifications from authenticated, asap_worker, anon;
create trigger "000_through_api" before insert or update or delete on inbound_classifications
  for each row execute function app.placement_writes_through_api();

create or replace function public.inbound_message_record(
  p_organization_id uuid, p_from text, p_to text[], p_cc text[], p_subject text, p_body text, p_sent_at timestamptz, p_message_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  v_org uuid := p_organization_id;
  v_box uuid;
  v_thread uuid;
  v_id uuid;
begin
  -- The organization is the session's active one, resolved by the API, and checked again here.
  if v_org is null or app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(v_org, 'email', 'create') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if position('@' in coalesce(p_from, '')) < 2 then raise exception 'sender_required' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 and length(btrim(coalesce(p_subject, ''))) = 0 then
    raise exception 'message_empty' using errcode = '22023';
  end if;

  insert into mailboxes (organization_id, provider, email_address, display_name, connected_by, status)
  values (v_org, 'manual', 'intake@asap.invalid', 'Pasted and uploaded email', v_user, 'intake')
  on conflict (organization_id) where provider = 'manual' do nothing;
  select id into v_box from mailboxes where organization_id = v_org and provider = 'manual';

  -- One thread per message: a pasted email has no provider thread to join.
  insert into email_threads (organization_id, mailbox_id, provider_thread_id, subject, last_message_at)
  values (v_org, v_box, p_message_id, coalesce(p_subject, ''), p_sent_at)
  on conflict (mailbox_id, provider_thread_id) do update set last_message_at = excluded.last_message_at
  returning id into v_thread;

  select id into v_id from email_messages where thread_id = v_thread and provider_message_id = p_message_id;
  if v_id is not null then return jsonb_build_object('id', v_id, 'created', false, 'organizationId', v_org); end if;
  insert into email_messages (organization_id, thread_id, provider_message_id, direction, from_address, to_addresses, cc_addresses,
                              subject, body_text, snippet, sent_at)
  values (v_org, v_thread, p_message_id, 'inbound', lower(btrim(p_from)), coalesce(p_to, '{}'), coalesce(p_cc, '{}'),
          coalesce(p_subject, ''), p_body, left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 200), p_sent_at)
  returning id into v_id;
  perform app.engine_audit(v_org, v_user, 'email.pasted', 'email_message', v_id, null,
                           jsonb_build_object('from', lower(btrim(p_from)), 'subject', p_subject, 'message_id', p_message_id));
  return jsonb_build_object('id', v_id, 'created', true, 'organizationId', v_org);
end $$;
revoke all on function public.inbound_message_record(uuid, text, text[], text[], text, text, timestamptz, text) from public, anon;
grant execute on function public.inbound_message_record(uuid, text, text[], text[], text, text, timestamptz, text) to authenticated;

-- A person settles an Unsorted email: routes it to a live run, or dismisses it with a reason. The
-- Unsorted Work item is done either way. The API then files the email to the run.
create or replace function public.inbound_decide(p_email_message_id uuid, p_decision text, p_run_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  c inbound_classifications;
  r workflow_runs;
begin
  select * into c from inbound_classifications where email_message_id = p_email_message_id for update;
  if not found or app.current_membership(c.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(c.organization_id, 'email', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if c.state in ('routed', 'dismissed') then return jsonb_build_object('state', c.state, 'changed', false); end if;
  if p_decision = 'route' then
    select * into r from workflow_runs where id = p_run_id and organization_id = c.organization_id and state not in ('done', 'cancelled');
    if not found then raise exception 'run_not_live' using errcode = '22023'; end if;
    update inbound_classifications set state = 'routed', routed_run_id = r.id, routed_by = 'person', decided_by = v_user, decided_at = now() where id = c.id;
  elsif p_decision = 'dismiss' then
    if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason_required' using errcode = '23514'; end if;
    update inbound_classifications set state = 'dismissed', decided_by = v_user, decided_at = now(), reason = coalesce(reason || ' — ', '') || 'Dismissed: ' || btrim(p_reason) where id = c.id;
  else
    raise exception 'bad_decision' using errcode = '23514';
  end if;
  if c.work_item_id is not null then
    update work_items set task_status = 'done', completed_at = now(), version = version + 1, updated_at = now() where id = c.work_item_id and task_status <> 'done';
  end if;
  perform app.engine_audit(c.organization_id, v_user, 'email.' || case when p_decision = 'route' then 'routed' else 'dismissed' end,
                           'email_message', p_email_message_id, jsonb_build_object('state', c.state),
                           jsonb_build_object('state', case when p_decision = 'route' then 'routed' else 'dismissed' end, 'runId', p_run_id, 'reason', p_reason));
  return jsonb_build_object('state', case when p_decision = 'route' then 'routed' else 'dismissed' end, 'changed', true, 'runId', p_run_id);
end $$;
revoke all on function public.inbound_decide(uuid, text, uuid, text) from public, anon;
grant execute on function public.inbound_decide(uuid, text, uuid, text) to authenticated;
