-- 0041 — recording what a period of cover costs.
--
-- Found by importing a real book: the commit wrote every client, contact and policy and then
-- silently recorded no premium at all, because `authenticated` has no update grant on
-- `policy_periods` and never should. Every engine write goes through a SECURITY DEFINER function
-- with the API-caller gate on it, and a premium is an engine write like any other.
--
-- What this function will not do, and why:
--
--   - It does not derive one commission figure from the other. Given the statutory levies, a rate
--     and an amount are not interchangeable, so whichever the brokerage did not record stays
--     missing (0039). A figure nobody supplied is not a figure.
--   - It does not mark anything verified. Verification requires naming the document that verifies
--     it, which an import does not have — an imported premium is what the old system said, not
--     what a schedule says.
--   - It refuses a basis it was not given. A premium without a basis is a number without units.

create or replace function public.policy_period_record_premium(
  p_period_id         uuid,
  p_amount            numeric,
  p_currency          text,
  p_basis             text,
  p_commission_rate   numeric,
  p_commission_amount numeric,
  p_source            text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  v_org  uuid;
begin
  select organization_id into v_org from policy_periods where id = p_period_id;
  if v_org is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if p_amount is null or p_currency is null or p_basis is null then
    raise exception 'premium_incomplete' using errcode = '22023';
  end if;
  if p_basis not in ('gross', 'total_payable') then
    raise exception 'premium_basis_unknown' using errcode = '22023';
  end if;
  if coalesce(p_source, '') not in ('manual', 'import', 'document', 'seed') then
    raise exception 'premium_source_unknown' using errcode = '22023';
  end if;

  update policy_periods
     set premium_amount    = p_amount,
         premium_currency  = upper(p_currency),
         premium_basis     = p_basis,
         commission_rate   = p_commission_rate,
         commission_amount = p_commission_amount,
         premium_source    = p_source
   where id = p_period_id;

  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type,
                         object_id, new_state, result)
  values (v_org, 'user', v_user, 'policy_period.premium_recorded', 'policy_period', p_period_id,
          jsonb_build_object('amount', p_amount, 'currency', upper(p_currency), 'basis', p_basis,
                             'source', p_source),
          'success');

  return jsonb_build_object('period_id', p_period_id);
end $$;

revoke all on function public.policy_period_record_premium(uuid, numeric, text, text, numeric, numeric, text) from public;
grant execute on function public.policy_period_record_premium(uuid, numeric, text, text, numeric, numeric, text) to authenticated;
