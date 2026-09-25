-- 0047 — Nothing but the service connection touches an authorisation state.
--
-- 0045 gave `mailbox_oauth_states` row level security and no policy on purpose: the callback that
-- consumes a state has no session, so the row is written and read by the API's service connection
-- alone, and making it tenant-readable would also make it listable by any signed-in person.
--
-- What 0045 missed is that 0013 set default privileges granting every new table in `public` to
-- `asap_worker`. So the worker role acquired select, insert, update and delete on it automatically.
-- Nothing actually leaks — `asap_worker` does not bypass row level security, and with no policy it
-- sees no rows and can write none — but the grant is a privilege nobody needs, sitting on the one
-- table in the schema whose contents are an authorisation secret. If a permissive policy were ever
-- added to that table, the grant would be waiting.
--
-- 0013 does exactly this for `audit_log`, for the same reason. This is that precedent applied to
-- the table that most deserves it.
--
-- Revoke only: no data is read, written or moved, and the table is untouched.

revoke all on public.mailbox_oauth_states from asap_worker;

-- anon and authenticated were never granted anything here (0015 revoked the defaults and 0045
-- granted nothing), but saying so explicitly means a future default-privilege change cannot
-- quietly hand this table to a browser role.
revoke all on public.mailbox_oauth_states from anon, authenticated;

comment on table public.mailbox_oauth_states is
  'Single-use, short-lived authorisation states. Service connection only: RLS on, no policy, no tenant grant.';
