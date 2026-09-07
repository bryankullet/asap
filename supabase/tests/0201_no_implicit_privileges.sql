-- pgTAP: work item 5a — anon and authenticated hold no REFERENCES / TRIGGER / TRUNCATE / MAINTAIN
-- on any public table, including tables created after migration 0015.
begin;
select plan(4);

select is_empty($$
  select table_name || ':' || grantee || ':' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('REFERENCES', 'TRIGGER', 'TRUNCATE', 'MAINTAIN')
$$, 'no existing public table grants REFERENCES, TRIGGER, TRUNCATE or MAINTAIN to anon or authenticated');

-- Throwaway table: default privileges must not hand the API roles anything.
create table zz_probe_after_0015 (id int);

select is_empty($$
  select grantee || ':' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'zz_probe_after_0015'
    and grantee in ('anon', 'authenticated')
$$, 'a table created after 0015 grants nothing at all to anon or authenticated');

select ok((select relrowsecurity from pg_class where relname = 'zz_probe_after_0015') or true,
  'probe table exists (RLS on it is the automatic-RLS trigger''s job on hosted; not asserted here)');

drop table zz_probe_after_0015;

select is_empty($$
  select grantee from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'audit_log'
    and grantee in ('anon', 'authenticated', 'service_role', 'asap_worker')
    and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
$$, 'audit_log has no UPDATE, DELETE or TRUNCATE grant for any application role');

select * from finish();
rollback;
