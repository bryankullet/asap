/*
 * 0059 — Prepared actions may be about a policy (4C-1).
 *
 * The Policy Space lets Ask prepare one workflow action — starting a renewal — through the same
 * prepare → confirm → execute store as every placement action. That store could only be scoped to
 * a placement or an opportunity, so a policy-scoped proposal had nowhere to live. This adds a
 * nullable, indexed policy_id, admits it as a subject, adds the one action type, and keeps the
 * guard's rule that what a prepared action will do can never change after it was prepared.
 *
 * Additive only. No existing row changes meaning; RLS, grants and the API-only gate on
 * prepared_actions are unchanged.
 */

alter table prepared_actions
  add column policy_id uuid references policies(id) on delete cascade;
create index prepared_actions_policy_id_idx on prepared_actions (policy_id);

alter table prepared_actions drop constraint prepared_actions_has_a_subject;
alter table prepared_actions add constraint prepared_actions_has_a_subject
  check (placement_id is not null or opportunity_id is not null or policy_id is not null);

alter table prepared_actions drop constraint prepared_actions_action_type_check;
alter table prepared_actions add constraint prepared_actions_action_type_check check (action_type in (
  'record_instruction','prepare_request','request_approval','approve_request','record_submission',
  'record_insurer_response','record_client_acceptance','prepare_issuance',
  'prepare_issuance_request','approve_issuance_request','record_issuance_submission',
  'resolve_issued_policy_difference','apply_issued_policy','correct_cover_period',
  'start_renewal'));

/* A policy-scoped proposal is only ever about a policy in the same brokerage. */
alter table prepared_actions add constraint prepared_actions_start_renewal_is_about_a_policy
  check (action_type <> 'start_renewal' or policy_id is not null);

create or replace function app.prepared_actions_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := app.require_api_caller();
begin
  if tg_op = 'INSERT' then
    if new.prepared_by <> v_user or new.state <> 'prepared' or new.decided_by is not null
       or new.decided_at is not null or new.receipt is not null then
      raise exception 'A prepared action is prepared by the caller, and starts undecided.'
        using errcode = '42501';
    end if;
    if new.policy_id is not null and not exists (
      select 1 from policies p where p.id = new.policy_id and p.organization_id = new.organization_id)
    then
      raise exception 'A prepared action is about a policy in its own brokerage.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.state <> 'prepared' then
    raise exception 'This prepared action was already decided.' using errcode = '23514';
  end if;
  if (new.organization_id, new.placement_id, new.opportunity_id, new.policy_id, new.action_type, new.payload,
      new.source_versions, new.fingerprint, new.changes, new.blockers, new.permitted,
      new.requires_confirmation, new.idempotency_key, new.prepared_by, new.prepared_at, new.expires_at)
     is distinct from
     (old.organization_id, old.placement_id, old.opportunity_id, old.policy_id, old.action_type, old.payload,
      old.source_versions, old.fingerprint, old.changes, old.blockers, old.permitted,
      old.requires_confirmation, old.idempotency_key, old.prepared_by, old.prepared_at, old.expires_at)
  then
    raise exception 'What a prepared action will do cannot be changed. Prepare it again.'
      using errcode = '42501';
  end if;
  if new.state <> 'expired' and old.prepared_by <> v_user then
    raise exception 'A prepared action is decided by the person who prepared it.' using errcode = '42501';
  end if;
  if new.decided_by is not null and new.decided_by <> v_user then
    raise exception 'A prepared action is decided by the person deciding it.' using errcode = '42501';
  end if;
  if new.state = 'executed' and old.expires_at <= now() then
    raise exception 'This prepared action expired before it was confirmed.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.prepared_actions_guard() from public;

/* Ask may be asked from a Policy Space: "is this policy active?" means this policy. */
alter table conversations drop constraint conversations_scope_kind_check;
alter table conversations add constraint conversations_scope_kind_check
  check (scope_kind in ('brokerage', 'client', 'record', 'opportunity', 'placement', 'policy'));
