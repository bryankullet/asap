-- pgTAP: every SECURITY DEFINER function in public either invokes the API key gate
-- (app.require_api_caller, D-042) or is on the allowlist below with a one-line reason. A new
-- SECURITY DEFINER function that does neither fails this suite. Reviewers: the allowlist is the
-- whole list of functions signed-in users cannot reach the engine through, and why.
begin;
select plan(3);

create temp table sd_allowlist (proname text primary key, reason text not null);
insert into sd_allowlist values
  ('api_key_register', 'service_role only: the API registers its own key hash on boot (0025, D-047); no user session exists yet'),
  ('runs_recover',     'service_role only: run recovery on boot ends runs from a dead process (0024, D-045); no user session exists yet'),
  ('work_item_step_by_run', 'service_role only: a workflow run completes ASAP''s own Work step, or a send step on a delivered message (0069, D-143); checked against the run, never a session'),
  ('claim_set_cover_review_by_run', 'service_role only: the claim run records its cover-on-the-incident-date sentence (0069, D-143); checked against the run'),
  ('inbound_open_draft', 'service_role only: the inbound router opens a draft claim or endorsement from a sorted email (0075, D-151); checked against the proposal'),
  ('rls_auto_enable',  'event trigger from 0017: enables RLS on any new table; not callable through the API (0203 proves anon/authenticated cannot execute it)');

-- Every allowlisted function exists and is not executable by authenticated or anon.
select is_empty($$
  select a.proname from sd_allowlist a
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = a.proname and p.prosecdef)
$$, 'every allowlisted function exists in public as SECURITY DEFINER (a stale allowlist entry fails)');

select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  join sd_allowlist a on a.proname = p.proname
  where n.nspname = 'public' and p.prosecdef
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'no allowlisted function is executable by authenticated or anon');

-- The inventory: gated or allowlisted, nothing else.
select is_empty($$
  select p.proname || ' (SECURITY DEFINER in public, neither gated by app.require_api_caller nor allowlisted)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and position('app.require_api_caller()' in p.prosrc) = 0
    and not exists (select 1 from sd_allowlist a where a.proname = p.proname)
$$, 'every SECURITY DEFINER function in public invokes the API key gate or is allowlisted with a reason');

select * from finish();
rollback;
