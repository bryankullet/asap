-- pgTAP: verified insurer addresses and sent messages (0071, D-145).
begin;
select plan(8);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select ok((select relrowsecurity from pg_class where relname = 'insurer_contacts'), 'row level security is on for insurer contacts');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'insurer_contacts'
  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$, 'no browser role may write an insurer address');

insert into insurer_contacts (id, organization_id, insurer_id, email, source, verified_by)
select 'f3430000-0000-4000-8000-00000000000a', i.organization_id, i.id, 'uw@insurer.test', 'Circular', 'a0000000-0000-4000-8000-000000000001'
  from insurers i where i.organization_id = '10000000-0000-4000-8000-00000000000a' limit 1;
select throws_like($$ insert into insurer_contacts (organization_id, insurer_id, email, source, verified_by)
  select organization_id, insurer_id, 'uw@insurer.test', 'Again', verified_by from insurer_contacts where id = 'f3430000-0000-4000-8000-00000000000a' $$,
  '%insurer_contacts_one_live_address%', 'one live record per address');
select throws_like($$ insert into insurer_contacts (organization_id, insurer_id, email, source, verified_by)
  select organization_id, insurer_id, 'other@insurer.test', ' ', verified_by from insurer_contacts where id = 'f3430000-0000-4000-8000-00000000000a' $$,
  '%insurer_contacts_source_check%', 'an address carries how the person knows it');
select ok(exists(select 1 from pg_constraint where conname = 'prepared_communications_sent_has_attempt'), 'a sent message names the send attempt that is its evidence');

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is_empty($$ select id from insurer_contacts where id = 'f3430000-0000-4000-8000-00000000000a' $$, 'another brokerage cannot see the address');
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select isnt_empty($$ select id from insurer_contacts where id = 'f3430000-0000-4000-8000-00000000000a' $$, 'a member reads their own brokerage''s address');
select throws_ok($$ select prepared_communication_record_sent(gen_random_uuid(), gen_random_uuid(), null) $$, NULL, 'recording a send needs the API');
reset role;
select * from finish();
rollback;
