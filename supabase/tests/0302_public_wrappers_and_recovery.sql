-- pgTAP: 0024 — public wrappers reach the app functions with the same grants; anon can reach
-- invitation_preview through public and nothing else in app; run recovery on boot.
begin;
select plan(14);

-- anon: exactly one public wrapper, nothing in app
select ok(has_function_privilege('anon', 'public.invitation_preview(text)', 'execute'), 'anon can execute public.invitation_preview');
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_organization','set_active_organization','create_invitation',
        'revoke_invitation','accept_invitation','update_membership','work_item_create','work_item_apply',
        'run_start','run_event_append','run_end','draft_create','draft_mark_copied','draft_record_send','runs_recover')
    and has_function_privilege('anon', p.oid, 'execute')
$$, 'anon can execute no other public function');
select is((
  select string_agg(p.proname::text, ',' order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')),
  'invitation_preview', 'in app, anon can execute invitation_preview and nothing else');
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_organization','set_active_organization','create_invitation',
        'revoke_invitation','invitation_preview','accept_invitation','update_membership') and p.prosecdef
$$, 'the seven wrappers are SECURITY INVOKER');

-- the wrapper behaves like the function
select set_config('role', 'anon', true);
select results_eq(
  $$select organization_name, status from public.invitation_preview(encode(extensions.digest('seed-fixture-pending-token-A', 'sha256'), 'hex'))$$,
  $$values ('Acme Insurance Brokers'::text, 'pending'::text)$$,
  'anon previews the pending Acme invitation through public');
select throws_ok($$select public.accept_invitation('x')$$, '42501', null, 'anon cannot accept through public');
reset role;

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap');

-- authenticated wrapper: set_active_organization works through public
select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select lives_ok($$select public.set_active_organization('10000000-0000-4000-8000-00000000000b')$$, 'the shared consultant switches to Beta through public');
select throws_ok($$select public.set_active_organization('00000000-0000-4000-8000-000000000000')$$, '42501', 'not_a_member', 'and cannot switch to a brokerage they are not in');
reset role;

-- recovery: a run started under boot A is still working when boot B starts
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
create temp table t_run as select run_start('30000000-0000-4000-8000-000000000002',
  (select version from work_items where id = '30000000-0000-4000-8000-000000000002'), 'Certificate extraction',
  (select steps from work_items where id = '30000000-0000-4000-8000-000000000002'), 'boot-A') as id;
select throws_ok($$select public.runs_recover('boot-B')$$, '42501', null, 'authenticated cannot run recovery');
reset role;
select is((select boot_token from runs where id = (select id from t_run)), 'boot-A', 'the run records the boot token that started it');
grant select on t_run to service_role;
set role service_role;
-- The seed's working run (no boot token) is an orphan from any process's point of view; boot A's own run is not.
select results_eq($$select * from public.runs_recover('boot-A')$$, $$values ('40000000-0000-4000-8000-000000000001'::uuid)$$,
  'the same boot recovers only runs that are not its own (the token-less seed run)');
select results_eq($$select * from public.runs_recover('boot-B')$$, $$select id from t_run$$, 'a new boot recovers boot A''s orphan');
reset role;
select is((select status from runs where id = (select id from t_run)), 'could_not_finish', 'the orphan could not finish');
select is((select task_status from work_items where id = '30000000-0000-4000-8000-000000000002'), 'needs_you', 'its work item needs a person, in the same call');

select * from finish();
rollback;
