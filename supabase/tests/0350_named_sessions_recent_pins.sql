-- pgTAP: named sessions, Recent and Pins (0078, D-155) — personal, per brokerage, never cross-tenant.
begin;
select plan(9);

select ok((select relrowsecurity from pg_class where relname = 'recent_items'), 'row level security is on for Recent');
select ok((select relrowsecurity from pg_class where relname = 'space_pins'), 'row level security is on for Pins');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public'
  and table_name in ('recent_items', 'space_pins') and grantee = 'anon' $$, 'a signed-out browser holds nothing on Recent or Pins');
select ok(exists(select 1 from pg_constraint where conname = 'recent_items_conversation_or_ref'), 'a Recent entry is a conversation or a surface, never both');

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- A conversation cannot be linked to another brokerage's Work item, whoever asks.
select throws_ok($$ insert into conversations (organization_id, created_by, title, scope_kind, work_item_id)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'Linked elsewhere', 'brokerage',
          (select id from work_items where organization_id = '10000000-0000-4000-8000-00000000000b' limit 1)) $$,
  '23514', 'work_item_not_in_brokerage', 'a link to another brokerage''s work is refused');

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select lives_ok($$ insert into recent_items (organization_id, user_id, ref_key, kind, ref, title)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 'ws=work', 'record', '{"ws":"work"}', 'Work') $$,
  'a member records what they opened in their own brokerage');
select throws_ok($$ insert into recent_items (organization_id, user_id, ref_key, kind, ref, title)
  values ('10000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002', 'ws=work', 'record', '{"ws":"work"}', 'Work') $$,
  '42501', null, 'nor in a brokerage they do not belong to');
select throws_ok($$ insert into space_pins (organization_id, user_id, ref_key, kind, ref, title)
  values ('10000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'ws=work', 'record', '{"ws":"work"}', 'Work') $$,
  '42501', null, 'nor on a colleague''s behalf');
reset role;
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is_empty($$ select 1 from recent_items where user_id = 'a0000000-0000-4000-8000-000000000002' $$, 'a colleague''s Recent is invisible');
reset role;
select * from finish();
rollback;
