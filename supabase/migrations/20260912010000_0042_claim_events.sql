-- 0042 — letting the worker tier see that an event exists, and nothing more.
--
-- Found by running the dispatcher against a real database: it saw **nothing**. `events` is a
-- tenant table with RLS scoped to `app.worker_org()`, and the dispatcher's whole job is to look
-- across tenants for work nobody has handled — so outside an organization context it read zero
-- rows and would have sat there doing nothing, forever, without an error.
--
-- The wrong fixes are obvious and both bad: give the worker a service key (it is not supposed to
-- have one, and its own environment schema refuses one), or relax the policy (which would let the
-- worker read every brokerage's events for any reason at all).
--
-- This is the narrow one. A definer function that returns only what scheduling needs — that an
-- event exists, whose it is, what kind it is, and how often it has been tried. **It does not
-- return the payload**, which is the tenant's own data; the worker never needs it, because the
-- work itself happens in the API against the event's own organization.
--
-- Everything the worker does *after* claiming still runs under `withOrganization`, inside that
-- one brokerage's context, as the ordinary policies allow.

create or replace function app.claim_pending_events(p_limit integer, p_max_attempts integer)
returns table (
  id                  uuid,
  organization_id     uuid,
  event_type          text,
  processing_attempts integer)
language sql
security definer
set search_path = app, public, pg_temp
as $$
  select e.id, e.organization_id, e.event_type, e.processing_attempts
  from public.events e
  where e.processed_at is null
    and e.processing_attempts < p_max_attempts
  order by e.occurred_at asc
  limit greatest(1, least(p_limit, 200))
$$;

-- The worker role only. Not `authenticated`: a signed-in person has no business reading across
-- brokerages, and this function exists precisely because that boundary is otherwise absolute.
revoke all on function app.claim_pending_events(integer, integer) from public;
grant execute on function app.claim_pending_events(integer, integer) to asap_worker;

comment on function app.claim_pending_events(integer, integer) is
  'Scheduling only: that an event exists and whose it is. Never its payload. asap_worker only.';

-- The dispatcher's own bookkeeping, for the same reason.
--
-- Marking an event handled, or recording that a consumer failed on it, is a cross-tenant write in
-- the same sense: the worker holds the organization context when it does this, but the update
-- targets a row it found before that context existed. These two functions keep the write narrow
-- and say exactly what it may change — a worker cannot use them to alter an event's payload, its
-- type, or whose it is.
create or replace function app.mark_event_processed(p_event_id uuid)
returns void
language sql
security definer
set search_path = app, public, pg_temp
as $$
  update public.events set processed_at = now(), last_error = null where id = p_event_id;
$$;

create or replace function app.mark_event_attempted(p_event_id uuid, p_error text)
returns void
language sql
security definer
set search_path = app, public, pg_temp
as $$
  update public.events
     set processing_attempts = processing_attempts + 1,
         last_error = left(p_error, 500)
   where id = p_event_id;
$$;

revoke all on function app.mark_event_processed(uuid) from public;
revoke all on function app.mark_event_attempted(uuid, text) from public;
grant execute on function app.mark_event_processed(uuid) to asap_worker;
grant execute on function app.mark_event_attempted(uuid, text) to asap_worker;
