-- pgTAP: connected mailboxes and send evidence (0035).
--
-- The send-evidence rule is asserted here rather than only in the service, because the service is
-- not the only thing that will ever write these rows. A worker, a retry job or a later feature
-- must meet the same bar: a message is `sent` only when the provider's id is on the row.
begin;
select plan(13);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'mailboxes', 'mailboxes exists');
select has_table('public', 'email_threads', 'email_threads exists');
select has_table('public', 'email_messages', 'email_messages exists');
select has_table('public', 'email_attachments', 'email_attachments exists');
select has_table('public', 'email_send_attempts', 'email_send_attempts exists');
select is(
  (select count(*)::int from pg_class
   where oid in ('public.mailboxes'::regclass,'public.email_threads'::regclass,
                 'public.email_messages'::regclass,'public.email_attachments'::regclass,
                 'public.email_send_attempts'::regclass)
     and relrowsecurity),
  5,
  'row level security is enabled on all five');
select is(
  (select count(*)::int from pg_policies
   where schemaname='public'
     and tablename in ('mailboxes','email_threads','email_messages','email_attachments','email_send_attempts')
     and ((coalesce(qual,'')||coalesce(with_check,'')) not like '%can_access%'
          or roles::text[] @> array['anon'])),
  0,
  'every policy carries the brokerage scope and none reaches anon');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');
insert into mailboxes (id, organization_id, provider, email_address, connected_by)
values ('b1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a',
        'gmail', 'broking@acme-brokers.test', 'a0000000-0000-4000-8000-000000000001');

-- The rule this table exists for.
select throws_ok(
  $$insert into email_send_attempts (organization_id, mailbox_id, idempotency_key, approved_by, approved_at, outcome)
    values ('10000000-0000-4000-8000-00000000000a','b1000000-0000-4000-8000-000000000001','k1',
            'a0000000-0000-4000-8000-000000000001', now(), 'sent')$$,
  '23514', null, 'nothing can be marked sent without the provider''s id');
-- And its converse: an id that arrived means it went.
select throws_ok(
  $$insert into email_send_attempts (organization_id, mailbox_id, idempotency_key, approved_by, approved_at, outcome, provider_message_id, provider_accepted_at)
    values ('10000000-0000-4000-8000-00000000000a','b1000000-0000-4000-8000-000000000001','k2',
            'a0000000-0000-4000-8000-000000000001', now(), 'failed', 'gm-1', now())$$,
  '23514', null, 'a provider id cannot sit on an attempt that is not sent');
-- A failure a person is shown has to say something.
select throws_ok(
  $$insert into email_send_attempts (organization_id, mailbox_id, idempotency_key, approved_by, approved_at, outcome)
    values ('10000000-0000-4000-8000-00000000000a','b1000000-0000-4000-8000-000000000001','k3',
            'a0000000-0000-4000-8000-000000000001', now(), 'outcome_unknown')$$,
  '23514', null, 'an unknown outcome without a reason is refused');

-- Idempotency, at the database. This is what stops a retry becoming a second email.
insert into email_send_attempts (organization_id, mailbox_id, idempotency_key, approved_by, approved_at)
values ('10000000-0000-4000-8000-00000000000a','b1000000-0000-4000-8000-000000000001','same-intent',
        'a0000000-0000-4000-8000-000000000001', now());
select throws_ok(
  $$insert into email_send_attempts (organization_id, mailbox_id, idempotency_key, approved_by, approved_at)
    values ('10000000-0000-4000-8000-00000000000a','b1000000-0000-4000-8000-000000000001','same-intent',
            'a0000000-0000-4000-8000-000000000001', now())$$,
  '23505', null, 'the same intent cannot be attempted twice on one mailbox');

-- An approval belongs to the person making it: nobody can record someone else as the approver.
select throws_ok(
  $$insert into email_send_attempts (organization_id, mailbox_id, idempotency_key, approved_by, approved_at)
    values ('10000000-0000-4000-8000-00000000000a','b1000000-0000-4000-8000-000000000001','forged',
            'a0000000-0000-4000-8000-000000000002', now())$$,
  '42501', null, 'a send cannot be recorded as approved by someone else');
reset role;

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from mailboxes), 0, 'another brokerage sees no mailbox of Acme''s');
reset role;

select * from finish();
rollback;
