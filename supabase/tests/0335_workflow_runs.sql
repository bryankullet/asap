-- pgTAP: durable workflow runs (0062, D-129).
--   * RLS on all four tables; members read their own brokerage only; no browser writes;
--   * the lease function is the service connection's alone;
--   * deciding a bundle needs the server key and email:approve, the shown digest, and a reason to reject;
--     it audits, emits an event, approves the bundle's messages, and is idempotent;
--   * a delivery needs an approved message and evidence; "sent" needs a provider id.
begin;
select plan(18);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0335-abcdef0123456789"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0335-abcdef0123456789', 'sha256'), 'hex'), 'pgtap-0335');

select ok((select bool_and(relrowsecurity) from pg_class where relname in ('workflow_runs', 'workflow_steps', 'workflow_approvals', 'prepared_communications')),
  'row level security is on for all four tables');
select is_empty($$
  select table_name || ':' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('workflow_runs', 'workflow_steps', 'workflow_approvals', 'prepared_communications')
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
$$, 'no browser role may write a run, a step, an approval or a message');
select ok(not has_function_privilege('authenticated', 'public.workflow_run_claim(uuid, timestamptz, timestamptz)', 'execute'),
  'only the service connection may take a lease');

-- Fixture, as the owner.
insert into workflow_runs (id, organization_id, workflow, subject_type, subject_id, state)
values ('f3350000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'renewal', 'policy_period', gen_random_uuid(), 'waiting_approval');
insert into workflow_approvals (id, organization_id, run_id, step_key, title, bundle, bundle_sha256)
values ('f3350000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'f3350000-0000-4000-8000-00000000000a', 'approval', 'Approve renewal',
        '[{"kind":"pack"}]', repeat('a', 64));
insert into prepared_communications (id, organization_id, run_id, approval_id, audience, party_name, subject, body_text, body_sha256)
values ('f3350000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000a', 'f3350000-0000-4000-8000-00000000000a', 'f3350000-0000-4000-8000-00000000000b',
        'client', 'Acme Motors', 'Renewal', 'Please confirm.', repeat('b', 64));

select throws_like($$ update prepared_communications set state = 'sent' where id = 'f3350000-0000-4000-8000-00000000000c' $$,
  '%prepared_communications_sent_has_provider_id%', 'a message is never "sent" without the provider''s id');
select throws_like($$ insert into workflow_runs (organization_id, workflow, subject_type, subject_id)
  select organization_id, workflow, subject_type, subject_id from workflow_runs where id = 'f3350000-0000-4000-8000-00000000000a' $$,
  '%workflow_runs_one_live_per_subject%', 'one live run per subject');

select pg_temp.login('b0000000-0000-4000-8000-000000000001', true);
select is_empty($$ select id from workflow_runs where id = 'f3350000-0000-4000-8000-00000000000a' $$, 'another brokerage cannot see the run');
select throws_like($$ select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'approve', repeat('a', 64), null) $$,
  '%not_found%', 'another brokerage cannot decide the bundle');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok($$ select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'approve', repeat('a', 64), null) $$,
  NULL, 'a browser session without the server key cannot decide');
select isnt_empty($$ select id from workflow_steps union all select id from workflow_runs where id = 'f3350000-0000-4000-8000-00000000000a' $$,
  'a member reads their own brokerage''s runs');

select pg_temp.login('c0000000-0000-4000-8000-000000000001', true);
select throws_like($$ select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'approve', repeat('a', 64), null) $$,
  '%permission_denied%', 'a read-only member cannot approve');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_like($$ select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'approve', repeat('0', 64), null) $$,
  '%bundle_changed%', 'a bundle that changed since it was shown is not approved');
select throws_like($$ select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'reject', repeat('a', 64), '') $$,
  '%reason_required%', 'rejecting needs a reason');
select throws_like($$ select prepared_communication_record_delivery('f3350000-0000-4000-8000-00000000000c', 'own_email', 'Emailed 10:02', now()) $$,
  '%not_approved%', 'an unapproved message cannot have been delivered');
select is((select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'approve', repeat('a', 64), null)->>'changed'), 'true', 'the administrator approves');
select is((select workflow_approval_decide('f3350000-0000-4000-8000-00000000000b', 'approve', repeat('a', 64), null)->>'changed'), 'false', 'approving twice changes nothing');
select is((select prepared_communication_record_delivery('f3350000-0000-4000-8000-00000000000c', 'own_email', 'Emailed from Outlook 10:02', now())->>'changed'), 'true',
  'the approved message is recorded as delivered by a person, with evidence');

reset role;
select is((select count(*)::int from audit_log where object_id = 'f3350000-0000-4000-8000-00000000000a' and action in ('workflow.bundle_approved', 'workflow.communication_delivered')),
  2, 'the approval and the delivery are audited, once each');
select is((select count(*)::int from events where entity_id = 'f3350000-0000-4000-8000-00000000000a' and event_type like 'workflow.%'),
  2, 'each emits one event, so the run continues even if the API stops');

select * from finish();
rollback;
