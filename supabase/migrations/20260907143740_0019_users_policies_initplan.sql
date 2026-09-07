-- 0019 — Work item 5e: evaluate auth.uid() once per query in the users policies
--
-- `(select auth.uid())` lets the planner treat the call as an InitPlan instead of re-evaluating
-- it per row (advisor: auth_rls_initplan). Semantics are unchanged.
drop policy if exists user_self on users;
drop policy if exists user_update_self on users;

create policy user_self on users
  for select using (
    id = (select auth.uid())
    or exists (
      select 1 from organization_memberships m
      where m.user_id = users.id
        and m.status = 'active'
        and m.organization_id in (select app.current_user_orgs())
    )
    or exists (
      select 1 from organization_memberships m
      where m.user_id = users.id
        and m.status = 'active'
        and m.organization_id = (select app.worker_org())
    )
  );

create policy user_update_self on users
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
