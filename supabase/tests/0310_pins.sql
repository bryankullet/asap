-- pgTAP: pins (0033).
--
-- A pin is one person's marker on one record. Protected twice, like a conversation: by the
-- brokerage, and by the person. A colleague shares the work — that is in work_items, where
-- everyone in the brokerage sees it — but not what someone chose to keep.
begin;
select plan(9);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'work_item_pins', 'work_item_pins exists');
select ok((select relrowsecurity from pg_class where oid = 'public.work_item_pins'::regclass),
  'row level security is enabled');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'work_item_pins' and roles::text[] @> array['anon']),
  0,
  'no policy applies to anon');
-- Every policy carries both scopes. One without the other is the bug this asserts against.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'work_item_pins'
     and (coalesce(qual,'') || coalesce(with_check,'')) like '%can_access%'
     and (coalesce(qual,'') || coalesce(with_check,'')) like '%user_id%'),
  4,
  'all four policies carry both the brokerage scope and the personal scope');

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
insert into work_item_pins (organization_id, work_item_id, user_id)
values ('10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000002',
        'a0000000-0000-4000-8000-000000000002');
select is((select count(*)::int from work_item_pins), 1, 'Brian reads his own pin');
-- Pinning twice is the same pin, at the database as well as in the route.
select throws_ok(
  $$insert into work_item_pins (organization_id, work_item_id, user_id)
    values ('10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000002',
            'a0000000-0000-4000-8000-000000000002')$$,
  '23505', null, 'the same person cannot pin the same record twice');
-- A pin cannot claim a brokerage the record is not in.
select throws_ok(
  $$insert into work_item_pins (organization_id, work_item_id, user_id)
    values ('10000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-000000000002',
            'a0000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a pin cannot point at a record outside the brokerage it names');
reset role;

select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from work_item_pins), 0,
  'a colleague in the same brokerage does not read his pins');
reset role;

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from work_item_pins), 0, 'another brokerage reads none');
reset role;

select * from finish();
rollback;
