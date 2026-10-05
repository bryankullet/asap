-- 0075 — An email that reports a claim or asks for a policy change opens a draft (D-151).
--
-- When the model is sure enough what the email is, the sender is exactly one client's recorded
-- contact, and the facts the record needs are in the email itself (a claim's incident date; an
-- endorsement's policy), ASAP opens a DRAFT claim or endorsement for a person to confirm — the same
-- Work item, record and start event a person's "report a claim" or "change a policy" makes. A claim
-- is a draft until a person matches it to a policy period; an endorsement asks nothing of anyone
-- until a person approves the request. Otherwise the email stays Unsorted, as before.

alter table inbound_classifications drop constraint inbound_classifications_state_check;
alter table inbound_classifications add constraint inbound_classifications_state_check
  check (state in ('proposed', 'routed', 'unsorted', 'dismissed', 'opened'));
alter table inbound_classifications add constraint inbound_classifications_opened_has_work
  check (state <> 'opened' or work_item_id is not null);

create or replace function public.inbound_open_draft(
  p_email_message_id uuid, p_kind text, p_title text, p_client_id uuid, p_policy_id uuid, p_insurer_id uuid, p_class_of_business text,
  p_steps jsonb, p_task_status text, p_task_party text, p_incident_on date, p_text text, p_endorsement_kind text, p_requested_by_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m email_messages;
  c inbound_classifications;
  v_work uuid;
  v_record uuid;
  v_reopened boolean := false;
begin
  select * into m from email_messages where id = p_email_message_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from inbound_classifications where email_message_id = m.id for update;
  if not found or c.source <> 'model' or c.kind is distinct from (case p_kind when 'claim' then 'claim_notice' else 'endorsement_request' end) then
    raise exception 'not_proposed' using errcode = '23514';
  end if;
  if c.state in ('opened', 'routed', 'dismissed') then return jsonb_build_object('workItemId', c.work_item_id, 'changed', false); end if;
  if not exists (select 1 from clients where id = p_client_id and organization_id = m.organization_id and deleted_at is null) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if p_policy_id is not null and not exists (select 1 from policies where id = p_policy_id and organization_id = m.organization_id and client_id = p_client_id and deleted_at is null) then
    raise exception 'policy_not_this_clients' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(m.organization_id::text || ':' || p_kind || ':' || p_title));
  select id into v_work from work_items where organization_id = m.organization_id and kind = p_kind and title = p_title
     and task_status <> 'done' and exception is null and deleted_at is null limit 1;
  if v_work is not null then
    v_reopened := true;
  else
    insert into work_items (organization_id, title, kind, task_status, task_party, task_since, reason, steps, client_id, insurer_id, class_of_business)
    values (m.organization_id, p_title, p_kind, p_task_status, p_task_party, case when p_task_status = 'with_party' then now() end,
            'Opened by ASAP from the email from ' || m.from_address || ' — a draft for a person to confirm.', p_steps, p_client_id, p_insurer_id, p_class_of_business)
    returning id into v_work;
    if p_kind = 'claim' then
      if p_incident_on is null then raise exception 'incident_date_required' using errcode = '22023'; end if;
      insert into claims (organization_id, work_item_id, client_id, policy_id, source, incident_on, incident_summary)
      values (m.organization_id, v_work, p_client_id, p_policy_id, 'email', p_incident_on, btrim(p_text)) returning id into v_record;
      insert into events (organization_id, event_type, entity_type, entity_id, actor, payload, dedupe_key)
      values (m.organization_id, 'claim.reported', 'claim', v_record, 'automation', jsonb_build_object('claimId', v_record, 'workItemId', v_work, 'clientId', p_client_id, 'emailMessageId', m.id), v_record::text);
    elsif p_kind = 'endorsement' then
      if p_policy_id is null then raise exception 'policy_required' using errcode = '22023'; end if;
      insert into endorsements (organization_id, work_item_id, policy_id, kind, requested_by, requested_by_name, request_text, items)
      values (m.organization_id, v_work, p_policy_id, p_endorsement_kind, 'policyholder', p_requested_by_name, btrim(p_text), '[]'::jsonb) returning id into v_record;
      insert into events (organization_id, event_type, entity_type, entity_id, actor, payload, dedupe_key)
      values (m.organization_id, 'endorsement.requested', 'endorsement', v_record, 'automation', jsonb_build_object('endorsementId', v_record, 'workItemId', v_work, 'clientId', p_client_id, 'policyId', p_policy_id, 'emailMessageId', m.id), v_record::text);
    else
      raise exception 'bad_kind' using errcode = '23514';
    end if;
  end if;

  update inbound_classifications set state = 'opened', work_item_id = v_work where id = c.id;
  update email_threads set work_item_id = v_work where id = m.thread_id and work_item_id is null;
  insert into audit_log (organization_id, actor_type, action, object_type, object_id, new_state)
  values (m.organization_id, 'automation', p_kind || '.opened_from_email', 'work_item', v_work,
          jsonb_build_object('emailMessageId', m.id, 'recordId', v_record, 'reopened', v_reopened, 'confidence', c.confidence));
  return jsonb_build_object('workItemId', v_work, 'recordId', v_record, 'changed', true, 'reopened', v_reopened);
end $$;
revoke all on function public.inbound_open_draft(uuid, text, text, uuid, uuid, uuid, text, jsonb, text, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.inbound_open_draft(uuid, text, text, uuid, uuid, uuid, text, jsonb, text, text, date, text, text, text) to service_role;
