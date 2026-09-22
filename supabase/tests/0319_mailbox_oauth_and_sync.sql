-- pgTAP: connecting a mailbox, and reading it under control (0045).
--
-- What these prove:
--
--   * an authorisation state is reachable by nobody through RLS — the API consumes it during a
--     redirect that has no session, and no signed-in person can list or guess another
--     brokerage's pending authorisations;
--   * a mailbox has one pass at a time, enforced by the database rather than by a disabled button;
--   * a failed pass must say why, and a finished one must say when;
--   * sync runs are tenant-scoped, so one brokerage cannot read another's reading history.
begin;
select plan(17);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shape.

select has_table('public', 'mailbox_oauth_states', 'mailbox_oauth_states exists');
select has_table('public', 'mailbox_sync_runs', 'mailbox_sync_runs exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.mailbox_oauth_states'::regclass),
  true,
  'row level security is enabled on the authorisation states');
select is(
  (select relrowsecurity from pg_class where oid = 'public.mailbox_sync_runs'::regclass),
  true,
  'and on the sync runs');
-- No policy at all is the point: nothing reaches this table through a tenant path.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'mailbox_oauth_states'),
  0,
  'no policy exposes an authorisation state to anybody');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'mailbox_sync_runs'
     and roles::text[] @> array['anon']),
  0,
  'no sync-run policy applies to anon');
select col_is_unique('public', 'mailbox_oauth_states', array['state_hash'],
  'a state can be presented for one authorisation only');
select has_column('public', 'mailboxes', 'sync_cursor_updated_at',
  'the checkpoint records when it was last written');
select has_index('public', 'mailbox_sync_runs', 'mailbox_sync_runs_one_running_per_mailbox',
  'one pass at a time is an index, not a convention');

-- ---------------------------------------------------------------------------------------------
-- Brokerage A's mailbox and its passes.

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into mailboxes (id, organization_id, provider, email_address, connected_by)
values ('ea000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'gmail', 'broker@acme.test', 'a0000000-0000-4000-8000-000000000001');

insert into mailbox_sync_runs (id, organization_id, mailbox_id, trigger)
values ('ed000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'ea000000-0000-4000-8000-00000000000a', 'first_connection');

select is(
  (select state from mailbox_sync_runs where id = 'ed000000-0000-4000-8000-00000000000a'),
  'running',
  'a new pass is running');

-- A second pass while one is going is refused by the database.
select throws_ok(
  $$insert into mailbox_sync_runs (organization_id, mailbox_id, trigger)
    values ('10000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', 'person')$$,
  '23505',
  null,
  'a mailbox cannot have two passes running at once');

-- A failure has to say why.
select throws_ok(
  $$update mailbox_sync_runs set state = 'failed', finished_at = now()
    where id = 'ed000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a failed pass with no reason is refused');

-- And a finished one has to say when.
select throws_ok(
  $$update mailbox_sync_runs set state = 'succeeded'
    where id = 'ed000000-0000-4000-8000-00000000000a'$$,
  '23514',
  null,
  'a finished pass with no finishing time is refused');

update mailbox_sync_runs
   set state = 'failed', finished_at = now(), messages_saved = 40,
       error = 'Google asked us to slow down. Nothing more was read this time.'
 where id = 'ed000000-0000-4000-8000-00000000000a';
select is(
  (select messages_saved from mailbox_sync_runs where id = 'ed000000-0000-4000-8000-00000000000a'),
  40,
  'a failed pass keeps the count of what it had already saved');

-- With that one finished, another may start: the index only forbids two running.
insert into mailbox_sync_runs (organization_id, mailbox_id, trigger)
values ('10000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', 'person');
select is(
  (select count(*)::int from mailbox_sync_runs where mailbox_id = 'ea000000-0000-4000-8000-00000000000a'),
  2,
  'and a retry is allowed once the first has stopped');

-- ---------------------------------------------------------------------------------------------
-- Another brokerage.

reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from mailbox_sync_runs),
  0,
  'another brokerage sees none of that reading history');
select is(
  (select count(*)::int from mailboxes),
  0,
  'nor the mailbox it belongs to');

select * from finish();
rollback;
