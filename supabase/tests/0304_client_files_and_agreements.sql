-- pgTAP: 0026 — every client lands not_started; clearing is a named decision needing documents;
-- only confirmed rates count; the gate refuses approval and audits an override.
begin;
select plan(18);

-- 1. No client row can be created as anything but not_started, from any path.
select throws_ok(
  $$insert into clients (organization_id, name, kind, source, file_status) values ('10000000-0000-4000-8000-00000000000a', 'x', 'individual', 'imported', 'cleared')$$,
  '23514', 'client_must_land_not_started', 'an imported client cannot be created as cleared');
select throws_ok(
  $$insert into clients (organization_id, name, kind, source, file_status) values ('10000000-0000-4000-8000-00000000000a', 'y', 'individual', 'manual', 'incomplete')$$,
  '23514', 'client_must_land_not_started', 'nor as incomplete');
select is((select count(*) from clients where source = 'seed' and file_status = 'cleared'), 0::bigint, 'no seeded client is cleared');

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label) values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap');

-- 2. Grant layer: reads only
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select throws_ok($$update clients set file_status = 'cleared' where id = '70000000-0000-4000-8000-00000000000a'$$, '42501', null, 'authenticated cannot update clients directly');
select is((select count(*) from clients), 2::bigint, 'Acme AE sees the two Acme clients only');

-- 3. Clearing needs the documents the kind requires, and a reason
select throws_ok($$select client_file_clear('70000000-0000-4000-8000-00000000000a', 'Looks fine', 365)$$,
  '22023', 'file_incomplete', 'a corporate file with no documents cannot be cleared');
select lives_ok($$select client_file_record_document('70000000-0000-4000-8000-00000000000a', 'identity', 'Certificate of incorporation', 'Scan 8 Sep', now())$$, 'identity recorded');
select is(client_file_state('70000000-0000-4000-8000-00000000000a'), 'incomplete', 'the file is now incomplete, not cleared');
select throws_ok($$select client_file_clear('70000000-0000-4000-8000-00000000000a', 'Looks fine', 365)$$,
  '22023', 'file_incomplete', 'a corporate file still needs beneficial ownership');
select lives_ok($$select client_file_record_document('70000000-0000-4000-8000-00000000000a', 'beneficial_ownership', 'Ownership declaration', 'Signed form 8 Sep', now())$$, 'ownership recorded');
select throws_ok($$select client_file_clear('70000000-0000-4000-8000-00000000000a', '  ', 365)$$, '22023', 'reason_required', 'clearing needs a typed reason');

-- 4. The gate, before clearing: approval refused and audited; override needs the principal
create temp table t_item as select id, version from work_items where id = '30000000-0000-4000-8000-000000000005';
select throws_ok(
  $$select work_item_approve((select id from t_item), (select version from t_item), '[]', 'needs_you', null, null, null, null)$$,
  '42501', 'client_file_not_cleared', 'approval is refused while the file is not cleared');
select throws_ok(
  $$select work_item_approve((select id from t_item), (select version from t_item), '[]', 'needs_you', null, null, null, 'Client known for years')$$,
  '42501', 'principal_officer_only', 'an account executive cannot override');
reset role;
-- The denied audit row is written by the API under the caller's session (D-026): a raising
-- function cannot persist its own denial.

select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select isnt((select (work_item_approve((select id from t_item), (select version from t_item),
  (select steps from work_items where id = (select id from t_item)), 'needs_you', null, null, null, 'Client known for years; documents in the post') ->> 'override_item_id')), null,
  'the brokerage administrator can override with a typed reason');
reset role;
select is((select count(*) from audit_log where action = 'placement.client_file_gate_overridden'), 1::bigint, 'the override is a permanent audit entry');
select is((select count(*) from work_items where kind = 'exception' and title like '%client-file override' and task_status = 'needs_you' and owner_id = 'a0000000-0000-4000-8000-000000000001'), 1::bigint,
  'and it lands on the principal''s Today as an item that needs them');

-- 5. Only confirmed rates count
select is((select rate_basis_points from agreed_rate('60000000-0000-4000-8000-00000000000a', 'motor private')), 1000, 'the confirmed Motor private rate is found, case-insensitively');
select is((select count(*) from agreed_rate('60000000-0000-4000-8000-00000000000a', 'Motor commercial')), 0::bigint, 'an unconfirmed rate is never used');

select * from finish();
rollback;
