-- 0017 — Work item 5c: Supabase's automatic-RLS event-trigger function must not be RPC-callable
--
-- public.rls_auto_enable() is created by the dashboard's "enable automatic RLS" setting. It is
-- SECURITY DEFINER, owned by postgres, and — like every function — executable by PUBLIC by
-- Postgres default, which makes it reachable at /rest/v1/rpc/rls_auto_enable. Revoking from
-- anon and authenticated alone changes nothing while PUBLIC still holds EXECUTE, so PUBLIC is
-- revoked as well. The event trigger keeps working: it runs as the function owner.
-- Guarded: the function does not exist on a local stack without that setting.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
