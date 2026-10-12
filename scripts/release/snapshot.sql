-- Release audit (D-169): one row per table in public and app — its row count and a fingerprint of
-- its full contents, so a migration that loses, changes or invalidates an existing row is visible.
do $$
declare r record; n bigint; h text;
begin
  create temp table if not exists release_snapshot (tbl text primary key, n bigint, fingerprint text);
  truncate release_snapshot;
  for r in select schemaname, tablename from pg_tables where schemaname in ('public', 'app') order by 1, 2 loop
    execute format('select count(*), coalesce(md5(string_agg(md5(t::text), '''' order by md5(t::text))), ''empty'') from %I.%I t', r.schemaname, r.tablename) into n, h;
    insert into release_snapshot values (r.schemaname || '.' || r.tablename, n, h);
  end loop;
end $$;
select tbl, n, fingerprint from release_snapshot order by tbl;
