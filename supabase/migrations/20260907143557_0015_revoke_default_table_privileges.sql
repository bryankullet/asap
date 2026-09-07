-- 0015 — Work item 5a: no implicit table privileges for the API roles
--
-- Hosted Supabase's default privileges for the `postgres` role (which creates every ASAP table)
-- still grant REFERENCES, TRIGGER, TRUNCATE and MAINTAIN on new public tables to anon and
-- authenticated even with "automatically expose new tables" off. RLS does not stop TRUNCATE.
-- From here on a new table carries no privilege for either role until a migration grants it
-- explicitly (the 0014 allowlist pattern).

alter default privileges in schema public revoke all on tables from anon, authenticated;

revoke references, trigger, truncate on all tables in schema public from anon, authenticated;

-- PG17 MAINTAIN privilege is part of the default grant too; revoke it where the server knows it.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end
$$;
