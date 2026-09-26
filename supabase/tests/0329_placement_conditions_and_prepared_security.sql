-- pgTAP: client conditions, placement writes through the API only, and prepared-action security (0056).
--
--   * a client condition is immutable, and each resolution carries what it must: the insurer's
--     answer, or a reason and evidence, and for a waiver the new instruction version;
--   * a browser session — no server-held key — cannot write any placement record at all;
--   * anon cannot reach a prepared action; a browser session cannot insert, alter, execute or
--     delete one; nobody decides another person's; an expired one cannot execute; what it will
--     do is immutable;
--   * the privileged functions keep a fixed search_path and no PUBLIC execute;
--   * one brokerage reaches none of another's.
begin;
select plan(38);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  perform set_config('role', 'anon', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-0329');

-- ---------------------------------------------------------------------------------------------
-- Shape and security.

select is_empty($$
  select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and not c.relrowsecurity and c.relname in ('placement_client_conditions','client_condition_resolutions')
$$, 'row level security is enabled on the condition tables');
select is_empty($$
  select table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('placement_client_conditions','client_condition_resolutions')
     and (grantee = 'anon' or (grantee in ('authenticated','asap_worker') and privilege_type in ('UPDATE','DELETE')))
$$, 'conditions and resolutions are insert-only, and anon has nothing');
select is_empty($$
  select table_name || ':' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'prepared_actions' and grantee in ('anon','authenticated') and
     (grantee = 'anon' or privilege_type = 'DELETE')
$$, 'anon has no grant on prepared actions, and nobody may delete one');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.oid in ('app.prepared_actions_guard()'::regprocedure, 'app.placement_writes_through_api()'::regprocedure,
                   'public.work_item_ensure(uuid,text,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid,uuid,text)'::regprocedure)
     and not (p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
              and not has_function_privilege('public', p.oid, 'execute'))
$$, 'the privileged functions are SECURITY DEFINER, fixed search_path, no PUBLIC execute');
select ok(not has_function_privilege('anon', 'public.work_item_ensure(uuid,text,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid,uuid,text)', 'execute'),
  'anon may not execute work_item_ensure');
select is_empty($$
  select t from unnest(array['client_instructions','placements','placement_basis_terms','placement_requests',
      'placement_request_approvals','placement_submissions','placement_insurer_responses','placement_cancellations',
      'placement_basis_versions','placement_confirmation_terms','cover_match_results','cover_match_items',
      'client_change_acceptances','client_change_acceptance_items','placement_client_conditions',
      'client_condition_resolutions']) t
   where not exists (select 1 from pg_trigger g where g.tgrelid = t::regclass and g.tgname = t || '_through_api')
$$, 'every placement table is written through the API only');

-- ---------------------------------------------------------------------------------------------
-- A placement to work on.

reset role;
insert into work_items (id, organization_id, kind, title, task_status)
values ('e3100000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'new_business', 'W quotation', 'needs_you');
insert into insurers (id, organization_id, name)
values ('e3200000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'W Insurer');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('e3300000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e3100000-0000-4000-8000-00000000000a', 'W', 'Commercial motor', 'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('e3400000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3300000-0000-4000-8000-00000000000a', 'e3200000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');
insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id, outcome, received_at,
                               source_note, premium_amount, premium_currency, valid_until, recorded_by)
values ('e3500000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3300000-0000-4000-8000-00000000000a', 'e3400000-0000-4000-8000-00000000000a', 'quoted', now(),
        'Quotation letter.', 5310000, 'KES', current_date + 60, 'a0000000-0000-4000-8000-000000000001');
insert into quote_comparisons (id, organization_id, opportunity_id, generated_by)
values ('e3700000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3300000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');
insert into client_instructions (id, organization_id, opportunity_id, client_id, comparison_id, insurer_response_id,
                                 response_revision_id, source, evidence_note, instructed_at, recorded_by)
values ('e3800000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e3700000-0000-4000-8000-00000000000a', 'e3500000-0000-4000-8000-00000000000a',
        (select id from insurer_response_revisions where insurer_response_id = 'e3500000-0000-4000-8000-00000000000a'),
        'telephone', 'Client rang at 10:40 and chose W Insurer.', now(), 'a0000000-0000-4000-8000-000000000001');
insert into placements (id, organization_id, opportunity_id, client_id, client_instruction_id, insurer_id,
                        work_item_id, requested_effective_at, created_by)
values ('e3900000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e3800000-0000-4000-8000-00000000000a', 'e3200000-0000-4000-8000-00000000000a',
        'e3100000-0000-4000-8000-00000000000a', now() + interval '7 days', 'a0000000-0000-4000-8000-000000000001');
insert into placement_basis_versions (id, organization_id, placement_id, version, client_instruction_id, insurer_id,
                                      premium_amount, premium_currency, origin, created_by)
values ('e3a00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3900000-0000-4000-8000-00000000000a', 1, 'e3800000-0000-4000-8000-00000000000a',
        'e3200000-0000-4000-8000-00000000000a', 5310000, 'KES', 'instruction', 'a0000000-0000-4000-8000-000000000001');


insert into placement_client_conditions (id, organization_id, placement_id, client_instruction_id, position,
                                         condition_text, created_by)
values ('e3e00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3900000-0000-4000-8000-00000000000a', 'e3800000-0000-4000-8000-00000000000a', 0,
        'Subject to a satisfactory inspection', 'a0000000-0000-4000-8000-000000000001'),
       ('e3e00000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'e3900000-0000-4000-8000-00000000000a', 'e3800000-0000-4000-8000-00000000000a', 1,
        'Provide the named drivers list', 'a0000000-0000-4000-8000-000000000001');

select isnt((select count(*)::int from placement_client_conditions where placement_id = 'e3900000-0000-4000-8000-00000000000a'),
  0, 'the API may record a client''s conditions');

-- ---------------------------------------------------------------------------------------------
-- Placement records: a browser session cannot write any of them.

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok(
  $$insert into placement_requests (organization_id, placement_id, version, subject, body_text, cover_requested,
      effective_at, sha256, prepared_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a', 1, 'S', 'B', 'C', now(),
      repeat('0', 64), 'a0000000-0000-4000-8000-000000000001')$$,
  '42501', 'api_only', 'a browser session cannot prepare a placement request directly');
select throws_ok(
  $$update placements set requested_effective_at = now() where id = 'e3900000-0000-4000-8000-00000000000a'$$,
  '42501', 'api_only', 'nor change a placement');
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, reason,
      evidence_note, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000a', 'satisfied', 'Inspection passed.',
      'Assessor''s report dated 11 September.', now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '42501', 'api_only', 'nor resolve a client condition');
select throws_ok(
  $$insert into client_instructions (organization_id, opportunity_id, client_id, comparison_id, insurer_response_id,
      response_revision_id, source, evidence_note, instructed_at, recorded_by)
    select organization_id, opportunity_id, client_id, comparison_id, insurer_response_id, response_revision_id,
      'email', 'A forged instruction from a browser.', now(), recorded_by
      from client_instructions where id = 'e3800000-0000-4000-8000-00000000000a'$$,
  '42501', 'api_only', 'nor record a client instruction');

-- ---------------------------------------------------------------------------------------------
-- Client conditions.

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update placement_client_conditions set condition_text = 'Nothing' where id = 'e3e00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'a condition cannot be edited through the API either (no grant)');
reset role;
select throws_ok(
  $$update placement_client_conditions set condition_text = 'Nothing' where id = 'e3e00000-0000-4000-8000-00000000000a'$$,
  '23001', null, 'a condition is immutable even to the owner role');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000a', 'satisfied', now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'satisfied needs a reason and evidence');
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, reason,
      evidence_note, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000a', 'waived', 'Client withdrew it.',
      'Client''s email of 12 September withdrawing it.', now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a waiver must name the new instruction version it created');
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000a', 'confirmed_by_insurer', now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'confirmed by the insurer must name the insurer''s answer');
insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, reason,
    evidence_note, resolved_at, recorded_by)
values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
    'e3e00000-0000-4000-8000-00000000000a', 'satisfied', 'Inspection passed.',
    'Assessor''s report dated 11 September, filed.', now(), 'a0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, reason,
      evidence_note, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000a', 'satisfied', 'Inspection passed again.',
      'A second report for the same condition.', now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a condition is finally resolved once');
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, reason,
      evidence_note, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000b', 'satisfied', 'Drivers list received.',
      'Recorded in someone else''s name.', now(), 'a0000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a resolution is recorded in the name of the person recording it');

-- ---------------------------------------------------------------------------------------------
-- Prepared actions.

insert into prepared_actions (id, organization_id, placement_id, action_type, payload, source_versions, fingerprint,
                              permitted, idempotency_key, prepared_by, expires_at)
values ('e3d00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e3900000-0000-4000-8000-00000000000a', 'prepare_issuance', '{"action":"prepare_issuance"}', '{}',
        repeat('a', 64), true, 'key-0329-0001', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day'),
       ('e3d00000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'e3900000-0000-4000-8000-00000000000a', 'prepare_issuance', '{"action":"prepare_issuance"}', '{}',
        repeat('b', 64), true, 'key-0329-0002', 'a0000000-0000-4000-8000-000000000001', now() - interval '1 minute');

select pg_temp.as_anon();
select throws_ok($$select count(*) from prepared_actions$$, '42501', null, 'anon cannot read prepared actions');
select throws_ok(
  $$insert into prepared_actions (organization_id, placement_id, action_type, payload, source_versions, fingerprint,
      permitted, idempotency_key, prepared_by, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a', 'prepare_issuance',
      '{}', '{}', repeat('a', 64), true, 'key-0329-0003', 'a0000000-0000-4000-8000-000000000001', now())$$,
  '42501', null, 'anon cannot write one');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok(
  $$insert into prepared_actions (organization_id, placement_id, action_type, payload, source_versions, fingerprint,
      permitted, idempotency_key, prepared_by, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a', 'prepare_issuance',
      '{}', '{}', repeat('a', 64), true, 'key-0329-0004', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day')$$,
  '42501', null, 'a browser session cannot insert one');
select throws_ok(
  $$update prepared_actions set changes = '["Something else"]' where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'nor alter one');
select throws_ok(
  $$update prepared_actions set state = 'executed', decided_by = 'a0000000-0000-4000-8000-000000000001',
      decided_at = now(), receipt = '{"message":"forged"}' where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'nor mark one executed');
select throws_ok(
  $$delete from prepared_actions where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'nor delete one');

select pg_temp.login('a0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$update prepared_actions set state = 'executed', decided_by = 'a0000000-0000-4000-8000-000000000002',
      decided_at = now(), receipt = '{"message":"done"}' where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'a colleague cannot confirm somebody else''s prepared action, even through the API');
select throws_ok(
  $$update prepared_actions set state = 'discarded', decided_by = 'a0000000-0000-4000-8000-000000000002',
      decided_at = now() where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'nor discard it');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$update prepared_actions set fingerprint = repeat('c', 64) where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'the fingerprint is immutable');
select throws_ok(
  $$update prepared_actions set payload = '{"action":"approve_request"}' where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'the payload is immutable');
select throws_ok(
  $$update prepared_actions set expires_at = now() + interval '9 days' where id = 'e3d00000-0000-4000-8000-00000000000b'$$,
  '42501', null, 'an expiry cannot be extended');
select throws_ok(
  $$update prepared_actions set state = 'executed', decided_by = 'a0000000-0000-4000-8000-000000000001',
      decided_at = now(), receipt = '{"message":"done"}' where id = 'e3d00000-0000-4000-8000-00000000000b'$$,
  '23514', null, 'an expired action cannot execute');
update prepared_actions set state = 'expired' where id = 'e3d00000-0000-4000-8000-00000000000b';
select is((select state from prepared_actions where id = 'e3d00000-0000-4000-8000-00000000000b'), 'expired',
  'an expired action is marked expired, undecided');

update prepared_actions set state = 'executed', decided_by = 'a0000000-0000-4000-8000-000000000001',
    decided_at = now(), receipt = '{"message":"Prepare policy issuance — done."}'
 where id = 'e3d00000-0000-4000-8000-00000000000a';
select is((select receipt->>'message' from prepared_actions where id = 'e3d00000-0000-4000-8000-00000000000a'),
  'Prepare policy issuance — done.', 'the person who prepared it confirms it, with one receipt');
select throws_ok(
  $$update prepared_actions set receipt = '{"message":"again"}' where id = 'e3d00000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a receipt is written once: an executed action is never decided again');

-- ---------------------------------------------------------------------------------------------
-- Another brokerage.

select pg_temp.login('b0000000-0000-4000-8000-000000000001', true);
select is((select count(*)::int from placement_client_conditions where placement_id = 'e3900000-0000-4000-8000-00000000000a'),
  0, 'another brokerage sees none of the conditions');
select is((select count(*)::int from client_condition_resolutions where placement_id = 'e3900000-0000-4000-8000-00000000000a'),
  0, 'nor their resolutions');
select is((select count(*)::int from prepared_actions where placement_id = 'e3900000-0000-4000-8000-00000000000a'),
  0, 'nor the prepared actions');
select throws_ok(
  $$insert into client_condition_resolutions (organization_id, placement_id, condition_id, resolution, reason,
      evidence_note, resolved_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e3900000-0000-4000-8000-00000000000a',
      'e3e00000-0000-4000-8000-00000000000b', 'satisfied', 'Drivers list received.',
      'An intruder writing into another brokerage.', now(), 'b0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'and cannot resolve one');
with u as (
  update prepared_actions set state = 'discarded', decided_by = 'b0000000-0000-4000-8000-000000000001', decided_at = now()
   where id = 'e3d00000-0000-4000-8000-00000000000a' returning 1)
select is((select count(*)::int from u), 0, 'nor act on a prepared action');

select * from finish();
rollback;
