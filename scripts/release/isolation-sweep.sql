-- Release audit (D-169): on a populated database, every person sees no row of a brokerage they do
-- not belong to, in any table that carries organization_id. Prints one line per leak; none expected.
create temp table release_leaks (who uuid, tbl text, foreign_rows bigint);
grant insert on release_leaks to authenticated;
do $$
declare u uuid; r record; n bigint;
begin
  foreach u in array array['a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001']::uuid[] loop
    for r in select c.table_name from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
             where c.table_schema = 'public' and c.column_name = 'organization_id' order by 1 loop
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        execute format('select count(*) from public.%I where organization_id not in (select organization_id from public.organization_memberships where user_id = %L and status = ''active'')', r.table_name, u) into n;
      exception when insufficient_privilege then n := 0;  -- no grant at all: nothing visible
      end;
      reset role;
      if n > 0 then insert into release_leaks values (u, r.table_name, n); end if;
    end loop;
  end loop;
end $$;
select count(*) as tables_checked from information_schema.columns where table_schema = 'public' and column_name = 'organization_id';
select * from release_leaks;
