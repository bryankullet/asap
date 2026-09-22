-- pgTAP: first-use onboarding (0046).
--
-- What these prove:
--
--   * a person sees their own progress and nobody else's — not another brokerage's, and not a
--     colleague's in their own;
--   * one row per person per brokerage, so finishing twice finishes once;
--   * the step and the recorded choices are bounded values rather than free text.
begin;
select plan(13);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'user_onboarding', 'user_onboarding exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.user_onboarding'::regclass),
  true,
  'row level security is enabled');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'user_onboarding' and roles::text[] @> array['anon']),
  0,
  'no policy applies to anon');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'user_onboarding' and cmd = 'DELETE'),
  0,
  'nothing deletes progress; finishing is a timestamp, not a disappearance');
select col_is_unique('public', 'user_onboarding', array['organization_id','user_id'],
  'one row per person per brokerage');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into user_onboarding (organization_id, user_id, step)
values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 2);

select is(
  (select step from user_onboarding where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2,
  'a person can record where they got to');

-- A second start is refused, which is what makes a double-clicked Finish finish once.
select throws_ok(
  $$insert into user_onboarding (organization_id, user_id)
    values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001')$$,
  '23505',
  null,
  'the same person cannot start twice in the same brokerage');

select throws_ok(
  $$update user_onboarding set step = 9
    where user_id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'there is no step 9 to be parked on');

select throws_ok(
  $$update user_onboarding set records_choice = 'maybe later'
    where user_id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a recorded choice is one of the choices');

update user_onboarding set records_choice = 'skip', mailbox_choice = 'skip', completed_at = now()
 where user_id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select records_choice from user_onboarding where user_id = 'a0000000-0000-4000-8000-000000000001'),
  'skip',
  'a skip is stored as an answer');

-- ---------------------------------------------------------------------------------------------
-- Somebody else, in the same brokerage and in another.

reset role;
select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from user_onboarding),
  0,
  'a colleague in the same brokerage does not see that person''s progress');

reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from user_onboarding),
  0,
  'and neither does another brokerage');

-- Aimed straight at it, from the wrong brokerage: it changes nothing rather than failing loudly.
update user_onboarding set step = 1
 where user_id = 'a0000000-0000-4000-8000-000000000001';
reset role;
select is(
  (select step from user_onboarding where user_id = 'a0000000-0000-4000-8000-000000000001'),
  2,
  'nor can another brokerage move it');

select * from finish();
rollback;
