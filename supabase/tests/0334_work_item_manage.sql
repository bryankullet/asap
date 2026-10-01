-- pgTAP: managing a Work item — owner, due date, next check (0061).
--
--   * needs the server key; a browser session cannot call it;
--   * a read-only member is refused; another brokerage cannot reach the item;
--   * a non-member cannot be made owner; a past next check is refused;
--   * a stale version is refused; asking for what is already so changes nothing and writes no audit;
--   * each change is audited with before and after.
begin;
select plan(12);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0334-abcdef0123456789"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0334-abcdef0123456789', 'sha256'), 'hex'), 'pgtap-0334');
insert into work_items (id, organization_id, kind, title, task_status, owner_id)
values ('f3340000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'new_business', 'Manage me', 'needs_you',
        'a0000000-0000-4000-8000-000000000001');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok($$ select work_item_manage('f3340000-0000-4000-8000-00000000000a', 1, true, 'a0000000-0000-4000-8000-000000000002', false, null, false, null, null) $$,
  NULL, 'a browser session without the server key cannot manage Work');

select pg_temp.login('c0000000-0000-4000-8000-000000000001', true);
select throws_like($$ select work_item_manage('f3340000-0000-4000-8000-00000000000a', 1, true, 'a0000000-0000-4000-8000-000000000002', false, null, false, null, null) $$,
  '%permission_denied%', 'a read-only member is refused');

select pg_temp.login('b0000000-0000-4000-8000-000000000001', true);
select throws_like($$ select work_item_manage('f3340000-0000-4000-8000-00000000000a', 1, true, 'b0000000-0000-4000-8000-000000000001', false, null, false, null, null) $$,
  '%not_found%', 'another brokerage cannot reach the item');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select throws_like($$ select work_item_manage('f3340000-0000-4000-8000-00000000000a', 1, true, 'b0000000-0000-4000-8000-000000000001', false, null, false, null, null) $$,
  '%owner_not_member%', 'a member of another brokerage cannot own this work');
select throws_like($$ select work_item_manage('f3340000-0000-4000-8000-00000000000a', 1, false, null, false, null, true, now() - interval '1 day', null) $$,
  '%next_check_in_past%', 'a next check in the past is refused');
select throws_like($$ select work_item_manage('f3340000-0000-4000-8000-00000000000a', 99, true, 'a0000000-0000-4000-8000-000000000002', false, null, false, null, null) $$,
  '%version_stale%', 'a stale version is refused');
select is((select (work_item_manage('f3340000-0000-4000-8000-00000000000a', 99, true, 'a0000000-0000-4000-8000-000000000001', false, null, false, null, null))->>'changed'),
  'false', 'asking for the current owner changes nothing, whatever version was seen');
select is((select (work_item_manage('f3340000-0000-4000-8000-00000000000a', 1, true, 'a0000000-0000-4000-8000-000000000002', false, null, false, null, 'Kamau covers this'))->>'changed'),
  'true', 'the owner changes under the current version');
select is((select (work_item_manage('f3340000-0000-4000-8000-00000000000a', 2, false, null, true, '2026-10-15', false, null, null))->>'version'),
  '3', 'the due date changes and the version moves on');

reset role;
select is((select owner_id::text || ' ' || due_on::text from work_items where id = 'f3340000-0000-4000-8000-00000000000a'),
  'a0000000-0000-4000-8000-000000000002 2026-10-15', 'both changes are stored');
select is((select count(*)::int from audit_log where object_id = 'f3340000-0000-4000-8000-00000000000a' and action in ('work_item.assigned', 'work_item.due_changed')),
  2, 'one audit row per real change, none for the no-op');
select is((select previous_state->>'owner_id' from audit_log where object_id = 'f3340000-0000-4000-8000-00000000000a' and action = 'work_item.assigned'),
  'a0000000-0000-4000-8000-000000000001', 'the audit keeps who owned it before');

select * from finish();
rollback;
