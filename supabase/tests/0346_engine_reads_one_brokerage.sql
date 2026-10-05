-- pgTAP: the engine's worker-role token reads one brokerage, and only reads (0074, D-149).
begin;
select plan(5);

select ok(pg_has_role('authenticator', 'asap_worker', 'member'), 'PostgREST may switch into the worker role');
select ok(not (select rolbypassrls from pg_roles where rolname = 'asap_worker'), 'the worker role never bypasses RLS');

-- A person with a forged organization claim gets nothing from it: the claim counts only for the worker role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000ff","organization_id":"10000000-0000-4000-8000-00000000000a"}', true);
select is(app.worker_org(), null, 'an organization claim means nothing to a person''s session');
reset role;

set local role asap_worker;
select set_config('request.jwt.claims', '{"role":"asap_worker","organization_id":"10000000-0000-4000-8000-00000000000a"}', true);
select is(app.worker_org(), null, 'in a read-write transaction the claim is not honoured: the token never writes');
set transaction read only;
select is(app.worker_org(), '10000000-0000-4000-8000-00000000000a'::uuid, 'in a read-only transaction it names the one brokerage it reads');
reset role;

select * from finish();
rollback;
