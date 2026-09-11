-- 0038: recording a policy the brokerage already places.
--
-- A brokerage that signs up today has a book already. Until now there was no way to put it in:
-- clients could be created, work could be started, but the policy every piece of work is *about*
-- could only arrive through the seed. This is the gap that made the first run impossible to
-- finish (D-068).
--
-- What it records, and nothing more: who the cover is for, which insurer carries it, what class it
-- is, its number if there is one, and the period of cover. Not a schedule, not a premium, not a
-- status — those arrive with their own evidence, through their own steps. A policy row here is a
-- statement that this cover exists, not a claim about what it says.
--
-- Idempotent on the pair a broker would consider "the same policy": the same client, class and
-- policy number. Asking twice returns what is already there and adds the period only if that
-- exact period is missing, so a double-submitted form cannot split one policy in two.
create or replace function public.policy_create(
  p_client_id        uuid,
  p_insurer_name     text,
  p_class_of_business text,
  p_policy_number    text,
  p_period_start     date,
  p_period_end       date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := app.require_api_caller();
  v_org       uuid;
  v_insurer   uuid;
  v_policy    uuid;
  v_period    uuid;
  v_created   boolean := false;
  v_number    text := nullif(btrim(coalesce(p_policy_number, '')), '');
begin
  -- The client decides the brokerage: a policy can only belong where its client does.
  select organization_id into v_org from clients where id = p_client_id and deleted_at is null;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_insurer_name, ''))) = 0 then
    raise exception 'insurer_required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_class_of_business, ''))) = 0 then
    raise exception 'class_of_business_required' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'period_required' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'period_end_before_start' using errcode = '22023';
  end if;

  -- The insurer, by name. A brokerage's first policy is also its first insurer, and asking someone
  -- to create the insurer separately before they can record cover is a form, not a workflow.
  insert into insurers (organization_id, name) values (v_org, btrim(p_insurer_name))
  on conflict (organization_id, name) do update set updated_at = now(), deleted_at = null
  returning id into v_insurer;

  -- The same client, class and number is the same policy.
  select id into v_policy from policies
   where organization_id = v_org
     and client_id = p_client_id
     and class_of_business = btrim(p_class_of_business)
     and coalesce(policy_number, '') = coalesce(v_number, '')
     and deleted_at is null;

  if v_policy is null then
    insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (v_org, p_client_id, v_insurer, btrim(p_class_of_business), v_number)
    returning id into v_policy;
    v_created := true;

    -- Version 1: the policy as recorded, with nothing itemised. An endorsement writes version 2
    -- with what actually changed; recording cover does not pretend to know the schedule.
    insert into policy_versions (organization_id, policy_id, version, effective_from, effective_to,
                                 source, items, created_by)
    values (v_org, v_policy, 1, p_period_start, p_period_end, 'import', '[]'::jsonb, v_user);
  end if;

  select id into v_period from policy_periods
   where policy_id = v_policy and period_start = p_period_start and period_end = p_period_end;
  if v_period is null then
    insert into policy_periods (organization_id, policy_id, period_start, period_end)
    values (v_org, v_policy, p_period_start, p_period_end)
    returning id into v_period;
  end if;

  perform app.engine_audit(
    v_org, v_user,
    case when v_created then 'policy.recorded' else 'policy.period_recorded' end,
    'policy', v_policy, null,
    jsonb_build_object(
      'client_id', p_client_id,
      'insurer', btrim(p_insurer_name),
      'class_of_business', btrim(p_class_of_business),
      'policy_number', v_number,
      'period_start', p_period_start,
      'period_end', p_period_end));

  return jsonb_build_object(
    'policy_id', v_policy, 'period_id', v_period, 'insurer_id', v_insurer, 'created', v_created);
end; $$;
revoke all on function public.policy_create(uuid, text, text, text, date, date) from public;
grant execute on function public.policy_create(uuid, text, text, text, date, date) to authenticated;
