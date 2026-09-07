-- 0018 — Work item 5d: one permissive SELECT policy per table
--
-- `tenant_write … for all` also matched SELECT, so every tenant table evaluated two permissive
-- SELECT policies (advisor: multiple_permissive_policies). Replace it with insert / update /
-- delete policies; `tenant_read` is now the only SELECT policy on these tables.
do $$
declare t text;
begin
  foreach t in array array['roles','organization_memberships','teams','invitations','events'] loop
    execute format('drop policy if exists tenant_write on %I', t);
    execute format($p$create policy tenant_insert on %I for insert
                     with check (app.can_access(organization_id))$p$, t);
    execute format($p$create policy tenant_update on %I for update
                     using (app.can_access(organization_id))
                     with check (app.can_access(organization_id))$p$, t);
    execute format($p$create policy tenant_delete on %I for delete
                     using (app.can_access(organization_id))$p$, t);
  end loop;
end
$$;
