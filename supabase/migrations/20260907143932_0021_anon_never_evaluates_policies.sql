-- 0021 — Work item 5g: policies evaluate to false for anon, never throw
--
-- Finding (live verification, 7 September 2026): under the anon role a policy-protected query
-- failed with `42501 permission denied for function current_user_orgs` — denied, but as an error
-- rather than an empty result, because app.can_access (granted to anon in 0002) calls a function
-- anon may not execute.
--
-- Fix, in two parts:
--   1. anon loses EXECUTE on app.can_access and app.worker_org (and PUBLIC, which still held it).
--      Nothing anon may do needs them; invitation_preview is SECURITY DEFINER and stays granted.
--   2. Every policy is scoped `to authenticated, asap_worker`. For anon no policy applies, so RLS
--      yields zero rows without evaluating any expression. service_role and postgres bypass RLS.
-- Rule (supabase/tests/README.md): a policy must evaluate to false for anon, never raise.

revoke execute on function app.can_access(uuid) from public, anon;
revoke execute on function app.worker_org()    from public, anon;
grant  execute on function app.can_access(uuid), app.worker_org()
  to authenticated, service_role, asap_worker;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where (schemaname = 'public')
       or (schemaname = 'storage' and tablename = 'objects'
           and policyname in ('doc_read', 'doc_write', 'doc_delete'))
  loop
    -- permissions_read_worker is already worker-only; permissions_read already authenticated-only.
    if p.policyname = 'permissions_read_worker' then continue; end if;
    if p.policyname = 'permissions_read' then continue; end if;
    execute format('alter policy %I on %I.%I to authenticated, asap_worker',
                   p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;
