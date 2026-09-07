-- 0013 — Worker role
-- The Supabase service_role bypasses RLS entirely, which would make app.worker_org() decorative.
-- Workers get their own role instead.
--
-- The role is created with NOLOGIN and no password so that no credential appears in git and
-- the migration is re-runnable (roles are cluster-wide and survive `supabase db reset`).
-- Each environment then runs `pnpm db:worker-password`, which executes
--   alter role asap_worker with login password '<WORKER_DB_PASSWORD>';
-- See docs/DECISIONS.md D-006.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'asap_worker') then
    create role asap_worker nologin noinherit;
  end if;
end
$$;

-- Critically: no bypassrls. RLS applies, and app.worker_org() decides what it sees.
alter role asap_worker nobypassrls noinherit;

grant usage on schema public, app to asap_worker;
grant select, insert, update, delete on all tables in schema public to asap_worker;
grant usage, select on all sequences in schema public to asap_worker;
grant execute on all functions in schema app to asap_worker;

alter default privileges in schema public
  grant select, insert, update, delete on tables to asap_worker;
alter default privileges in schema public
  grant usage, select on sequences to asap_worker;

-- audit_log is insert-only for every application role, workers included.
revoke update, delete, truncate on audit_log from asap_worker;

-- Workers read the global permission catalogue.
create policy permissions_read_worker on permissions
  for select to asap_worker using (true);

-- No role-level default for app.organization_id: hosted Supabase does not allow a role-level
-- custom GUC default without superuser (D-033), and none is needed — app.worker_org() reads the
-- setting with missing_ok = true and returns null when it is unset, which every policy treats
-- as "no access".
