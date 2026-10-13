-- Reversal of migrations 0079–0091 (D-169). NOT a migration: it is kept outside supabase/migrations
-- and run only by a person, deliberately, under the recovery plan in docs/release/RELEASE-0079-0091.md.
--
-- Prefer fixing forward. Run this only if the Intelligent UI release must be withdrawn and the
-- point-in-time restore is not wanted. It removes what 0079–0091 added and restores the four
-- functions 0085 changed to their 0078 definitions, taken verbatim from a 0078 database.
--
-- WARNING: restoring the 0085 functions re-opens the gap 0085 closed (a read-only member could
-- write claim and policy-change records by calling the API directly). Withdraw the API release first.
--
-- Data written by the release lives only in surface_preferences, work_handovers and
-- renewal_proposals. Back them up before running this (the plan gives the command); they are dropped.
-- Every other table is untouched — rehearsed against a populated database with a before/after
-- fingerprint of every table (scripts/release/snapshot.sql).
begin;

-- 0090
drop function if exists public.renewal_proposal_save(uuid, uuid[], text);
drop table if exists public.renewal_proposals;
-- 0087
drop function if exists public.work_handover_acknowledge(uuid);
drop function if exists public.work_item_hand_over(uuid, integer, uuid, text, text, text);
drop table if exists public.work_handovers;
-- 0080
drop table if exists public.surface_preferences;

-- 0079, 0081–0084, 0086, 0088–0091: the Living registry rows (no table references component_definitions).
delete from public.component_definitions where 'living' = any(allowed_spaces) and (component_id, version) in (
    ('ContextHeader', 1),
    ('RenewalJourney', 1),
    ('ProgressOpportunity', 1),
    ('ObligationTracker', 1),
    ('ChangeComparison', 1),
    ('ConsequencePanel', 1),
    ('CoverageEffectiveState', 1),
    ('QuoteComparison', 1),
    ('PlacementProgress', 1),
    ('EvidenceInspector', 1),
    ('Timeline', 1),
    ('ApprovalBundle', 1),
    ('QueryInterpretation', 1),
    ('PortfolioGroups', 1),
    ('ExplorationPanel', 1),
    ('WorkJourney', 1),
    ('WorkChecklist', 1),
    ('FocusPanel', 1),
    ('ArrivedMail', 1),
    ('HandoverNote', 1),
    ('RelatedWork', 1),
    ('ResponsePatterns', 1),
    ('DecisionTrail', 1),
    ('RenewalJourney', 2),
    ('ProposalVersions', 1),
    ('RelatedWork', 2));

-- 0085: the claim and policy-change write functions as they were at 0078.
CREATE OR REPLACE FUNCTION app.claim_for_write(p_claim_id uuid)
 RETURNS claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c claims;
begin
  select * into c from claims where id = p_claim_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(c.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return c;
end; $function$
;

CREATE OR REPLACE FUNCTION app.endorsement_for_write(p_id uuid)
 RETURNS endorsements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare e endorsements;
begin
  select * into e from endorsements where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(e.organization_id) is null then raise exception 'not_a_member' using errcode = '42501'; end if;
  return e;
end; $function$
;

CREATE OR REPLACE FUNCTION public.claim_create(p_work_item_id uuid, p_client_id uuid, p_policy_id uuid, p_incident_on date, p_summary text, p_source text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.endorsement_create(p_work_item_id uuid, p_policy_id uuid, p_kind text, p_requested_by text, p_requested_by_name text, p_request_text text, p_effective_on date, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end; $function$
;

revoke all on function app.claim_for_write(uuid) from public;
revoke all on function app.endorsement_for_write(uuid) from public;
revoke all on function public.claim_create(uuid, uuid, uuid, date, text, text) from public, anon;
grant execute on function public.claim_create(uuid, uuid, uuid, date, text, text) to authenticated;
revoke all on function public.endorsement_create(uuid, uuid, text, text, text, text, date, jsonb) from public, anon;
grant execute on function public.endorsement_create(uuid, uuid, text, text, text, text, date, jsonb) to authenticated;

-- Supabase's migration history, where it exists, forgets the withdrawn versions.
do $$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version between '20261022100000' and '20261103100000';
  end if;
end $$;

commit;
