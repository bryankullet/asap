-- 0085 — Claim and policy-change mutations require the business permission, not only membership (D-164).
--
-- Until now every claim and endorsement mutation checked that the caller was a member of the
-- brokerage (app.claim_for_write, app.endorsement_for_write, and the two create functions). A
-- read-only member could therefore record a claim document, an insurer's decision on an
-- endorsement item, a claim fact or amount, or apply an endorsement, by calling the API directly.
-- The browser's own direct calls were already refused (app.require_api_caller → 'api_only').
--
-- The existing permission matrix (0005, 0014) already says who may do this:
--   claims          claim:create to open one, claim:edit for every change to it
--   policy changes  policy:edit — an endorsement changes a policy
-- The read-only role holds only `view`; the operational roles, managers and administrators hold
-- create/edit on these objects. Nothing new is granted here: the checks are added where the
-- writes already funnel, so all fourteen mutation functions are covered by the two helpers.
--
-- Unchanged: the workflow engine's own function (claim_set_cover_review_by_run, service role) and
-- organization isolation (membership is still required first, so another brokerage still reads
-- not_a_member). Earlier migrations are not edited; these definitions replace them.

create or replace function app.claim_for_write(p_claim_id uuid) returns claims
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims;
begin
  select * into c from claims where id = p_claim_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(c.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(c.organization_id, 'claim', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  return c;
end; $$;
revoke all on function app.claim_for_write(uuid) from public;

create or replace function app.endorsement_for_write(p_id uuid) returns endorsements
language plpgsql security definer set search_path = public, pg_temp as $$
declare e endorsements;
begin
  select * into e from endorsements where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(e.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(e.organization_id, 'policy', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
  return e;
end; $$;
revoke all on function app.endorsement_for_write(uuid) from public;

create or replace function public.claim_create(p_work_item_id uuid, p_client_id uuid, p_policy_id uuid, p_incident_on date, p_summary text, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from work_items where id = p_work_item_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(v_org, 'claim', 'create') then raise exception 'permission_denied' using errcode = '42501'; end if;
  insert into claims (organization_id, work_item_id, client_id, policy_id, source, incident_on, incident_summary)
  values (v_org, p_work_item_id, p_client_id, p_policy_id, p_source, p_incident_on, btrim(p_summary)) returning id into v_id;
  perform app.engine_audit(v_org, v_user, 'claim.captured', 'claim', v_id, null,
                           jsonb_build_object('source', p_source, 'incident_on', p_incident_on, 'status', 'draft'));
  return v_id;
end; $$;
revoke all on function public.claim_create(uuid, uuid, uuid, date, text, text) from public;
grant execute on function public.claim_create(uuid, uuid, uuid, date, text, text) to authenticated;

create or replace function public.endorsement_create(
  p_work_item_id uuid, p_policy_id uuid, p_kind text, p_requested_by text, p_requested_by_name text, p_request_text text,
  p_effective_on date, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); v_org uuid; v_id uuid;
begin
  select organization_id into v_org from work_items where id = p_work_item_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  if not app.has_permission(v_org, 'policy', 'edit') then raise exception 'permission_denied' using errcode = '42501'; end if;
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
