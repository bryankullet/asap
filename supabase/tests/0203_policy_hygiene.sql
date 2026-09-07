-- pgTAP: work item 5b/5c/5d/5e/5f — advisor-driven hygiene, asserted so it cannot regress.
begin;
select * from no_plan();

-- 5b: helper functions pin search_path
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'worker_org'
            and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  'app.worker_org has search_path pinned');
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'can_access'
            and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  'app.can_access has search_path pinned');

-- 5c: rls_auto_enable not executable by the API roles
select ok(not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'),
  'anon cannot execute public.rls_auto_enable');
select ok(not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'),
  'authenticated cannot execute public.rls_auto_enable');

-- 5d: exactly one permissive SELECT policy per public table and role (the advisor counts per role;
-- permissions has one for authenticated and one for asap_worker, which is fine)
select is_empty($$
  select tablename || '/' || r || ' has ' || count(*) || ' permissive SELECT policies'
  from pg_policies, unnest(roles) as r
  where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')
  group by tablename, r
  having count(*) <> 1
$$, 'every public table has exactly one permissive SELECT policy per role');

select is_empty($$
  select tablename || '.' || policyname from pg_policies
  where schemaname = 'public' and policyname like 'tenant_%' and cmd = 'ALL'
$$, 'no tenant_* policy is FOR ALL');

-- 5e: users policies use (select auth.uid())
select ok((select qual like '%(SELECT auth.uid()%' or qual like '%( SELECT auth.uid()%'
           from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'user_self'),
  'user_self evaluates auth.uid() as an initplan');
select ok((select with_check like '%SELECT auth.uid()%'
           from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'user_update_self'),
  'user_update_self evaluates auth.uid() as an initplan');

-- 5f: every foreign key has a covering index
select is_empty($$
  select conrelid::regclass || '.' || conname
  from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey
    )
$$, 'every public foreign key has a covering index');

-- 5g: every policy on public tables (and the storage bucket) is scoped away from anon
select is_empty($$
  select schemaname || '.' || tablename || '.' || policyname
  from pg_policies
  where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
    and ('anon' = any(roles) or 'public' = any(roles) or '{public}' = roles::text)
$$, 'no policy applies to anon or PUBLIC');

select * from finish();
rollback;
