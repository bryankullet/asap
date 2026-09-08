-- pgTAP: UI Build Spec Phase 2 — the engine's database half (0023).
--  - writes are refused without the API key header (api_only), even for members
--  - asking twice reopens the same item (no_duplicate_open)
--  - a run that could not finish creates/updates a work item in needs_you in the same call,
--    including a run with no work item at all (the prototype's "missing-record" case)
--  - a draft cannot be marked sent without evidence, at the function and at the row
begin;
select plan(22);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- The same, with an explicit headers document (no header at all, or a wrong key).
create or replace function pg_temp.login_headers(p_user uuid, p_headers text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', p_headers, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap');

-- Grant layer: still SELECT only for authenticated
select pg_temp.login('a0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$update work_items set title = 'x' where id = '30000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'authenticated cannot update work_items directly even with the API key');
select throws_ok(
  $$insert into drafts (organization_id, work_item_id, step_id) values ('10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000002', 's')$$,
  '42501', null, 'authenticated cannot insert drafts directly');
reset role;

-- api_only
select pg_temp.login('a0000000-0000-4000-8000-000000000002', false);
select throws_ok(
  $$select work_item_create('10000000-0000-4000-8000-00000000000a', 'renewal', 'Acme Motors — 2027 renewal', 'Acme Motors', '[]', 'needs_you', null)$$,
  '42501', 'api_only', 'a member without the API key cannot create a work item');
reset role;

-- gate: no request.headers at all (a direct database session), and a wrong key
select pg_temp.login_headers('a0000000-0000-4000-8000-000000000002', '');
select throws_ok(
  $$select run_event_append('40000000-0000-4000-8000-000000000001', 'step', 'x')$$,
  '42501', 'api_only', 'no headers at all: refused');
reset role;
select pg_temp.login_headers('a0000000-0000-4000-8000-000000000002', '{"x-asap-api-key":"wrong-key-wrong-key-wrong-key-wrong"}');
select throws_ok(
  $$select run_event_append('40000000-0000-4000-8000-000000000001', 'step', 'x')$$,
  '42501', 'api_only', 'wrong key: refused');
select throws_ok(
  $$select draft_mark_copied('50000000-0000-4000-8000-000000000000')$$,
  '42501', 'api_only', 'wrong key is refused before existence is revealed');
reset role;

-- gate: a valid key on rows the acting user cannot access (Acme AE against Beta rows)
select pg_temp.login('a0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select work_item_apply('30000000-0000-4000-8000-00000000000b', 1, '[]', 'needs_you', null, null, null, null, null, null, null, 'x', '{}')$$,
  '42501', 'not_a_member', 'valid key, Beta item: work_item_apply refuses a non-member (the key widens no tenancy)');
select throws_ok(
  $$select run_event_append('40000000-0000-4000-8000-00000000000b', 'step', 'x')$$,
  '42501', 'not_a_member', 'valid key, Beta run: run_event_append refuses a non-member');
select is((select count(*) from run_events where run_id = '40000000-0000-4000-8000-00000000000b'), 0::bigint,
  'no event was written to the Beta run');
reset role;

-- no_duplicate_open
select pg_temp.login('a0000000-0000-4000-8000-000000000002', true);
select is((work_item_create('10000000-0000-4000-8000-00000000000a', 'renewal', 'Acme Motors — 2027 renewal', 'Acme Motors',
            '[{"id":"s1","label":"x","actor":"you","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
            'needs_you', null) ->> 'reopened')::boolean, false, 'first ask creates');
select is((work_item_create('10000000-0000-4000-8000-00000000000a', 'renewal', 'Acme Motors — 2027 renewal', 'Acme Motors',
            '[]', 'needs_you', null) ->> 'reopened')::boolean, true, 'asking twice reopens the same item');
select is((select count(*) from work_items where title = 'Acme Motors — 2027 renewal'), 1::bigint, 'exactly one open item exists');
select throws_ok(
  $$select work_item_create('10000000-0000-4000-8000-00000000000b', 'renewal', 'x', 'x', '[]', 'needs_you', null)$$,
  '42501', 'not_a_member', 'the API key does not widen tenancy: Acme user cannot create in Beta');

-- version_current: a stale version is refused
create temp table t_item as select id, version from work_items where title = 'Acme Motors — 2027 renewal';
select throws_ok(
  $$select work_item_apply((select id from t_item), 99, '[]', 'needs_you', null, null, null, null, null, null, null, 'x', '{}')$$,
  '40001', 'version_stale', 'work_item_apply refuses a stale version');

-- run that could not finish, on an existing item → needs_you in the same call
create temp table t_run as select run_start((select id from t_item), (select version from t_item), 'Renewal pack prepared',
  '[{"id":"s1","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]') as id;
select is((select task_status from work_items where id = (select id from t_item)), 'in_progress', 'a working run puts the item in progress');
select throws_ok(
  $$select run_end((select id from t_run), 'could_not_finish', 'Check this file',
     '[{"id":"s1","label":"x","actor":"asap","state":"blocked","guards":[],"evidence":[],"actions":[],"party":null,"reason":"could not read","recorded":[],"runId":null}]',
     'in_progress', null)$$,
  '22023', 'stopped_run_must_need_you', 'a stopped run cannot leave the item anywhere but needs_you');
select lives_ok(
  $$select run_end((select id from t_run), 'could_not_finish', 'Check this file',
     '[{"id":"s1","label":"x","actor":"asap","state":"blocked","guards":[],"evidence":[],"actions":[],"party":null,"reason":"could not read","recorded":[],"runId":null}]',
     'needs_you', null)$$,
  'run_end could_not_finish');
select is((select task_status from work_items where id = (select id from t_item)), 'needs_you', 'the item needs you after the run could not finish');
select is((select kind from run_events where run_id = (select id from t_run) order by seq desc limit 1), 'error', 'an error event was written in the same transaction');

-- the prototype's missing-record case: a run with no work item
reset role;
insert into runs (id, organization_id, work_item_id, title, status, started_by)
values ('40000000-0000-4000-8000-0000000000ff', '10000000-0000-4000-8000-00000000000a', null, 'Failed extraction', 'working', 'a0000000-0000-4000-8000-000000000002');
select pg_temp.login('a0000000-0000-4000-8000-000000000002', true);
select isnt(run_end('40000000-0000-4000-8000-0000000000ff', 'could_not_finish', 'Check this file', '[]', 'needs_you', null), null,
  'a stopped run with no work item creates one');
select is((select task_status from work_items where id = (select work_item_id from runs where id = '40000000-0000-4000-8000-0000000000ff')),
  'needs_you', 'the created item needs you');

-- drafts: no send without evidence
create temp table t_draft as select draft_create((select id from t_item), 's1', 'jubilee@example.test', 'Renewal terms', 'Please quote.') as id;
select throws_ok(
  $$select draft_record_send((select id from t_draft), '  ', false)$$,
  '22023', 'evidence_required', 'a send cannot be recorded without evidence');
reset role;

select * from finish();
rollback;
