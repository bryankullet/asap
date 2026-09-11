-- pgTAP: recording cover the brokerage already places (0038, D-068).
--
-- A brokerage that signs up today has a book already, and this is how it goes in. What the
-- function must hold:
--   - the client decides the brokerage, and a non-member cannot record cover for it
--   - writes are refused without the API key header, like every other engine write
--   - the insurer arrives by name and is created once, not once per policy
--   - asking twice is the same policy: a second period, never a twin
--   - a period that ends before it starts is refused, at the function, not only in a form
begin;
select plan(14);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-policy-key-0123456789abcdef01"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-policy-key-0123456789abcdef01', 'sha256'), 'hex'), 'pgtap-policy');

\set acme_ae  '''a0000000-0000-4000-8000-000000000002'''
\set beta_ae  '''b0000000-0000-4000-8000-000000000002'''
\set acme_org '''10000000-0000-4000-8000-00000000000a'''

-- A client of Acme's, created for this test so the seed's own policies stay untouched.
select pg_temp.login(:acme_ae, true);
create temp table t_client as
  select (public.client_create(:acme_org, 'Tested Holdings Ltd', 'corporate', 'manual') ->> 'id')::uuid as id;

-- 1. The API-only gate applies here as it does to every other engine write.
select pg_temp.login(:acme_ae, false);
select throws_like(
  $$ select public.policy_create((select id from t_client), 'Jubilee', 'Motor commercial', 'POL-1', '2026-01-01', '2026-12-31') $$,
  '%api_only%', 'a browser holding the anon key cannot record a policy');

-- 2. A member of another brokerage cannot record cover for this client.
select pg_temp.login(:beta_ae, true);
select throws_like(
  $$ select public.policy_create((select id from t_client), 'Jubilee', 'Motor commercial', 'POL-1', '2026-01-01', '2026-12-31') $$,
  '%not_a_member%', 'another brokerage cannot record cover for a client that is not theirs');

select pg_temp.login(:acme_ae, true);

-- 3. Validation lives in the function, not only in the form it came from.
select throws_like(
  $$ select public.policy_create((select id from t_client), '  ', 'Motor commercial', null, '2026-01-01', '2026-12-31') $$,
  '%insurer_required%', 'a policy names its insurer');
select throws_like(
  $$ select public.policy_create((select id from t_client), 'Jubilee', '', null, '2026-01-01', '2026-12-31') $$,
  '%class_of_business_required%', 'a policy names its class');
select throws_like(
  $$ select public.policy_create((select id from t_client), 'Jubilee', 'Motor commercial', null, '2026-12-31', '2026-01-01') $$,
  '%period_end_before_start%', 'a period cannot end before it starts');
select throws_like(
  $$ select public.policy_create('00000000-0000-4000-8000-000000000000', 'Jubilee', 'Motor', null, '2026-01-01', '2026-12-31') $$,
  '%not_found%', 'cover cannot be recorded for a client that does not exist');

-- 4. The first policy, and the insurer it brings with it.
create temp table t_first as
  select public.policy_create((select id from t_client), 'Sanlam General', 'Motor commercial',
                              'POL-TEST-1', '2026-01-01', '2026-12-31') as result;
select is((select (result ->> 'created')::boolean from t_first), true, 'the policy is recorded');
select is(
  (select count(*)::int from insurers where organization_id = :acme_org and name = 'Sanlam General'),
  1, 'the insurer is created by name, once');
select is(
  (select count(*)::int from policies where id = (select (result ->> 'policy_id')::uuid from t_first)),
  1, 'the policy row exists');
select is(
  (select version from policy_versions where policy_id = (select (result ->> 'policy_id')::uuid from t_first)),
  1, 'version 1 records the policy as it was recorded');
select is(
  (select items from policy_versions where policy_id = (select (result ->> 'policy_id')::uuid from t_first)),
  '[]'::jsonb, 'and itemises nothing, because recording cover is not reading a schedule');

-- 5. Asking twice is the same policy. A second period, never a twin.
create temp table t_again as
  select public.policy_create((select id from t_client), 'Sanlam General', 'Motor commercial',
                              'POL-TEST-1', '2027-01-01', '2027-12-31') as result;
select is((select (result ->> 'created')::boolean from t_again), false,
  'the second call did not create a second policy');
select is(
  (select (result ->> 'policy_id') from t_again), (select (result ->> 'policy_id') from t_first),
  'it is the same policy');
select is(
  (select count(*)::int from policy_periods
    where policy_id = (select (result ->> 'policy_id')::uuid from t_first)),
  2, 'and it now has both periods of cover');

rollback;
