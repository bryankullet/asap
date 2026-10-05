-- 0074 — The engine reads one brokerage through RLS (D-149).
--
-- The declared Ask tools rely on RLS for tenancy. A person's session gives it; the engine's service
-- connection bypasses it. So the engine gets its own connection for reading: a short-lived token,
-- signed by the API with the project's JWT secret, for the worker role (which never bypasses RLS)
-- and naming one organization. app.worker_org() — already the worker's tenancy, set by the Node
-- workers with set_config — now also reads that claim, but only when the role really is the worker:
-- a person cannot make a token for it, because only the server holds the secret. And only in a
-- read-only transaction: the token reads, it never writes.

create or replace function app.worker_org()
returns uuid language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    nullif(current_setting('app.organization_id', true), ''),
    -- Only for reading: PostgREST runs a GET in a read-only transaction, so an engine token can
    -- never write through RLS, even though the worker role's grants would allow it.
    case when current_user = 'asap_worker' and current_setting('transaction_read_only', true) = 'on'
         then nullif(current_setting('request.jwt.claims', true), '')::json ->> 'organization_id' end
  )::uuid;
$$;

-- PostgREST may switch into the worker role for such a token. The role still bypasses nothing.
grant asap_worker to authenticator;
