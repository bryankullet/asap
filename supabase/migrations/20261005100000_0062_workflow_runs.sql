-- 0062 — Durable workflow runs: the execution foundation, proved by Renewal Autopilot (D-129).
--
-- A run is one piece of multi-step work ASAP carries for a brokerage — "renew this policy
-- period" — that it advances on a schedule, that can wait for a person or an outside party
-- without forgetting, and that never repeats itself:
--
--   * one live run per (workflow, subject): a second detection finds the first;
--   * each step is a row, done once: retries count attempts, back off, and stop at a limit with a
--     plain-words exception rather than retrying forever;
--   * a lease on the run lets only one advancer act at a time, and expires on its own, so a worker
--     or API restart mid-step resumes rather than duplicates;
--   * an approval is a whole bundle of exact content, decided by a person through the API only;
--   * prepared communications are content, never "sent" without a provider's message id, and can be
--     delivered by a person with evidence until a mailbox is connected.
--
-- ASAP's engine writes runs and steps with the service connection inside the API (the worker
-- schedules, the API is the engine — as for events). Members read them under RLS. People act on
-- them only through security-definer functions that need the server key, the right permission,
-- and write the audit row.

create table workflow_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workflow        text not null check (workflow in ('renewal')),
  subject_type    text not null check (subject_type in ('policy_period')),
  subject_id      uuid not null,
  work_item_id    uuid references work_items(id) on delete set null,
  state           text not null default 'running'
                  check (state in ('running', 'waiting_approval', 'waiting_party', 'exception', 'done', 'cancelled')),
  current_step    text,
  -- Plain words: what stopped it, what is needed, who can supply it. Never a stack trace.
  exception       jsonb,
  next_run_at     timestamptz not null default now(),
  lease_until     timestamptz,
  facts           jsonb not null default '{}'::jsonb,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz,
  constraint workflow_runs_exception_when_excepted check ((state = 'exception') = (exception is not null)),
  constraint workflow_runs_finished_when_terminal check ((state in ('done', 'cancelled')) = (finished_at is not null))
);
create unique index workflow_runs_one_live_per_subject on workflow_runs (organization_id, workflow, subject_id)
  where state not in ('done', 'cancelled');
create index workflow_runs_organization_id_idx on workflow_runs (organization_id);
create index workflow_runs_due_idx on workflow_runs (next_run_at) where state not in ('done', 'cancelled', 'exception');
create index workflow_runs_work_item_id_idx on workflow_runs (work_item_id);

create table workflow_steps (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id          uuid not null references workflow_runs(id) on delete cascade,
  step_key        text not null check (step_key ~ '^[a-z][a-z_]{1,40}$'),
  position        integer not null,
  label           text not null,
  state           text not null default 'pending'
                  check (state in ('pending', 'running', 'done', 'waiting', 'failed', 'skipped')),
  attempts        integer not null default 0 check (attempts >= 0),
  max_attempts    integer not null default 3 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz,
  due_at          timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  -- What the step found or produced. Business values here are read from records, never authored.
  output          jsonb not null default '{}'::jsonb,
  -- References that prove it: [{label, kind, ref}] — a document, a record, a rule and its source.
  evidence        jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  error           text,
  updated_at      timestamptz not null default now(),
  constraint workflow_steps_one_per_key unique (run_id, step_key)
);
create index workflow_steps_organization_id_idx on workflow_steps (organization_id);

create table workflow_approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id          uuid not null references workflow_runs(id) on delete cascade,
  step_key        text not null,
  title           text not null,
  -- Everything the person approves at once: [{kind, label, ...exact content}].
  bundle          jsonb not null check (jsonb_typeof(bundle) = 'array' and jsonb_array_length(bundle) > 0),
  bundle_sha256   text not null check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  state           text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'superseded')),
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  note            text check (note is null or length(note) <= 1000),
  created_at      timestamptz not null default now(),
  constraint workflow_approvals_decided_whole check ((state in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null))
);
create unique index workflow_approvals_one_pending on workflow_approvals (run_id, step_key) where state = 'pending';
create index workflow_approvals_organization_id_idx on workflow_approvals (organization_id);
create index workflow_approvals_run_id_idx on workflow_approvals (run_id);
create index workflow_approvals_decided_by_idx on workflow_approvals (decided_by);

create table prepared_communications (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  run_id               uuid not null references workflow_runs(id) on delete cascade,
  approval_id          uuid references workflow_approvals(id) on delete set null,
  audience             text not null check (audience in ('client', 'insurer')),
  party_name           text not null check (length(btrim(party_name)) > 0),
  -- A recorded address only; null says plainly that none is on file.
  to_address           text check (to_address is null or to_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject              text not null check (length(btrim(subject)) > 0),
  body_text            text not null check (length(btrim(body_text)) > 0),
  body_sha256          text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  state                text not null default 'prepared' check (state in ('prepared', 'approved', 'delivered', 'sent', 'superseded')),
  quote_request_id     uuid references quote_requests(id) on delete set null,
  delivery_method      text check (delivery_method in ('own_email', 'printed', 'portal', 'hand_delivered', 'phone', 'other')),
  delivery_reference   text check (delivery_reference is null or length(btrim(delivery_reference)) >= 3),
  delivered_at         timestamptz,
  delivered_by         uuid references users(id),
  provider_message_id  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- "Sent" is the provider's word, never ours; "delivered" is a person's, with evidence.
  constraint prepared_communications_sent_has_provider_id check (state <> 'sent' or provider_message_id is not null),
  constraint prepared_communications_delivered_has_evidence check (
    state <> 'delivered' or (delivery_method is not null and delivery_reference is not null and delivered_at is not null and delivered_by is not null))
);
create index prepared_communications_organization_id_idx on prepared_communications (organization_id);
create index prepared_communications_run_id_idx on prepared_communications (run_id);
create index prepared_communications_approval_id_idx on prepared_communications (approval_id);
create index prepared_communications_quote_request_id_idx on prepared_communications (quote_request_id);
create index prepared_communications_delivered_by_idx on prepared_communications (delivered_by);

-- Read by members of the brokerage; written by the engine (service connection) and the functions below.
do $$
declare t text;
begin
  foreach t in array array['workflow_runs', 'workflow_steps', 'workflow_approvals', 'prepared_communications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_select on %I for select to authenticated, asap_worker using (app.can_access(organization_id))', t);
    execute format('grant select on %I to authenticated, asap_worker', t);
    execute format('revoke insert, update, delete on %I from authenticated, asap_worker, anon', t);
    execute format('create trigger "000_through_api" before insert or update or delete on %I for each row execute function app.placement_writes_through_api()', t);
  end loop;
end $$;

-- The engine writes quotation requests with the service connection after a person approved the
-- bundle; the content-digest check those rows carry must be computable by that connection too.
grant execute on function app.quote_request_digest(text, text) to service_role;

-- The engine's lease: only one advancer acts on a run at a time, and a lease left by a process
-- that stopped expires on its own. Service connection only.
create or replace function public.workflow_run_claim(p_run_id uuid, p_now timestamptz, p_until timestamptz)
returns setof workflow_runs
language sql
security invoker
set search_path = public, pg_temp
as $$
  update workflow_runs set lease_until = p_until
   where id = p_run_id
     and state not in ('done', 'cancelled', 'exception')
     and (lease_until is null or lease_until < p_now)
  returning *;
$$;
revoke all on function public.workflow_run_claim(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.workflow_run_claim(uuid, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------
-- A person decides an approval bundle. The bundle digest must be the one they were shown: a
-- bundle that changed since is refused, never approved by implication. The decision emits a
-- semantic event, so the run continues even if this API instance stops a moment later.
create or replace function public.workflow_approval_decide(
  p_approval_id uuid, p_decision text, p_bundle_sha256 text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  a workflow_approvals;
begin
  select * into a from workflow_approvals where id = p_approval_id for update;
  if not found or app.current_membership(a.organization_id) is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_permission(a.organization_id, 'email', 'approve') then
    perform app.engine_audit(a.organization_id, v_user, 'workflow.approval_decide', 'workflow_run', a.run_id, null, null, 'denied', 'permission_denied');
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'bad_decision' using errcode = '23514'; end if;
  if a.state <> 'pending' then
    return jsonb_build_object('id', a.id, 'state', a.state, 'changed', false);
  end if;
  if a.bundle_sha256 <> p_bundle_sha256 then raise exception 'bundle_changed' using errcode = '23514'; end if;
  if p_decision = 'reject' and (p_note is null or length(btrim(p_note)) < 3) then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  update workflow_approvals set
    state = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    decided_by = v_user, decided_at = now(), note = p_note
   where id = a.id;
  update prepared_communications set state = 'approved', updated_at = now()
   where approval_id = a.id and state = 'prepared' and p_decision = 'approve';
  update workflow_runs set next_run_at = now(), updated_at = now() where id = a.run_id;
  perform app.engine_audit(a.organization_id, v_user,
    case when p_decision = 'approve' then 'workflow.bundle_approved' else 'workflow.bundle_rejected' end,
    'workflow_run', a.run_id, jsonb_build_object('state', 'pending'),
    jsonb_build_object('state', p_decision, 'approval_id', a.id, 'bundle_sha256', a.bundle_sha256, 'note', p_note));
  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (a.organization_id, 'workflow.approval_decided', 'workflow_run', a.run_id, 'user', v_user,
          jsonb_build_object('approvalId', a.id, 'decision', p_decision));
  return jsonb_build_object('id', a.id, 'state', case when p_decision = 'approve' then 'approved' else 'rejected' end, 'changed', true);
end $$;
revoke all on function public.workflow_approval_decide(uuid, text, text, text) from public, anon;
grant execute on function public.workflow_approval_decide(uuid, text, text, text) to authenticated;

-- A person delivered an approved communication outside ASAP (no mailbox connected), with evidence.
create or replace function public.prepared_communication_record_delivery(
  p_id uuid, p_method text, p_reference text, p_delivered_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  m prepared_communications;
begin
  select * into m from prepared_communications where id = p_id for update;
  if not found or app.current_membership(m.organization_id) is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not app.has_permission(m.organization_id, 'space', 'create') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if m.state = 'delivered' then return jsonb_build_object('id', m.id, 'changed', false); end if;
  if m.state <> 'approved' then raise exception 'not_approved' using errcode = '23514'; end if;
  if p_delivered_at > now() + interval '5 minutes' then raise exception 'delivered_in_future' using errcode = '23514'; end if;
  update prepared_communications set state = 'delivered', delivery_method = p_method, delivery_reference = p_reference,
         delivered_at = p_delivered_at, delivered_by = v_user, updated_at = now()
   where id = m.id;
  update workflow_runs set next_run_at = now(), updated_at = now() where id = m.run_id;
  perform app.engine_audit(m.organization_id, v_user, 'workflow.communication_delivered', 'workflow_run', m.run_id, null,
    jsonb_build_object('communication_id', m.id, 'audience', m.audience, 'method', p_method, 'reference', p_reference));
  insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
  values (m.organization_id, 'workflow.communication_delivered', 'workflow_run', m.run_id, 'user', v_user,
          jsonb_build_object('communicationId', m.id));
  return jsonb_build_object('id', m.id, 'changed', true);
end $$;
revoke all on function public.prepared_communication_record_delivery(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.prepared_communication_record_delivery(uuid, text, text, timestamptz) to authenticated;

-- What the renewal window means for this brokerage. Without a rule, ASAP uses a documented product
-- default (60 days ahead, chase after 5 days) and says so wherever the run shows it.
comment on table workflow_runs is
  'Durable multi-step work ASAP carries (D-129): one live run per workflow and subject, leased, resumable, audited.';
