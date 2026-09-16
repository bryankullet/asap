-- pgTAP: applying a document to the record it is about (0043).
--
-- These run against the real function, because everything that makes applying safe is *in* the
-- function and a stand-in for it would prove nothing:
--
--   * the record still holds what the person was shown, or nothing is written;
--   * the write, the receipt and the audit row happen together or not at all;
--   * one press of Apply writes once;
--   * another brokerage's record is not found.
begin;
select plan(34);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-apply-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-apply-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-apply');

-- ---------------------------------------------------------------------------------------------
-- Shape.

select has_table('public', 'document_applications', 'document_applications exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.document_applications'::regclass),
  true,
  'row level security is enabled');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'document_applications'
     and roles::text[] @> array['anon']),
  0,
  'no policy applies to anon');
-- Reading is allowed; writing is the function's job alone, so no write policy exists.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'document_applications' and cmd <> 'SELECT'),
  0,
  'authenticated may read applications but never write one directly');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'document_applications'
     and coalesce(qual, '') not like '%can_access%'),
  0,
  'the read policy carries the brokerage scope, the same way every tenant table does');
select ok(
  has_function_privilege('authenticated',
    'public.document_apply_to_record(uuid,text,uuid,jsonb,text)', 'execute'),
  'a signed-in person may call the function');
select ok(
  not has_function_privilege('anon',
    'public.document_apply_to_record(uuid,text,uuid,jsonb,text)', 'execute'),
  'anon may not');

-- ---------------------------------------------------------------------------------------------
-- A document of brokerage A, with two reviewed fields.

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into documents (id, organization_id, kind, filename, mime_type, byte_size, storage_path,
                       content_sha256, uploaded_by, extraction_state)
values ('da000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'policy_schedule', 'schedule.pdf', 'application/pdf', 4096,
        '10000000-0000-4000-8000-00000000000a/unfiled/da1/schedule.pdf', repeat('d', 64),
        'a0000000-0000-4000-8000-000000000001', 'extracted');

insert into document_fields (id, organization_id, document_id, field_key, proposed_value,
                             page_number, region_x, region_y, region_width, region_height,
                             state, condition, reviewed_by, reviewed_at)
values
  ('db000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'da000000-0000-4000-8000-00000000000a', 'premium', '214500.00', 1, 240, 292, 55, 15,
   'accepted', 'known', 'a0000000-0000-4000-8000-000000000001', now()),
  ('db000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
   'da000000-0000-4000-8000-00000000000a', 'period_end', '2026-12-31', 1, 240, 248, 56, 15,
   'accepted', 'known', 'a0000000-0000-4000-8000-000000000001', now());

-- ---------------------------------------------------------------------------------------------
-- Staleness: the record must still hold what the person was shown.

select throws_ok(
  $$select public.document_apply_to_record(
      'da000000-0000-4000-8000-00000000000a', 'policy_period',
      '91000000-0000-4000-8000-00000000000a',
      '[{"field_key":"premium","document_field_id":"db000000-0000-4000-8000-00000000000a","from":"999.00","to":"214500.00"}]'::jsonb,
      'stale-attempt-0000001')$$,
  '40001',
  NULL,
  'an apply whose expected value does not match the record is refused');
select is(
  (select premium_amount from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  NULL,
  'and nothing was written: the period still holds no premium');
select is(
  (select count(*)::int from document_applications
   where idempotency_key = 'stale-attempt-0000001'),
  0,
  'and no receipt exists for a refused apply');

-- A premium with no basis is refused: 0039 will not hold an amount without units, and a schedule
-- does not say whether its figure is the gross premium or everything payable.
select throws_ok(
  $$select public.document_apply_to_record(
      'da000000-0000-4000-8000-00000000000a', 'policy_period',
      '91000000-0000-4000-8000-00000000000a',
      '[{"field_key":"premium","document_field_id":"db000000-0000-4000-8000-00000000000a","from":null,"to":"214500.00"}]'::jsonb,
      'no-basis-00000000001')$$,
  '22023',
  NULL,
  'a premium without a basis is refused rather than written as a number without units');
select is(
  (select premium_amount from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  NULL,
  'and still nothing was written');

-- ---------------------------------------------------------------------------------------------
-- The real apply. The period holds no premium, so `from` is null.

select is(
  (select public.document_apply_to_record(
      'da000000-0000-4000-8000-00000000000a', 'policy_period',
      '91000000-0000-4000-8000-00000000000a',
      '[{"field_key":"premium","document_field_id":"db000000-0000-4000-8000-00000000000a","from":null,"to":"214500.00","page":1,"premium_basis":"gross"}]'::jsonb,
      'apply-premium-0000001') -> 'repeat')::text,
  'false',
  'the first apply is not a repeat');

select is(
  (select premium_amount from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  214500.00,
  'the real business record now holds the premium');
select is(
  (select premium_source from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  'document',
  'and records that it came from a document');
select is(
  (select premium_evidence_document_id from policy_periods
   where id = '91000000-0000-4000-8000-00000000000a'),
  'da000000-0000-4000-8000-00000000000a'::uuid,
  'the document is linked as the evidence for it');
select isnt(
  (select premium_verified_at from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  NULL,
  'and a premium read off a document is verified, unlike an imported one');

select is(
  (select premium_basis from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  'gross',
  'the basis the person chose is on the record');
select is(
  (select premium_currency from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  'KES',
  'and the currency came from the brokerage itself, not from the document');

-- The receipt.
select is(
  (select count(*)::int from document_applications
   where idempotency_key = 'apply-premium-0000001'),
  1,
  'one receipt was written');
select is(
  (select changes -> 0 ->> 'page' from document_applications
   where idempotency_key = 'apply-premium-0000001'),
  '1',
  'the receipt keeps the page the value was read from');
select is(
  (select changes -> 0 ->> 'to' from document_applications
   where idempotency_key = 'apply-premium-0000001'),
  '214500.00',
  'and what was written');

-- The audit row, with both sides.
select is(
  (select count(*)::int from audit_log
   where action = 'document.applied_to_record'
     and object_id = '91000000-0000-4000-8000-00000000000a'),
  1,
  'one audit row');
select is(
  (select new_state ->> 'document_id' from audit_log
   where action = 'document.applied_to_record'
     and object_id = '91000000-0000-4000-8000-00000000000a'),
  'da000000-0000-4000-8000-00000000000a',
  'the audit row names the document the values came from');
select is(
  (select previous_state -> 'fields' -> 0 ->> 'value' from audit_log
   where action = 'document.applied_to_record'
     and object_id = '91000000-0000-4000-8000-00000000000a'),
  NULL,
  'the before value is in the audit row (null: the period held nothing)');
select is(
  (select new_state -> 'fields' -> 0 ->> 'value' from audit_log
   where action = 'document.applied_to_record'
     and object_id = '91000000-0000-4000-8000-00000000000a'),
  '214500.00',
  'and the after value');

-- ---------------------------------------------------------------------------------------------
-- Applying twice writes once.

select is(
  (select public.document_apply_to_record(
      'da000000-0000-4000-8000-00000000000a', 'policy_period',
      '91000000-0000-4000-8000-00000000000a',
      '[{"field_key":"premium","document_field_id":"db000000-0000-4000-8000-00000000000a","from":null,"to":"214500.00","page":1,"premium_basis":"gross"}]'::jsonb,
      'apply-premium-0000001') -> 'repeat')::text,
  'true',
  'the same key again is a repeat, and returns the first receipt');
select is(
  (select count(*)::int from document_applications
   where idempotency_key = 'apply-premium-0000001'),
  1,
  'still one receipt');
select is(
  (select count(*)::int from audit_log
   where action = 'document.applied_to_record'
     and object_id = '91000000-0000-4000-8000-00000000000a'),
  1,
  'and still one audit row: a double-click is one decision');

-- ---------------------------------------------------------------------------------------------
-- Unselected fields stay unapplied, and a field the target cannot hold is refused by name.

select is(
  (select period_end from policy_periods where id = '91000000-0000-4000-8000-00000000000a'),
  '2026-12-31'::date,
  'the period end is untouched: it was never selected');

select throws_ok(
  $$select public.document_apply_to_record(
      'da000000-0000-4000-8000-00000000000a', 'client',
      '70000000-0000-4000-8000-00000000000a',
      '[{"field_key":"premium","document_field_id":"db000000-0000-4000-8000-00000000000a","from":null,"to":"1.00"}]'::jsonb,
      'wrong-field-000000001')$$,
  '22023',
  NULL,
  'a client cannot receive a premium, and the refusal names the field');

-- ---------------------------------------------------------------------------------------------
-- Another brokerage's record.

select throws_ok(
  $$select public.document_apply_to_record(
      'da000000-0000-4000-8000-00000000000a', 'client',
      '70000000-0000-4000-8000-00000000000c',
      '[{"field_key":"insured_name","document_field_id":"db000000-0000-4000-8000-00000000000b","from":"Otieno household","to":"Acme Manufacturing Ltd"}]'::jsonb,
      'cross-org-0000000001')$$,
  'P0002',
  NULL,
  'a record in another brokerage is not found');
-- And the row is not even visible to this person, which is the stronger statement: the apply was
-- refused because the record is not theirs to see, not because a check happened to catch it.
select is(
  (select count(*)::int from clients where id = '70000000-0000-4000-8000-00000000000c'),
  0,
  'and that brokerage''s client is not visible to this person at all');
reset role;
select is(
  (select name from clients where id = '70000000-0000-4000-8000-00000000000c'),
  'Otieno household',
  'and its name is unchanged');

select * from finish();
rollback;
