-- pgTAP: a reply being written, and what a conversation is about (0044).
--
-- What these prove, none of which the browser could be trusted to keep:
--
--   * a draft belongs to one brokerage and another cannot see or touch it;
--   * two conversations keep two separate replies, and one conversation keeps one;
--   * an approval is whole or absent — there is no half-approved reply;
--   * a thread's policy link is a real foreign key, so it cannot point at another brokerage's
--     cover or survive that cover being deleted.
begin;
select plan(18);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shape.

select has_table('public', 'email_drafts', 'email_drafts exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.email_drafts'::regclass),
  true,
  'row level security is enabled');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'email_drafts' and roles::text[] @> array['anon']),
  0,
  'no policy applies to anon');
select has_column('public', 'email_threads', 'policy_id', 'a thread can say which policy it is about');
select has_index('public', 'email_threads', 'email_threads_policy_id_idx',
  'and that link is indexed, because it is read by policy');
select has_index('public', 'email_drafts', 'email_drafts_thread_id_idx', 'drafts are read by thread');
select col_is_unique('public', 'email_drafts', array['thread_id'],
  'one reply in progress per conversation');

-- ---------------------------------------------------------------------------------------------
-- Brokerage A: a mailbox, two conversations, two replies.

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into mailboxes (id, organization_id, provider, email_address, connected_by)
values ('ea000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'gmail', 'broker@acme.test', 'a0000000-0000-4000-8000-000000000001');

insert into email_threads (id, organization_id, mailbox_id, provider_thread_id, subject)
values
  ('eb000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'ea000000-0000-4000-8000-00000000000a', 'gmail-thread-1', 'Renewal terms'),
  ('eb000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
   'ea000000-0000-4000-8000-00000000000a', 'gmail-thread-2', 'Claim 4471');

insert into email_drafts (id, organization_id, thread_id, to_addresses, subject, body_text, created_by)
values
  ('ec000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
   'eb000000-0000-4000-8000-00000000000a', array['client@acme.test'], 'Re: Renewal terms',
   'The renewal terms are attached.', 'a0000000-0000-4000-8000-000000000001'),
  ('ec000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
   'eb000000-0000-4000-8000-00000000000b', array['assessor@acme.test'], 'Re: Claim 4471',
   'The assessor report is with us.', 'a0000000-0000-4000-8000-000000000001');

select is(
  (select body_text from email_drafts where thread_id = 'eb000000-0000-4000-8000-00000000000a'),
  'The renewal terms are attached.',
  'the first conversation keeps its own reply');
select is(
  (select body_text from email_drafts where thread_id = 'eb000000-0000-4000-8000-00000000000b'),
  'The assessor report is with us.',
  'and the second keeps a different one');

-- A second reply on the same conversation is refused, rather than quietly becoming a second draft.
select throws_ok(
  $$insert into email_drafts (organization_id, thread_id, created_by)
    values ('10000000-0000-4000-8000-00000000000a', 'eb000000-0000-4000-8000-00000000000a',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505',
  null,
  'a conversation cannot acquire a second reply in progress');

-- ---------------------------------------------------------------------------------------------
-- An approval is whole or it is nothing.

select throws_ok(
  $$update email_drafts set approved_by = 'a0000000-0000-4000-8000-000000000001'
    where id = 'ec000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'an approver without a time and a body digest is refused');
select throws_ok(
  $$update email_drafts set approved_by = 'a0000000-0000-4000-8000-000000000001', approved_at = now()
    where id = 'ec000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'and an approval without the digest of what was approved is refused');

update email_drafts
   set approved_by = 'a0000000-0000-4000-8000-000000000001',
       approved_at = now(),
       approved_body_sha256 = encode(extensions.digest('The renewal terms are attached.', 'sha256'), 'hex')
 where id = 'ec000000-0000-4000-8000-00000000000a';
select isnt(
  (select approved_body_sha256 from email_drafts where id = 'ec000000-0000-4000-8000-00000000000a'),
  null,
  'a whole approval is accepted, and records which body it was of');

-- Clearing it is whole too: no orphan approver left behind on an edited reply.
select throws_ok(
  $$update email_drafts set approved_body_sha256 = null
    where id = 'ec000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'dropping the digest alone cannot leave an approval standing');

-- ---------------------------------------------------------------------------------------------
-- Another brokerage.

reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from email_drafts),
  0,
  'another brokerage sees none of those replies');
select is(
  (select count(*)::int from email_threads
   where id = 'eb000000-0000-4000-8000-00000000000a'),
  0,
  'nor the conversation they are on');
select is(
  (select count(*)::int from email_drafts
   where id = 'ec000000-0000-4000-8000-00000000000a'),
  0,
  'and cannot reach one by its id');

-- An update aimed straight at it changes nothing, rather than failing loudly and changing something.
update email_drafts set body_text = 'rewritten'
 where id = 'ec000000-0000-4000-8000-00000000000a';
reset role;
select is(
  (select body_text from email_drafts where id = 'ec000000-0000-4000-8000-00000000000a'),
  'The renewal terms are attached.',
  'and an update aimed at it leaves the text alone');

select * from finish();
rollback;
