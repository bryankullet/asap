-- pgTAP: standing approvals for insurer chasers (0073, D-147).
begin;
select plan(9);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select ok((select relrowsecurity from pg_class where relname = 'chaser_templates') and (select relrowsecurity from pg_class where relname = 'chaser_sends'), 'row level security is on for templates and sends');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ('chaser_templates', 'chaser_sends')
  and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$, 'no browser role may write a template or a send');

insert into chaser_templates (id, organization_id, purpose, version, subject_template, body_template, min_days_between, sha256, approved_by)
values ('f3450000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'quote_chase', 1, 'Follow-up {{follow_up}}', 'Dear {{insurer}}, kindly send your terms.', 3, repeat('a', 64), 'a0000000-0000-4000-8000-000000000001');
select throws_like($$ insert into chaser_templates (organization_id, purpose, version, audience, subject_template, body_template, min_days_between, sha256, approved_by)
  values ('10000000-0000-4000-8000-00000000000a', 'placement_chase', 1, 'client', 'Follow-up', 'Dear client, kindly send your documents.', 3, repeat('b', 64), 'a0000000-0000-4000-8000-000000000001') $$,
  '%chaser_templates_audience_check%', 'a client-facing message can never be a standing chaser');
select throws_like($$ insert into chaser_templates (organization_id, purpose, version, subject_template, body_template, min_days_between, sha256, approved_by)
  values ('10000000-0000-4000-8000-00000000000a', 'quote_chase', 2, 'Follow-up again', 'Dear {{insurer}}, kindly send your terms now.', 3, repeat('c', 64), 'a0000000-0000-4000-8000-000000000001') $$,
  '%chaser_templates_one_live%', 'one live approved wording per purpose');
select throws_like($$ insert into chaser_templates (organization_id, purpose, version, subject_template, body_template, min_days_between, sha256, approved_by)
  values ('10000000-0000-4000-8000-00000000000a', 'placement_chase', 1, 'Follow-up', 'Dear {{insurer}}, kindly confirm cover.', 0, repeat('d', 64), 'a0000000-0000-4000-8000-000000000001') $$,
  '%chaser_templates_min_days_between_check%', 'a standing chaser always has a minimum gap');
select ok(exists(select 1 from pg_constraint where conname = 'chaser_sends_run_id_party_follow_up_key'), 'one send per run, insurer and follow-up');

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is_empty($$ select id from chaser_templates where id = 'f3450000-0000-4000-8000-00000000000a' $$, 'another brokerage cannot see the template');
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select isnt_empty($$ select id from chaser_templates where id = 'f3450000-0000-4000-8000-00000000000a' $$, 'a member reads their own brokerage''s template');
select throws_ok($$ select chaser_template_withdraw('f3450000-0000-4000-8000-00000000000a') $$, NULL, 'withdrawing needs the API');
reset role;
select * from finish();
rollback;
