-- pgTAP: insurer replies read from email are proposals (0076, D-152).
begin;
select plan(5);
select ok((select relrowsecurity from pg_class where relname = 'insurer_response_proposals'), 'row level security is on for proposed responses');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'insurer_response_proposals'
  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$, 'no browser role may write a proposed response');
select ok(exists(select 1 from pg_constraint where conname = 'insurer_response_proposals_accepted_names_response'), 'an accepted reading names the response it became');
select ok(exists(select 1 from pg_constraint where conname = 'insurer_response_proposals_amount_needs_currency'), 'a premium read always carries its currency');
set local role authenticated;
select throws_ok($$ select insurer_response_proposal_decide(gen_random_uuid(), 'rejected', null) $$, NULL, 'deciding needs the API');
reset role;
select * from finish();
rollback;
