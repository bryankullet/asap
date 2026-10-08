-- 0069 — Autonomy build, phase 5 (D-143): claims and endorsements on the engine.
--
-- 1. An endorsement is a workflow subject: the endorsement run is about the endorsement record,
--    found from the endorsement's own events.
-- 2. A workflow run may complete a step on its Work item only where the step is ASAP's own — or
--    a send step whose message a person approved and recorded as delivered. It may never complete
--    a person's, an insurer's, a client's or the bank's step. One function, the API's service
--    connection only, audited as the automation.
-- 3. The claim run records its cover-on-the-incident-date sentence through its own function, the
--    same write a person's cover check makes.

alter table workflow_runs drop constraint workflow_runs_subject_type_check;
alter table workflow_runs add constraint workflow_runs_subject_type_check
  check (subject_type in ('policy_period', 'opportunity', 'placement', 'policy', 'claim', 'work_item', 'endorsement'));

create or replace function app.live_run(p_run_id uuid)
returns workflow_runs language plpgsql security definer set search_path = public, pg_temp as $$
declare r workflow_runs;
begin
  select * into r from workflow_runs where id = p_run_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.state in ('done', 'cancelled') then raise exception 'run_finished' using errcode = '23514'; end if;
  return r;
end $$;
revoke all on function app.live_run(uuid) from public;

create or replace function public.work_item_step_by_run(p_run_id uuid, p_step_id text, p_note text, p_communication_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r workflow_runs := app.live_run(p_run_id);
  w work_items;
  s jsonb;
  idx int;
  nxt int;
  v_steps jsonb;
  m prepared_communications;
  ev jsonb := null;
begin
  if r.work_item_id is null then raise exception 'run_has_no_work' using errcode = '23514'; end if;
  select * into w from work_items where id = r.work_item_id and organization_id = r.organization_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select x.value, x.ordinality::int - 1 into s, idx from jsonb_array_elements(w.steps) with ordinality x where x.value ->> 'id' = p_step_id;
  if s is null then raise exception 'no_such_step' using errcode = '22023'; end if;
  if s ->> 'state' = 'done' then return jsonb_build_object('changed', false); end if;
  if s ->> 'state' not in ('now', 'blocked') then raise exception 'not_the_current_step' using errcode = '23514'; end if;

  if s ->> 'actor' <> 'asap' then
    -- A person's send step, completed only on a message this run prepared, a person approved, and
    -- a person (or the connected mailbox) delivered.
    if p_communication_id is null or not exists (
      select 1 from jsonb_array_elements(s -> 'evidence') e where e.value ->> 'kind' = 'record_send') then
      raise exception 'not_asaps_step' using errcode = '42501';
    end if;
    select * into m from prepared_communications where id = p_communication_id and run_id = r.id;
    if not found or m.state not in ('delivered', 'sent') then raise exception 'not_delivered' using errcode = '23514'; end if;
    ev := jsonb_build_object('kind', 'record_send', 'reference', coalesce(m.delivery_reference, m.provider_message_id),
                             'recordedBy', m.delivered_by, 'recordedAt', coalesce(m.delivered_at, m.updated_at));
  end if;

  v_steps := jsonb_set(w.steps, array[idx::text], s || jsonb_build_object('state', 'done', 'reason', p_note)
    || case when ev is null then '{}'::jsonb else jsonb_build_object('recorded', coalesce(s -> 'recorded', '[]'::jsonb) || jsonb_build_array(ev)) end);
  select min(x.ordinality::int - 1) into nxt from jsonb_array_elements(v_steps) with ordinality x
   where x.ordinality::int - 1 > idx and x.value ->> 'state' = 'todo';
  if nxt is not null then
    v_steps := jsonb_set(v_steps, array[nxt::text], (v_steps -> nxt) || jsonb_build_object('state', 'now'));
  end if;
  update work_items set steps = v_steps, version = version + 1, updated_at = now() where id = w.id;
  insert into audit_log (organization_id, actor_type, action, object_type, object_id, previous_state, new_state)
  values (r.organization_id, 'automation', 'work_item.step_by_run', 'work_item', w.id,
          jsonb_build_object('step', p_step_id, 'state', s ->> 'state'),
          jsonb_build_object('step', p_step_id, 'state', 'done', 'note', p_note, 'byRun', r.id, 'communicationId', p_communication_id));
  return jsonb_build_object('changed', true);
end $$;
revoke all on function public.work_item_step_by_run(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.work_item_step_by_run(uuid, text, text, uuid) to service_role;

create or replace function public.claim_set_cover_review_by_run(p_run_id uuid, p_review text, p_version_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r workflow_runs := app.live_run(p_run_id); c claims;
begin
  if r.workflow <> 'claim' then raise exception 'not_a_claim_run' using errcode = '42501'; end if;
  select * into c from claims where id = r.subject_id and organization_id = r.organization_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update claims set cover_review = p_review, cover_review_version_id = p_version_id, updated_at = now() where id = c.id;
  insert into audit_log (organization_id, actor_type, action, object_type, object_id, previous_state, new_state)
  values (r.organization_id, 'automation', 'claim.cover_reviewed', 'claim', c.id,
          jsonb_build_object('cover_review', c.cover_review), jsonb_build_object('cover_review', p_review, 'byRun', r.id));
end $$;
revoke all on function public.claim_set_cover_review_by_run(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_set_cover_review_by_run(uuid, text, uuid) to service_role;

-- The claim run finds the policy version in force on the incident date, as the cover check does.
grant execute on function public.policy_version_on(uuid, date) to service_role;
