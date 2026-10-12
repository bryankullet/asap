-- pgTAP: surface preferences (0080, D-157) — personal, per brokerage and surface, never cross-tenant.
begin;
select plan(7);

select ok((select relrowsecurity from pg_class where relname = 'surface_preferences'), 'row level security is on');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public'
  and table_name = 'surface_preferences' and grantee = 'anon' $$, 'a signed-out browser holds nothing');

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select lives_ok($$ insert into surface_preferences (organization_id, user_id, surface_key, prefs)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'home', '{"collapsed":["x"]}') $$,
  'a member keeps their own arrangement in their brokerage');
select throws_ok($$ insert into surface_preferences (organization_id, user_id, surface_key, prefs)
  values ('10000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002', 'home', '{}') $$,
  '42501', null, 'not in a brokerage they do not belong to');
select throws_ok($$ insert into surface_preferences (organization_id, user_id, surface_key, prefs)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'home', '{}') $$,
  '42501', null, 'not on a colleague''s behalf');
select throws_ok($$ insert into surface_preferences (organization_id, user_id, surface_key, prefs)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'bad key;drop', '{}') $$,
  '23514', null, 'a surface key is an identity, not free text');
reset role;
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is_empty($$ select 1 from surface_preferences where user_id = 'a0000000-0000-4000-8000-000000000002' $$, 'a colleague''s arrangement is invisible');
reset role;
select * from finish();
rollback;
