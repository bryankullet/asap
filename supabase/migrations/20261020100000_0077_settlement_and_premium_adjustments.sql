-- 0077 — Claim settlement amounts and endorsement premium adjustments (D-154).
--
-- Both are a person's record of a figure on the insurer's own paper. No money moves and no model
-- writes either: ASAP's runs read them to know what is next and to name the figure in Work.
--  - A claim's offer and payment (0028 recorded only their references) gain the amount, currency and,
--    for the payment, the date it was received — from the discharge voucher and the receipt.
--  - An endorsement's premium adjustment: additional or return premium on the insurer's debit or
--    credit note, or "none", with the person's reason.

alter table claims
  add column offer_amount   numeric(14,2) check (offer_amount is null or offer_amount >= 0),
  add column offer_currency text check (offer_currency is null or offer_currency ~ '^[A-Z]{3}$'),
  add column paid_amount    numeric(14,2) check (paid_amount is null or paid_amount >= 0),
  add column paid_currency  text check (paid_currency is null or paid_currency ~ '^[A-Z]{3}$'),
  add column paid_on        date,
  add constraint claims_offer_amount_whole check ((offer_amount is null) = (offer_currency is null)),
  add constraint claims_offer_amount_needs_reference check (offer_amount is null or offer_reference is not null),
  add constraint claims_paid_amount_whole check ((paid_amount is null) = (paid_currency is null) and (paid_amount is null) = (paid_on is null)),
  add constraint claims_paid_amount_needs_reference check (paid_amount is null or payment_reference is not null);

-- The figure for a fact already recorded by claim_fact_record, once. A wrong figure is corrected by
-- an exception on the Work item, never overwritten here.
create or replace function public.claim_amount_record(p_claim_id uuid, p_fact text, p_amount numeric, p_currency text, p_paid_on date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); c claims;
begin
  c := app.claim_for_write(p_claim_id);
  if p_amount is null or p_amount < 0 or p_currency is null or p_currency !~ '^[A-Z]{3}$' then raise exception 'amount_required' using errcode = '22023'; end if;
  case p_fact
    when 'offer' then
      if c.offer_reference is null then raise exception 'reference_first' using errcode = '22023'; end if;
      if c.offer_amount is not null then raise exception 'already_recorded' using errcode = '23505'; end if;
      update claims set offer_amount = p_amount, offer_currency = p_currency, updated_at = now() where id = p_claim_id;
    when 'payment' then
      if c.payment_reference is null then raise exception 'reference_first' using errcode = '22023'; end if;
      if c.paid_amount is not null then raise exception 'already_recorded' using errcode = '23505'; end if;
      if p_paid_on is null or p_paid_on > current_date then raise exception 'paid_on_required' using errcode = '22023'; end if;
      update claims set paid_amount = p_amount, paid_currency = p_currency, paid_on = p_paid_on, updated_at = now() where id = p_claim_id;
    else
      raise exception 'unknown_fact' using errcode = '22023';
  end case;
  perform app.engine_audit(c.organization_id, v_user, 'claim.' || p_fact || '_amount_recorded', 'claim', p_claim_id, null,
                           jsonb_build_object('amount', p_amount, 'currency', p_currency, 'paidOn', p_paid_on));
end; $$;
revoke all on function public.claim_amount_record(uuid, text, numeric, text, date) from public, anon;
grant execute on function public.claim_amount_record(uuid, text, numeric, text, date) to authenticated;

create table endorsement_premium_adjustments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  endorsement_id   uuid not null references endorsements(id) on delete cascade,
  direction        text not null check (direction in ('additional', 'return', 'none')),
  amount           numeric(14,2) check (amount is null or amount > 0),
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- The insurer's debit or credit note number; for "none", the person's reason.
  reference        text not null check (length(btrim(reference)) > 0),
  recorded_by      uuid not null references users(id),
  recorded_at      timestamptz not null default now(),
  constraint endorsement_premium_adjustments_one unique (endorsement_id),
  constraint endorsement_premium_adjustments_amount check ((direction = 'none') = (amount is null) and (amount is null) = (currency is null))
);
create index endorsement_premium_adjustments_organization_id_idx on endorsement_premium_adjustments (organization_id);
create index endorsement_premium_adjustments_recorded_by_idx on endorsement_premium_adjustments (recorded_by);
comment on table endorsement_premium_adjustments is 'An endorsement''s additional or return premium as the insurer''s note states it, recorded by a person (D-154). No money moves.';

alter table endorsement_premium_adjustments enable row level security;
create policy tenant_select on endorsement_premium_adjustments for select to authenticated, asap_worker using (app.can_access(organization_id));
grant select on endorsement_premium_adjustments to authenticated, asap_worker;
revoke insert, update, delete on endorsement_premium_adjustments from authenticated, asap_worker, anon;

create or replace function public.endorsement_premium_record(p_endorsement_id uuid, p_direction text, p_amount numeric, p_currency text, p_reference text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := app.require_api_caller(); e endorsements; v_id uuid;
begin
  e := app.endorsement_for_write(p_endorsement_id);
  if p_direction not in ('additional', 'return', 'none') then raise exception 'bad_direction' using errcode = '22023'; end if;
  if p_reference is null or length(btrim(p_reference)) = 0 then raise exception 'evidence_required' using errcode = '22023'; end if;
  if p_direction <> 'none' and (p_amount is null or p_amount <= 0 or p_currency is null or p_currency !~ '^[A-Z]{3}$') then raise exception 'amount_required' using errcode = '22023'; end if;
  if exists (select 1 from endorsement_premium_adjustments where endorsement_id = p_endorsement_id) then raise exception 'already_recorded' using errcode = '23505'; end if;
  insert into endorsement_premium_adjustments (organization_id, endorsement_id, direction, amount, currency, reference, recorded_by)
  values (e.organization_id, p_endorsement_id, p_direction,
          case when p_direction = 'none' then null else p_amount end, case when p_direction = 'none' then null else p_currency end,
          btrim(p_reference), v_user)
  returning id into v_id;
  perform app.engine_audit(e.organization_id, v_user, 'endorsement.premium_recorded', 'endorsement', p_endorsement_id, null,
                           jsonb_build_object('direction', p_direction, 'amount', p_amount, 'currency', p_currency, 'reference', btrim(p_reference)));
  return v_id;
end; $$;
revoke all on function public.endorsement_premium_record(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.endorsement_premium_record(uuid, text, numeric, text, text) to authenticated;
