-- pgTAP: prepared actions about a policy (0059) and the `policy` Ask scope.
begin;
select plan(10);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-0332');

-- A policy in each brokerage, written as the owner for the test.
insert into insurers (id, organization_id, name) values
  ('f3200000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'pgTAP Insurer A'),
  ('f3200000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'pgTAP Insurer B');
insert into policies (id, organization_id, client_id, insurer_id, class_of_business) values
  ('f3300000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1), 'f3200000-0000-4000-8000-00000000000a', 'Motor'),
  ('f3300000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b',
   (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000b' limit 1), 'f3200000-0000-4000-8000-00000000000b', 'Motor');

select has_column('public', 'prepared_actions', 'policy_id', 'prepared_actions carries an optional policy_id');
select ok(exists (select 1 from pg_index i where i.indrelid = 'prepared_actions'::regclass
                   and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'prepared_actions'::regclass and attname = 'policy_id')),
          'policy_id is indexed');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'conversations_scope_kind_check') like '%''policy''%',
          'Ask may be scoped to a policy');

-- The API, as a member of brokerage A.
select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);

select lives_ok($$
  insert into prepared_actions (organization_id, policy_id, action_type, payload, source_versions, fingerprint, permitted, idempotency_key, prepared_by, expires_at)
  values ('10000000-0000-4000-8000-00000000000a', 'f3300000-0000-4000-8000-00000000000a', 'start_renewal',
          '{"action":"start_renewal"}', '{}', repeat('a', 64), true, 'pgtap-0332-ok-0001', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day')
$$, 'the API can prepare a renewal start about a policy in its own brokerage');

select throws_ok($$
  insert into prepared_actions (organization_id, policy_id, action_type, payload, source_versions, fingerprint, permitted, idempotency_key, prepared_by, expires_at)
  values ('10000000-0000-4000-8000-00000000000a', 'f3300000-0000-4000-8000-00000000000b', 'start_renewal',
          '{"action":"start_renewal"}', '{}', repeat('b', 64), true, 'pgtap-0332-cross-01', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day')
$$, '42501', null, 'a proposal about another brokerage''s policy is refused');

select throws_ok($$
  insert into prepared_actions (organization_id, action_type, payload, source_versions, fingerprint, permitted, idempotency_key, prepared_by, expires_at)
  values ('10000000-0000-4000-8000-00000000000a', 'start_renewal',
          '{"action":"start_renewal"}', '{}', repeat('c', 64), true, 'pgtap-0332-nosub-1', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day')
$$, '23514', null, 'a proposal about nothing is refused');

select throws_ok($$
  update prepared_actions set policy_id = null, placement_id = null
   where idempotency_key = 'pgtap-0332-ok-0001'
$$, null, null, 'what a policy proposal is about cannot be changed after it was prepared');

-- A browser session: no server-held key.
select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok($$
  insert into prepared_actions (organization_id, policy_id, action_type, payload, source_versions, fingerprint, permitted, idempotency_key, prepared_by, expires_at)
  values ('10000000-0000-4000-8000-00000000000a', 'f3300000-0000-4000-8000-00000000000a', 'start_renewal',
          '{"action":"start_renewal"}', '{}', repeat('d', 64), true, 'pgtap-0332-browser', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day')
$$, null, null, 'a browser session cannot prepare one directly');

select is((select count(*)::int from prepared_actions where policy_id = 'f3300000-0000-4000-8000-00000000000a'), 1,
          'the member reads its own brokerage''s proposal');

-- Brokerage B's member sees none of A's.
select pg_temp.login('b0000000-0000-4000-8000-000000000001', false);
select is((select count(*)::int from prepared_actions where policy_id = 'f3300000-0000-4000-8000-00000000000a'), 0,
          'another brokerage sees no policy proposal of A''s');

select * from finish();
rollback;
