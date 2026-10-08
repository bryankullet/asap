-- pgTAP: suggested fixes for stopped runs (0072, D-146).
begin;
select plan(7);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select ok((select relrowsecurity from pg_class where relname = 'exception_suggestions'), 'row level security is on for suggestions');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'exception_suggestions'
  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$, 'no browser role may write a suggestion');

insert into workflow_runs (id, organization_id, workflow, subject_type, subject_id)
values ('f3440000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'placement', 'placement', gen_random_uuid());
insert into exception_suggestions (id, organization_id, run_id, event_id, exception_code, suggestion, model)
values ('f3440000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'f3440000-0000-4000-8000-00000000000a', gen_random_uuid(), 'x', 'Record the insurer''s address from correspondence.', 'fake:fake');
select throws_like($$ update exception_suggestions set state = 'accepted' where id = 'f3440000-0000-4000-8000-00000000000b' $$,
  '%exception_suggestions_decided_whole%', 'an accepted suggestion names who accepted it, and when');
select throws_like($$ insert into exception_suggestions (organization_id, run_id, event_id, exception_code, suggestion, model)
  select organization_id, run_id, event_id, 'x', 'Another suggestion for the same event.', 'fake:fake' from exception_suggestions where id = 'f3440000-0000-4000-8000-00000000000b' $$,
  '%exception_suggestions_event_id_key%', 'one suggestion per reported exception');

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is_empty($$ select id from exception_suggestions where id = 'f3440000-0000-4000-8000-00000000000b' $$, 'another brokerage cannot see the suggestion');
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select isnt_empty($$ select id from exception_suggestions where id = 'f3440000-0000-4000-8000-00000000000b' $$, 'a member reads their own brokerage''s suggestion');
select throws_ok($$ select exception_suggestion_decide('f3440000-0000-4000-8000-00000000000b', 'accept', null) $$, NULL, 'deciding needs the API');
reset role;
select * from finish();
rollback;
