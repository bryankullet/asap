-- pgTAP: 0087 (D-166) — structured handovers. The owner changes with the handover in one step, under
-- job/edit, to an active member, at the version the caller saw; only the receiver acknowledges; and
-- another brokerage can neither read nor write one.
begin;
select plan(13);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-handover-key-0123456789abc"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label) values (encode(extensions.digest('pgtap-handover-key-0123456789abc', 'sha256'), 'hex'), 'pgtap-handover');

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
create temp table t_wi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'claim', 'Handover test claim', 'Jane Wanjiku',
  '[{"id":"capture","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000b', null, null) ->> 'id')::uuid as id;
reset role;
grant select on t_wi to authenticated;
create temp table t_v as select version as v from work_items where id = (select id from t_wi);
grant select on t_v to authenticated;

-- Refusals first: nothing changes.
select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select throws_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v), 'a0000000-0000-4000-8000-000000000001', 'done', 'open', null)$$, '42501', 'permission_denied', 'read-only cannot hand work over');
select is((select count(*)::int from work_handovers where work_item_id = (select id from t_wi)), 0, 'read-only sees no handover yet');
reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select throws_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v), 'b0000000-0000-4000-8000-000000000001', 'done', 'open', null)$$, 'P0002', 'not_found', 'another brokerage cannot find the work');
reset role;
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select throws_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v), 'a0000000-0000-4000-8000-000000000002', 'done', 'open', null)$$, '23514', 'handover_to_self', 'nobody hands work to themselves');
select throws_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v), 'b0000000-0000-4000-8000-000000000001', 'done', 'open', null)$$, '23514', 'owner_not_member', 'work goes only to a member of this brokerage');
select throws_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v), 'a0000000-0000-4000-8000-000000000001', '  ', 'open', null)$$, '23514', 'handover_incomplete', 'a handover says what is done');
select throws_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v) - 1, 'a0000000-0000-4000-8000-000000000001', 'done', 'open', null)$$, 'version_stale', 'a stale version is refused');

-- The handover and the owner change happen together.
select lives_ok($$select work_item_hand_over((select id from t_wi), (select v from t_v), 'a0000000-0000-4000-8000-000000000001', 'Notified CIC', 'Police abstract outstanding', 'Client is anxious')$$, 'an account executive hands the claim to a colleague');
reset role;
select is((select owner_id from work_items where id = (select id from t_wi)), 'a0000000-0000-4000-8000-000000000001'::uuid, 'the new owner holds the work');
select is((select count(*)::int from audit_log where object_id = (select id from t_wi) and action = 'work_item.handed_over'), 1, 'the handover is audited');

-- Only the receiver acknowledges; another brokerage cannot read it.
select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select throws_ok($$select work_handover_acknowledge((select id from work_handovers where work_item_id = (select id from t_wi)))$$, '42501', 'permission_denied', 'someone else cannot acknowledge it');
reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from work_handovers), 0, 'another brokerage reads no handovers');
reset role;
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is((work_handover_acknowledge((select id from work_handovers where work_item_id = (select id from t_wi))) ->> 'changed')::boolean, true, 'the receiver acknowledges it');
reset role;
select * from finish();
rollback;
