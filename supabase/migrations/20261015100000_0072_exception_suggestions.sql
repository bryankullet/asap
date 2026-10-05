-- 0072 — Autonomy build, phase 8 (D-146): one suggested fix for a run that could not finish.
--
-- When a run stops with an exception, ASAP looks into why — reading only the run's own brokerage —
-- and writes one suggestion with the evidence it rests on. A proposal: a person accepts or rejects
-- it, and accepting runs the ordinary path a person would use. With no model, there is none.

create table exception_suggestions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id          uuid not null references workflow_runs(id) on delete cascade,
  -- The event that reported the exception: one suggestion per occurrence, however often it is delivered.
  event_id        uuid not null unique,
  exception_code  text not null,
  suggestion      text not null check (length(btrim(suggestion)) between 10 and 600),
  evidence        jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  -- What accepting does, from a fixed list: {"type":"record_insurer_contact","insurerId":…,"email":…} or null.
  action          jsonb,
  confidence      numeric(4, 3) check (confidence between 0 and 1),
  model           text not null,
  state           text not null default 'proposed' check (state in ('proposed', 'accepted', 'rejected')),
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  constraint exception_suggestions_decided_whole check ((state = 'proposed') = (decided_by is null and decided_at is null))
);
create index exception_suggestions_organization_id_idx on exception_suggestions (organization_id);
create index exception_suggestions_run_id_idx on exception_suggestions (run_id);
create index exception_suggestions_decided_by_idx on exception_suggestions (decided_by);
comment on table exception_suggestions is 'One suggested fix for a stopped run, with its evidence (D-146). A proposal: a person accepts or rejects it.';

alter table exception_suggestions enable row level security;
create policy tenant_select on exception_suggestions for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on exception_suggestions to authenticated, asap_worker;
revoke insert, update, delete on exception_suggestions from authenticated, asap_worker, anon;
create trigger "000_through_api" before insert or update or delete on exception_suggestions
  for each row execute function app.placement_writes_through_api();

create or replace function public.exception_suggestion_decide(p_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
  s exception_suggestions;
begin
  select * into s from exception_suggestions where id = p_id for update;
  if not found or app.current_membership(s.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(s.organization_id, 'policy', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if s.state <> 'proposed' then return jsonb_build_object('state', s.state, 'changed', false, 'action', s.action); end if;
  if p_decision not in ('accept', 'reject') then raise exception 'bad_decision' using errcode = '23514'; end if;
  if p_decision = 'reject' and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'reason_required' using errcode = '23514'; end if;
  update exception_suggestions set state = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
         decided_by = v_user, decided_at = now(), decision_note = p_note where id = s.id;
  perform app.engine_audit(s.organization_id, v_user, 'workflow.suggestion_' || case when p_decision = 'accept' then 'accepted' else 'rejected' end,
                           'workflow_run', s.run_id, jsonb_build_object('state', 'proposed'),
                           jsonb_build_object('suggestion_id', s.id, 'action', s.action, 'note', p_note));
  return jsonb_build_object('state', case when p_decision = 'accept' then 'accepted' else 'rejected' end, 'changed', true, 'action', s.action);
end $$;
revoke all on function public.exception_suggestion_decide(uuid, text, text) from public, anon;
grant execute on function public.exception_suggestion_decide(uuid, text, text) to authenticated;
