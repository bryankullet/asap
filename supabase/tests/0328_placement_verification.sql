-- pgTAP: placement verification and Work identity (0055).
--
--   * Work is identified by its source and reason, never its title: two placements with the same
--     title are two items; asking twice refreshes one; resolving completes only its own;
--   * the Work functions are for the API only, members only, and name the party they wait on;
--   * an accepted basis version is immutable, and only a full acceptance changes it;
--   * a client's decision needs evidence;
--   * a prepared action is one per key and cannot be marked executed without a receipt;
--   * one brokerage reaches none of another's, and nothing here can be deleted.
begin;
select plan(38);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-0328');

/* A convenience: ensure one item for (source, reason) as the given caller. */
create or replace function pg_temp.ensure(p_source uuid, p_reason text, p_title text,
  p_status text default 'needs_you', p_party text default null, p_since timestamptz default null,
  p_owner uuid default null)
returns jsonb language sql as $$
  select public.work_item_ensure('10000000-0000-4000-8000-00000000000a', 'placement', p_source, p_reason,
    'placement', p_title, 'Why', 'Do this', 'Evidence', 'Then this', p_status, p_party, p_since, null, p_owner,
    null, null, 'Commercial motor')
$$;
grant execute on function pg_temp.ensure(uuid, text, text, text, text, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Shape and security of what 0055 added.

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    and c.relname in ('placement_basis_versions','placement_confirmation_terms','cover_match_results',
      'cover_match_items','client_change_acceptances','client_change_acceptance_items','prepared_actions')
$$, 'row level security is enabled on every table 0055 added');

select is_empty($$
  select table_name || ':' || grantee from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'DELETE'
    and grantee in ('authenticated','asap_worker','anon')
    and table_name in ('placement_basis_versions','placement_confirmation_terms','cover_match_results',
      'cover_match_items','client_change_acceptances','client_change_acceptance_items','prepared_actions')
$$, 'nobody may delete a basis version, a check, a decision or a prepared action');

select is_empty($$
  select table_name || ':' || privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and table_name in ('placement_basis_versions','placement_confirmation_terms','cover_match_results',
      'cover_match_items','client_change_acceptances','client_change_acceptance_items','prepared_actions')
$$, 'anon has no access to any of them');

select is_empty($$
  select table_name || ':' || privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE'
    and table_name in ('placement_basis_versions','placement_confirmation_terms','cover_match_results',
      'cover_match_items','client_change_acceptances','client_change_acceptance_items')
$$, 'records of agreement and comparison are insert-only');

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
     from pg_proc p where p.oid = 'public.work_item_ensure(uuid,text,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid,uuid,text)'::regprocedure),
  'work_item_ensure is SECURITY DEFINER with a fixed search_path');
select ok(
  not has_function_privilege('public', 'public.work_item_ensure(uuid,text,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.work_item_ensure(uuid,text,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid,uuid,text)', 'execute'),
  'PUBLIC and anon may not execute work_item_ensure');
select ok(
  not has_function_privilege('public', 'public.work_item_resolve(uuid,text,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.work_item_resolve(uuid,text,uuid,text)', 'execute'),
  'PUBLIC and anon may not execute work_item_resolve');
select ok(
  not has_function_privilege('public', 'app.basis_versions_are_immutable()', 'execute'),
  'PUBLIC may not execute the immutability trigger function');

-- ---------------------------------------------------------------------------------------------
-- Work identity.

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok(
  $$select pg_temp.ensure('e2000000-0000-4000-8000-00000000000a', 'prepare_request', 'Same title')$$,
  '42501', null, 'work_item_ensure refuses a caller without the API key');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
create temp table w (k text primary key, v jsonb) on commit drop;
grant all on w to authenticated;
insert into w values
  ('a1', pg_temp.ensure('e2000000-0000-4000-8000-00000000000a', 'prepare_request', 'Same title')),
  ('b1', pg_temp.ensure('e2000000-0000-4000-8000-00000000000b', 'prepare_request', 'Same title')),
  ('a2', pg_temp.ensure('e2000000-0000-4000-8000-00000000000a', 'prepare_request', 'Same title, refreshed'));

select isnt((select v->>'id' from w where k = 'a1'), (select v->>'id' from w where k = 'b1'),
  'two placements with the same title are two Work items');
select is((select v->>'id' from w where k = 'a2'), (select v->>'id' from w where k = 'a1'),
  'asking again for the same source and reason reuses the open item');
select is((select (v->>'reopened')::boolean from w where k = 'a2'), true, 'and says it refreshed it');
select is((select title from work_items where id = (select (v->>'id')::uuid from w where k = 'a1')),
  'Same title, refreshed', 'the refreshed item carries the new wording');

select is(
  public.work_item_resolve('10000000-0000-4000-8000-00000000000a', 'placement', 'e2000000-0000-4000-8000-00000000000a', 'prepare_request'),
  1, 'resolving completes exactly one item');
select is((select task_status from work_items where id = (select (v->>'id')::uuid from w where k = 'b1')),
  'needs_you', 'the other placement''s item is untouched');
select is(
  public.work_item_resolve('10000000-0000-4000-8000-00000000000a', 'placement', 'e2000000-0000-4000-8000-00000000000a', 'prepare_request'),
  0, 'resolving again completes nothing');

insert into w values ('a3', pg_temp.ensure('e2000000-0000-4000-8000-00000000000a', 'approval_required', 'Next'));
insert into w values ('a4', pg_temp.ensure('e2000000-0000-4000-8000-00000000000a', 'approval_required', 'Next'));
select is((select count(*)::int from work_items where source_id = 'e2000000-0000-4000-8000-00000000000a' and reason_code = 'approval_required'),
  1, 'the next lifecycle item is created once');

select throws_ok(
  $$select pg_temp.ensure('e2000000-0000-4000-8000-00000000000c', 'awaiting_insurer', 'With nobody', 'with_party')$$,
  '23514', null, 'with_party is refused without the party and the date');
select throws_ok(
  $$select pg_temp.ensure('e2000000-0000-4000-8000-00000000000c', 'approval_required', 'For a stranger',
      'needs_you', null, null, 'b0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'nobody from another brokerage is made responsible for the work');

reset role;
select throws_ok(
  $$insert into work_items (organization_id, kind, title, task_status, source_type, source_id, reason_code)
    select organization_id, kind, 'dup', 'needs_you', source_type, source_id, reason_code
      from work_items where id = (select (v->>'id')::uuid from w where k = 'b1')$$,
  '23505', null, 'the database refuses a second open item for one source and reason');
select throws_ok(
  $$insert into work_items (organization_id, kind, title, task_status, source_type)
    values ('10000000-0000-4000-8000-00000000000a', 'placement', 'half', 'needs_you', 'placement')$$,
  '23514', null, 'a source identity is whole or absent');

select pg_temp.login('b0000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select pg_temp.ensure('e2000000-0000-4000-8000-00000000000d', 'prepare_request', 'Intruder')$$,
  '42501', null, 'another brokerage cannot open Work in this one');
select throws_ok(
  $$select public.work_item_resolve('10000000-0000-4000-8000-00000000000a', 'placement', 'e2000000-0000-4000-8000-00000000000b', 'prepare_request')$$,
  '42501', null, 'nor resolve its Work');
select is((select count(*)::int from work_items where source_id = 'e2000000-0000-4000-8000-00000000000b'),
  0, 'nor even see it');

-- ---------------------------------------------------------------------------------------------
-- The accepted basis, the check and the client's decision — on a seeded placement shape.

reset role;
insert into work_items (id, organization_id, kind, title, task_status)
values ('e2100000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'new_business', 'V quotation', 'needs_you');
insert into insurers (id, organization_id, name)
values ('e2200000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'V Insurer');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('e2300000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e2100000-0000-4000-8000-00000000000a', 'V', 'Commercial motor', 'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('e2400000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2300000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');
insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id, outcome, received_at,
                               source_note, premium_amount, premium_currency, valid_until, recorded_by)
values ('e2500000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2300000-0000-4000-8000-00000000000a', 'e2400000-0000-4000-8000-00000000000a', 'quoted', now(),
        'Quotation letter.', 5310000, 'KES', current_date + 60, 'a0000000-0000-4000-8000-000000000001');
insert into quote_comparisons (id, organization_id, opportunity_id, generated_by)
values ('e2700000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2300000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');
insert into client_instructions (id, organization_id, opportunity_id, client_id, comparison_id, insurer_response_id,
                                 response_revision_id, source, evidence_note, instructed_at, recorded_by)
values ('e2800000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e2700000-0000-4000-8000-00000000000a', 'e2500000-0000-4000-8000-00000000000a',
        (select id from insurer_response_revisions where insurer_response_id = 'e2500000-0000-4000-8000-00000000000a'),
        'telephone', 'Client rang at 10:40 and chose V Insurer.', now(), 'a0000000-0000-4000-8000-000000000001');
insert into placements (id, organization_id, opportunity_id, client_id, client_instruction_id, insurer_id,
                        work_item_id, requested_effective_at, created_by)
values ('e2900000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e2800000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a',
        'e2100000-0000-4000-8000-00000000000a', now() + interval '7 days', 'a0000000-0000-4000-8000-000000000001');
insert into placement_basis_versions (id, organization_id, placement_id, version, client_instruction_id, insurer_id,
                                      premium_amount, premium_currency, origin, created_by)
values ('e2a00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2900000-0000-4000-8000-00000000000a', 1, 'e2800000-0000-4000-8000-00000000000a',
        'e2200000-0000-4000-8000-00000000000a', 5310000, 'KES', 'instruction', 'a0000000-0000-4000-8000-000000000001');

select throws_ok(
  $$insert into placement_basis_versions (organization_id, placement_id, version, client_instruction_id, insurer_id,
                                          origin, created_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a', 1,
            'e2800000-0000-4000-8000-00000000000a', 'e2200000-0000-4000-8000-00000000000a', 'instruction',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one basis per version: a new agreement is a new version, not a second version 1');

reset role;
select throws_ok(
  $$update placement_basis_versions set premium_amount = 1 where id = 'e2a00000-0000-4000-8000-00000000000a'$$,
  '23001', null, 'an accepted basis version cannot be changed, even by the owner role');

/* A response and a check to hang a decision on. The submission trigger is not the subject here. */
set local session_replication_role = replica;
insert into placement_insurer_responses (id, organization_id, placement_id, outcome, received_at, effective_at,
                                         evidence_note, recorded_by, changes_note)
values ('e2b00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2900000-0000-4000-8000-00000000000a', 'confirmed_with_changes', now(), now(),
        'Cover note received by email.', 'a0000000-0000-4000-8000-000000000001', 'Excess raised to 7.5%.');
set local session_replication_role = origin;
insert into cover_match_results (id, organization_id, placement_id, basis_version_id, placement_insurer_response_id,
                                 material_differences)
values ('e2c00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2900000-0000-4000-8000-00000000000a', 'e2a00000-0000-4000-8000-00000000000a',
        'e2b00000-0000-4000-8000-00000000000a', 1);

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$insert into client_change_acceptances (organization_id, placement_id, client_id, placement_insurer_response_id,
      cover_match_result_id, decision, source, decided_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a',
      (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
      'e2b00000-0000-4000-8000-00000000000a', 'e2c00000-0000-4000-8000-00000000000a', 'accept_all', 'email', now(),
      'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a client''s decision on changed terms needs evidence');
select throws_ok(
  $$insert into client_change_acceptances (organization_id, placement_id, client_id, placement_insurer_response_id,
      cover_match_result_id, decision, source, evidence_note, decided_at, recorded_by, new_basis_version_id)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a',
      (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
      'e2b00000-0000-4000-8000-00000000000a', 'e2c00000-0000-4000-8000-00000000000a', 'partial', 'email',
      'Client accepted the excess but queried the exclusion.', now(), 'a0000000-0000-4000-8000-000000000001',
      'e2a00000-0000-4000-8000-00000000000a')$$,
  '23514', null, 'a partial acceptance never changes what was agreed');

-- ---------------------------------------------------------------------------------------------
-- Prepared actions: written only by the API, immutable once prepared, decided once, by the caller.

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok(
  $$insert into prepared_actions (organization_id, placement_id, action_type, payload, source_versions, fingerprint,
                                  permitted, idempotency_key, prepared_by, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a', 'prepare_issuance',
            '{"action":"prepare_issuance"}', '{}', repeat('a', 64), true, 'key-0328-0000',
            'a0000000-0000-4000-8000-000000000001', now() + interval '1 day')$$,
  '42501', null, 'the browser cannot write a prepared action with its own session');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
insert into prepared_actions (id, organization_id, placement_id, action_type, payload, source_versions, fingerprint,
                              permitted, idempotency_key, prepared_by, expires_at)
values ('e2d00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e2900000-0000-4000-8000-00000000000a', 'prepare_issuance', '{"action":"prepare_issuance"}', '{}',
        repeat('a', 64), true, 'key-0328-0001', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day');

select throws_ok(
  $$insert into prepared_actions (organization_id, placement_id, action_type, payload, source_versions, fingerprint,
                                  permitted, idempotency_key, prepared_by, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a', 'prepare_issuance',
            '{}', '{}', repeat('a', 64), true, 'key-0328-0009', 'a0000000-0000-4000-8000-000000000002', now())$$,
  '42501', null, 'nobody prepares an action in someone else''s name');
select throws_ok(
  $$insert into prepared_actions (organization_id, placement_id, action_type, payload, source_versions, fingerprint,
                                  permitted, idempotency_key, prepared_by, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a', 'prepare_issuance',
            '{}', '{}', repeat('a', 64), true, 'key-0328-0001', 'a0000000-0000-4000-8000-000000000001', now())$$,
  '23505', null, 'one prepared action per idempotency key');
select throws_ok(
  $$insert into prepared_actions (organization_id, placement_id, action_type, payload, source_versions, fingerprint,
                                  permitted, idempotency_key, prepared_by, expires_at)
    values ('10000000-0000-4000-8000-00000000000a', 'e2900000-0000-4000-8000-00000000000a', 'issue_policy',
            '{}', '{}', repeat('a', 64), true, 'key-0328-0002', 'a0000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'only the declared action types can be prepared');
select throws_ok(
  $$update prepared_actions set payload = '{"action":"approve_request"}' where id = 'e2d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'what a prepared action will do cannot be rewritten before it is confirmed');
select throws_ok(
  $$update prepared_actions set state = 'executed', decided_by = 'a0000000-0000-4000-8000-000000000001',
      decided_at = now() where id = 'e2d00000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a prepared action cannot be marked executed without a receipt');
select throws_ok(
  $$update prepared_actions set state = 'discarded', decided_by = 'a0000000-0000-4000-8000-000000000002',
      decided_at = now() where id = 'e2d00000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'a prepared action is decided by the person deciding it');
update prepared_actions set state = 'discarded', decided_by = 'a0000000-0000-4000-8000-000000000001', decided_at = now()
 where id = 'e2d00000-0000-4000-8000-00000000000a';
select throws_ok(
  $$update prepared_actions set state = 'executed', decided_by = 'a0000000-0000-4000-8000-000000000001',
      decided_at = now(), receipt = '{"message":"x"}' where id = 'e2d00000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a decided action is decided once');

select pg_temp.login('b0000000-0000-4000-8000-000000000001', false);
select is((select count(*)::int from prepared_actions where id = 'e2d00000-0000-4000-8000-00000000000a'),
  0, 'another brokerage cannot see a prepared action');
select is((select count(*)::int from placement_basis_versions where placement_id = 'e2900000-0000-4000-8000-00000000000a'),
  0, 'nor a basis version');

select * from finish();
rollback;
