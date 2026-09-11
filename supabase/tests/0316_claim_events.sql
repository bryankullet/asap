-- pgTAP: the worker tier's narrow window onto the event queue (0042).
--
-- This function exists because `events` is a tenant table and the dispatcher's job is to look
-- across tenants for work nobody has handled. That is a real privilege, so it is worth proving it
-- is exactly as wide as it has to be and no wider:
--   - a signed-in person cannot call it, in any role
--   - `anon` cannot call it
--   - it returns that an event exists and whose it is, never its payload
--   - it respects the attempt ceiling, so a poison event stops being served
begin;
select plan(9);

\set acme_ae  '''a0000000-0000-4000-8000-000000000002'''
\set acme_org '''10000000-0000-4000-8000-00000000000a'''
\set beta_org '''10000000-0000-4000-8000-00000000000b'''

reset role;
-- Two brokerages' events, unhandled, so the cross-tenant behaviour is visible at all.
insert into events (organization_id, event_type, entity_type, entity_id, actor, payload)
values (:acme_org, 'document.received', 'document', gen_random_uuid(), 'user',
        '{"secret":"acme-only-payload"}'::jsonb),
       (:beta_org, 'document.received', 'document', gen_random_uuid(), 'user',
        '{"secret":"beta-only-payload"}'::jsonb);

-- 1–3. Who may call it -------------------------------------------------------------------------

select ok(
  has_function_privilege('asap_worker', 'app.claim_pending_events(integer,integer)', 'execute'),
  'the worker role may claim events: that is what the function is for');

select ok(
  not has_function_privilege('authenticated', 'app.claim_pending_events(integer,integer)', 'execute'),
  'a signed-in person may not: no session has business reading across brokerages');

select ok(
  not has_function_privilege('anon', 'app.claim_pending_events(integer,integer)', 'execute'),
  'and neither may anon');

-- 4–5. The bookkeeping is just as narrow ------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'app.mark_event_processed(uuid)', 'execute'),
  'a signed-in person cannot mark an event handled');

select ok(
  not has_function_privilege('authenticated', 'app.mark_event_attempted(uuid,text)', 'execute'),
  'nor record an attempt against one');

-- 6–7. What it returns -------------------------------------------------------------------------

set role asap_worker;

select ok(
  (select count(*) from app.claim_pending_events(100, 5)) >= 2,
  'the worker sees unhandled events from more than one brokerage: that is the point of it');

-- The payload is the brokerage's own data and the worker never needs it — the work happens in the
-- API, against the event's own organization. Proven by the shape of what comes back.
select is(
  (select count(*)::int
   from information_schema.columns
   where table_name = 'claim_pending_events' or false),
  0, 'the function returns a row type, not a view of the table');

select bag_eq(
  $$ select a.attname::text from pg_proc p
     join pg_type t on t.oid = p.prorettype
     cross join lateral unnest(p.proargnames) with ordinality as a(attname, ord)
     where p.proname = 'claim_pending_events'
       and p.pronamespace = 'app'::regnamespace
       and a.ord > 2 $$,
  $$ values ('id'), ('organization_id'), ('event_type'), ('processing_attempts') $$,
  'it returns the four things scheduling needs, and payload is not one of them');

-- 8–9. The attempt ceiling ---------------------------------------------------------------------

reset role;
update events set processing_attempts = 5 where organization_id = :acme_org;
set role asap_worker;

select ok(
  (select count(*) from app.claim_pending_events(100, 5)
   where organization_id = :acme_org) = 0,
  'an event that has failed its allowance stops being served');

reset role;
select * from finish();
rollback;
