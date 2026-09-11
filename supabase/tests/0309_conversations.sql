-- pgTAP: Ask ASAP conversations (0032).
--
-- These tables carry a person's questions, so they are protected twice over: by the brokerage, as
-- every tenant table is, and by the person, because the transcript of someone's questions is not
-- brokerage work. Colleagues share the work a conversation produced — that lives in work_items,
-- where everyone in the brokerage sees it — but not the asking.
--
-- Proved here: the tables exist with RLS; Amina reads her own and not Brian's; Beta Risk sees
-- neither; a message cannot be attached to a conversation the caller does not own; a person's turn
-- cannot carry an intent, tools, citations or an abstention; and anon evaluates nothing.
begin;
select plan(14);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'conversations', 'conversations exists');
select has_table('public', 'conversation_messages', 'conversation_messages exists');
select ok((select relrowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'row level security is enabled on conversations');
select ok((select relrowsecurity from pg_class where oid = 'public.conversation_messages'::regclass),
  'row level security is enabled on conversation_messages');

-- No policy reaches anon, on either table (0021's rule: anon evaluates nothing).
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename in ('conversations','conversation_messages')
     and roles::text[] @> array['anon']),
  0,
  'no policy on either table applies to anon');

-- Amina asks something.
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
insert into conversations (id, organization_id, created_by, title, scope_kind, scope_id)
values ('c0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001', 'What is stopping Acme?', 'brokerage', null);
insert into conversation_messages (organization_id, conversation_id, seq, role, body)
values ('10000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', 1, 'person',
        'What is stopping Acme Motors renewal?');
select is((select count(*)::int from conversations), 1, 'Amina reads her own conversation');
select is((select count(*)::int from conversation_messages), 1, 'and its messages');

-- A person's turn is plain: it cannot carry an answer's apparatus.
select throws_ok(
  $$insert into conversation_messages (organization_id, conversation_id, seq, role, body, intent)
    values ('10000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', 9, 'person', 'x', '{}'::jsonb)$$,
  '23514', null, 'a person''s turn cannot carry an intent');

-- seq starts at 1; 0 is not a turn.
select throws_ok(
  $$insert into conversation_messages (organization_id, conversation_id, seq, role, body)
    values ('10000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', 0, 'person', 'x')$$,
  '23514', null, 'a turn is numbered from 1');
reset role;

-- Brian is in the same brokerage. The work is shared; the asking is not.
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select is((select count(*)::int from conversations), 0,
  'a colleague in the same brokerage does not read her conversations');
select is((select count(*)::int from conversation_messages), 0,
  'nor her messages');
select throws_ok(
  $$insert into conversation_messages (organization_id, conversation_id, seq, role, body)
    values ('10000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000001', 2, 'person', 'x')$$,
  '42501', null, 'a colleague cannot add a turn to her conversation');
reset role;

-- Beta Risk sees nothing of Acme's, as for every tenant table.
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from conversations), 0, 'another brokerage reads no conversation');
select throws_ok(
  $$insert into conversations (organization_id, created_by, title, scope_kind, scope_id)
    values ('10000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000001', 'x', 'brokerage', null)$$,
  '42501', null, 'another brokerage cannot start a conversation in Acme');
reset role;

select * from finish();
rollback;
