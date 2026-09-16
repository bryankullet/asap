-- 0043 — applying what a document says to the record it is about.
--
-- Accepting an extracted value marked the *field* accepted and changed no business record. A
-- person could accept a premium off a schedule and the policy period would still hold nothing.
--
-- What this migration refuses to do is guess the target. A document links to a client and to a
-- work item; it does not link to a period of cover, and inferring which period a schedule is
-- about would be exactly the inference §45 forbids. So the target is always named by a person,
-- and this table records which document was applied to which record, by whom, and what changed.
--
-- The table is the evidence link, the receipt and the idempotency ledger at once:
--
--   * evidence  — the document that a value came from, per target record, permanently;
--   * receipt   — the changes, with their before and after values, as they were applied;
--   * one write — `(organization_id, idempotency_key)` is unique, so a double-clicked Apply
--                 writes once and the second call returns the first receipt.

create table document_applications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  document_id      uuid not null references documents(id) on delete cascade,
  -- What kind of record received the values. Narrow on purpose: a kind that is not here cannot
  -- be applied to, which is better than a kind that can be applied to wrongly.
  target_type      text not null check (target_type in ('policy_period', 'policy', 'client')),
  target_id        uuid not null,
  /*
   * The changes, as applied: one object per field with `field_key`, `document_field_id`, `from`,
   * `to` and the page the value was read from. Stored rather than recomputed because it is the
   * receipt: what a person was shown and agreed to, which the records themselves stop being
   * able to answer the moment anything else changes them.
   */
  changes          jsonb not null check (jsonb_typeof(changes) = 'array'),
  applied_by       uuid not null references users(id),
  applied_at       timestamptz not null default now(),
  -- The browser's own key for one press of Apply.
  idempotency_key  text not null check (length(btrim(idempotency_key)) between 8 and 200),
  constraint document_applications_org_idempotency_key
    unique (organization_id, idempotency_key)
);

create index document_applications_document_id_idx on document_applications (document_id);
create index document_applications_target_idx
  on document_applications (organization_id, target_type, target_id);
create index document_applications_applied_at_idx
  on document_applications (organization_id, applied_at desc);
-- Every foreign key carries a covering index (0203 asserts it): without this, deleting a user
-- at offboarding scans this table.
create index document_applications_applied_by_idx on document_applications (applied_by);

comment on table document_applications is
  'Which document was applied to which business record, by whom, and what changed. Evidence, '
  'receipt and idempotency ledger in one row. Never written directly: 0043''s definer function '
  'writes it inside the same transaction as the record change.';

alter table document_applications enable row level security;

/*
 * A policy without a grant is a policy nobody reaches: RLS narrows what a role may see, it does
 * not give the role the right to look. Select only — see the note below on why there is no insert.
 */
grant select on document_applications to authenticated;

-- A member of the brokerage may read its own applications: this is the evidence trail behind a
-- figure, and a figure whose evidence you cannot read is not evidenced.
create policy document_applications_read on document_applications
  for select to authenticated
  using (app.can_access(organization_id));

/*
 * No insert, update or delete policy for `authenticated`, deliberately.
 *
 * Every row is written by the definer function below, inside the transaction that changes the
 * business record. A row that exists without its change, or a change without its row, would be a
 * receipt for something that did not happen.
 */

-- ---------------------------------------------------------------------------------------------
-- Reading a figure the way a document prints one.

/*
 * A schedule states a premium as `214,500.00`, and that is what a person accepts: the value as
 * written, comma and all. Casting it straight to numeric fails, and the apply died with an opaque
 * database error — asking somebody to retype a figure to remove a separator the document printed.
 *
 * Only the `1,234.56` shape is accepted as having thousands separators. A string like `1.234,56`
 * is a different convention and reading it either way would be a guess about the size of a
 * premium, so it is refused by name instead and the person corrects it.
 */
create or replace function app.text_to_amount(p_text text)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_clean text;
begin
  if p_text is null then return null; end if;
  -- Currency letters, symbols and spaces go; digits, separators and a sign stay.
  v_clean := regexp_replace(btrim(p_text), '[^0-9.,+-]', '', 'g');
  if v_clean ~ '^[-+]?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$' then
    v_clean := replace(v_clean, ',', '');
  elsif v_clean !~ '^[-+]?[0-9]+(\.[0-9]+)?$' then
    raise exception 'amount_not_a_number: %', p_text using errcode = '22023';
  end if;
  return v_clean::numeric;
end $$;

revoke all on function app.text_to_amount(text) from public;

-- ---------------------------------------------------------------------------------------------
-- Applying the values.

create or replace function public.document_apply_to_record(
  p_document_id     uuid,
  p_target_type     text,
  p_target_id       uuid,
  p_changes         jsonb,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := app.require_api_caller();
  v_org        uuid;
  v_target_org uuid;
  v_existing   document_applications;
  v_change     jsonb;
  v_key        text;
  v_from       text;
  v_to         text;
  v_current    text;
  v_basis      text;
  v_amount     numeric;
  v_currency   text;
  v_org_currency text;
  v_conflicts  jsonb := '[]'::jsonb;
  v_applied    jsonb := '[]'::jsonb;
  v_app_id     uuid;
begin
  -- The document, and whose it is. Nothing is read from the caller about the organization.
  select organization_id into v_org from documents
   where id = p_document_id and deleted_at is null;
  if v_org is null then raise exception 'document_not_found' using errcode = 'P0002'; end if;
  if app.current_membership(v_org) is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'no_changes' using errcode = '22023';
  end if;

  /*
   * Written once. The same key returns the first receipt and touches no record: Apply is a button
   * people double-click, and a second write would apply a value over itself with a stale `from`
   * and look like a conflict.
   */
  select * into v_existing from document_applications
   where organization_id = v_org and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'application_id', v_existing.id,
      'document_id', v_existing.document_id,
      'target_type', v_existing.target_type,
      'target_id', v_existing.target_id,
      'changes', v_existing.changes,
      'applied_at', v_existing.applied_at,
      'repeat', true);
  end if;

  -- The target has to be this brokerage's. Another brokerage's record is not found, not refused:
  -- a refusal would confirm the id exists.
  if p_target_type = 'policy_period' then
    select pp.organization_id into v_target_org from policy_periods pp where pp.id = p_target_id;
  elsif p_target_type = 'policy' then
    select p.organization_id into v_target_org from policies p
     where p.id = p_target_id and p.deleted_at is null;
  elsif p_target_type = 'client' then
    select c.organization_id into v_target_org from clients c
     where c.id = p_target_id and c.deleted_at is null;
  else
    raise exception 'target_type_unknown' using errcode = '22023';
  end if;
  if v_target_org is null or v_target_org <> v_org then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;

  /*
   * Every change is checked against what the record holds *now* before anything is written. The
   * browser sends the value it showed the person; if the record has moved since, the write is
   * refused with the conflicts named. Applying over somebody else's change silently is worse
   * than making a person look again.
   */
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_key  := v_change ->> 'field_key';
    v_from := v_change ->> 'from';
    v_to   := v_change ->> 'to';
    if v_to is null or length(btrim(v_to)) = 0 then
      raise exception 'value_required' using errcode = '22023';
    end if;

    v_current := case
      when p_target_type = 'policy_period' and v_key = 'period_start'
        then (select period_start::text from policy_periods where id = p_target_id)
      when p_target_type = 'policy_period' and v_key = 'period_end'
        then (select period_end::text from policy_periods where id = p_target_id)
      when p_target_type = 'policy_period' and v_key = 'premium'
        then (select premium_amount::text from policy_periods where id = p_target_id)
      when p_target_type = 'policy' and v_key = 'policy_number'
        then (select policy_number from policies where id = p_target_id)
      when p_target_type = 'client' and v_key = 'insured_name'
        then (select name from clients where id = p_target_id)
      else null
    end;

    -- A field this target cannot receive is refused by name, so the interface can say which.
    if not (
      (p_target_type = 'policy_period' and v_key in ('period_start', 'period_end', 'premium')) or
      (p_target_type = 'policy' and v_key = 'policy_number') or
      (p_target_type = 'client' and v_key = 'insured_name')
    ) then
      raise exception 'field_not_applicable_here: %', v_key using errcode = '22023';
    end if;

    if coalesce(v_current, '') <> coalesce(v_from, '') then
      v_conflicts := v_conflicts || jsonb_build_object(
        'field_key', v_key, 'expected', v_from, 'found', v_current);
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    -- Nothing has been written: the checks all ran before the first update.
    raise exception 'stale_target: %', v_conflicts::text using errcode = '40001';
  end if;

  -- The brokerage's own currency, for a premium whose change did not name one. A fact about the
  -- organization, not a guess about the document.
  select currency into v_org_currency from organizations where id = v_org;

  -- Now write, in the order the changes arrived.
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_key      := v_change ->> 'field_key';
    v_to       := v_change ->> 'to';
    v_basis    := v_change ->> 'premium_basis';
    v_currency := v_change ->> 'premium_currency';
    if v_basis is not null and v_basis not in ('gross', 'total_payable') then
      raise exception 'premium_basis_unknown' using errcode = '22023';
    end if;

    if p_target_type = 'policy_period' and v_key = 'period_start' then
      update policy_periods set period_start = v_to::date where id = p_target_id;
    elsif p_target_type = 'policy_period' and v_key = 'period_end' then
      update policy_periods set period_end = v_to::date where id = p_target_id;
    elsif p_target_type = 'policy_period' and v_key = 'premium' then
      /*
       * A premium from a document is the one premium that *is* verified: the columns 0039 added
       * for exactly this are filled in, naming the document that says so. An imported premium
       * never gets them, because an import has no document behind it.
       *
       * The basis comes from the person, never from the document. 0039 refuses an amount without
       * a currency and a basis — "a number without units" — and a schedule states a figure
       * without saying whether it is the gross premium or everything payable. Guessing would
       * misstate the commission basis on every policy it touched, so the apply is refused and the
       * interface asks.
       */
      if v_basis is null then
        raise exception 'premium_basis_required' using errcode = '22023';
      end if;
      v_amount := app.text_to_amount(v_to);
      update policy_periods
         set premium_amount               = v_amount,
             premium_currency             = upper(coalesce(v_currency, v_org_currency)),
             premium_basis                = v_basis,
             premium_source               = 'document',
             premium_evidence_document_id = p_document_id,
             premium_verified_at          = now()
       where id = p_target_id;
    elsif p_target_type = 'policy' and v_key = 'policy_number' then
      update policies set policy_number = v_to, updated_at = now() where id = p_target_id;
    elsif p_target_type = 'client' and v_key = 'insured_name' then
      update clients set name = v_to, updated_at = now() where id = p_target_id;
    end if;

    /*
     * The receipt. `from` and `page` stay even when null — they are part of the shape the API
     * answers with, and stripping them made a valid apply fail on the way back out: the record
     * had changed and the person was shown an error. Only the premium keys are conditional.
     */
    v_applied := v_applied || (
      jsonb_build_object(
        'field_key', v_key,
        'document_field_id', v_change ->> 'document_field_id',
        'from', v_change ->> 'from',
        'to', v_to,
        'page', v_change -> 'page')
      || case when v_key = 'premium'
              then jsonb_build_object('premium_basis', v_basis,
                                      'premium_currency',
                                      upper(coalesce(v_currency, v_org_currency)))
              else '{}'::jsonb end);
  end loop;

  insert into document_applications (organization_id, document_id, target_type, target_id,
                                     changes, applied_by, idempotency_key)
  values (v_org, p_document_id, p_target_type, p_target_id, v_applied, v_user, p_idempotency_key)
  returning id into v_app_id;

  -- The audit row carries both sides of every field, which is what makes this reversible by a
  -- person reading the history rather than by guesswork.
  insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type,
                         object_id, previous_state, new_state, result)
  values (v_org, 'user', v_user, 'document.applied_to_record', p_target_type, p_target_id,
          jsonb_build_object(
            'fields', (select jsonb_agg(jsonb_build_object('field_key', c ->> 'field_key',
                                                           'value', c ->> 'from'))
                         from jsonb_array_elements(v_applied) c)),
          jsonb_build_object(
            'document_id', p_document_id,
            'application_id', v_app_id,
            'fields', (select jsonb_agg(jsonb_build_object('field_key', c ->> 'field_key',
                                                           'value', c ->> 'to'))
                         from jsonb_array_elements(v_applied) c)),
          'success');

  return jsonb_build_object(
    'application_id', v_app_id,
    'document_id', p_document_id,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'changes', v_applied,
    'applied_at', now(),
    'repeat', false);
end $$;

revoke all on function public.document_apply_to_record(uuid, text, uuid, jsonb, text) from public;
grant execute on function public.document_apply_to_record(uuid, text, uuid, jsonb, text)
  to authenticated;
