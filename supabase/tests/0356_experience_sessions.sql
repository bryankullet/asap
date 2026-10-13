-- pgTAP: experience sessions (0092, D-172) — personal, per brokerage, never cross-tenant, never deleted.
begin;
select plan(9);

select ok((select relrowsecurity from pg_class where relname = 'experience_sessions'), 'row level security is on');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public'
  and table_name = 'experience_sessions' and grantee = 'anon' $$, 'a signed-out browser holds nothing');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public'
  and table_name = 'experience_sessions' and grantee = 'authenticated' and privilege_type = 'DELETE' $$, 'members cannot delete an experience');

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select lives_ok($$ insert into experience_sessions (id, organization_id, user_id, title, kind, expression)
  values ('e0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'Add a new client', 'create_client', 'Add a new client') $$,
  'a member keeps their own experience in their brokerage');
select throws_ok($$ insert into experience_sessions (organization_id, user_id, title, kind, expression)
  values ('10000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002', 'x', 'create_client', 'x') $$,
  '42501', null, 'not in a brokerage they do not belong to');
select throws_ok($$ insert into experience_sessions (organization_id, user_id, title, kind, expression)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'x', 'create_client', 'x') $$,
  '42501', null, 'not on a colleague''s behalf');
select throws_ok($$ insert into experience_sessions (organization_id, user_id, title, kind, expression)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'x', 'drop_tables', 'x') $$,
  '23514', null, 'the kind is from a closed set');
reset role;
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is_empty($$ select 1 from experience_sessions where id = 'e0000000-0000-4000-8000-000000000001' $$, 'a colleague''s experience is invisible');
select is_empty($$ update experience_sessions set title = 'taken' where id = 'e0000000-0000-4000-8000-000000000001' returning 1 $$, 'and cannot be changed by them');
reset role;
select * from finish();
rollback;
