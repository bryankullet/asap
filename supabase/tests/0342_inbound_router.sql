-- pgTAP: the inbound router (0070, D-144).
--   * inbound_classifications: RLS on; members read their own brokerage only; no browser role
--     writes; one proposal per message; a routed proposal names its run and who routed it; a model
--     proposal names its model;
--   * the intake mailbox is never "connected", and there is one per brokerage;
--   * an Unsorted email is a Work item of its own kind.
begin;
select plan(12);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select ok((select relrowsecurity from pg_class where relname = 'inbound_classifications'), 'row level security is on for inbound proposals');
select is_empty($$
  select privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'inbound_classifications'
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
$$, 'no browser role may write a proposal');

insert into mailboxes (id, organization_id, provider, email_address, connected_by, status)
values ('f3420000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'manual', 'intake@asap.invalid', 'a0000000-0000-4000-8000-000000000001', 'intake');
select throws_like($$ insert into mailboxes (organization_id, provider, email_address, connected_by, status)
  values ('10000000-0000-4000-8000-00000000000a', 'manual', 'other@asap.invalid', 'a0000000-0000-4000-8000-000000000001', 'intake') $$,
  '%mailboxes_one_intake_per_organization%', 'one intake mailbox per brokerage');
select throws_like($$ insert into mailboxes (organization_id, provider, email_address, connected_by, status)
  values ('20000000-0000-4000-8000-00000000000b', 'manual', 'intake@asap.invalid', 'b0000000-0000-4000-8000-000000000001', 'connected') $$,
  '%mailboxes_intake_is_manual%', 'the intake mailbox is never "connected"');
insert into email_threads (id, organization_id, mailbox_id, provider_thread_id, subject)
values ('f3420000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'f3420000-0000-4000-8000-00000000000a', 'pasted-1', 'Quotation');
insert into email_messages (id, organization_id, thread_id, provider_message_id, direction, from_address, subject, sent_at)
values ('f3420000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000a', 'f3420000-0000-4000-8000-00000000000b', 'pasted-1', 'inbound', 'uw@jubilee.test', 'RE: Quotation', now());

insert into inbound_classifications (organization_id, email_message_id, kind, confidence, source, model, state)
values ('10000000-0000-4000-8000-00000000000a', 'f3420000-0000-4000-8000-00000000000c', 'insurer_quote', 0.95, 'model', 'fake:fake', 'unsorted');
select throws_like($$ insert into inbound_classifications (organization_id, email_message_id, source, state)
  values ('10000000-0000-4000-8000-00000000000a', 'f3420000-0000-4000-8000-00000000000c', 'none', 'unsorted') $$,
  '%inbound_classifications_email_message_id_key%', 'one proposal per message');
select throws_like($$ update inbound_classifications set state = 'routed' where email_message_id = 'f3420000-0000-4000-8000-00000000000c' $$,
  '%inbound_classifications_routed_whole%', 'a routed proposal names its run and who routed it');
select throws_like($$ update inbound_classifications set model = null where email_message_id = 'f3420000-0000-4000-8000-00000000000c' $$,
  '%inbound_classifications_model_named%', 'a model proposal names its model');
select lives_ok($$ insert into work_items (organization_id, title, kind, task_status, steps) values ('10000000-0000-4000-8000-00000000000a', 'Unsorted email — x', 'inbound', 'needs_you', '[]') $$,
  'an Unsorted email is a Work item of its own kind');

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is_empty($$ select id from inbound_classifications where email_message_id = 'f3420000-0000-4000-8000-00000000000c' $$, 'another brokerage cannot see the proposal');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select isnt_empty($$ select id from inbound_classifications where email_message_id = 'f3420000-0000-4000-8000-00000000000c' $$, 'a member reads their own brokerage''s proposal');
select throws_ok($$ update inbound_classifications set state = 'dismissed' where email_message_id = 'f3420000-0000-4000-8000-00000000000c' $$,
  NULL, 'a member cannot change a proposal directly');
select throws_ok($$ select inbound_decide('f3420000-0000-4000-8000-00000000000c', 'dismiss', null, 'Spam') $$,
  NULL, 'deciding needs the API, never a browser session alone');

reset role;
select * from finish();
rollback;
