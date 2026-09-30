-- 0061 — managing a Work item as a person: its owner, its due date and when it is looked at again.
--
-- Ask and the Work Space call one API action for these (D-122); this is its database half.
--   * due_on is a date a person commits to. It is not derived and never set by a model.
--   * work_item_manage changes owner, due date and next check together under the version the
--     caller saw, refuses a stale version, refuses an owner who is not an active member of the
--     brokerage, needs the job/edit permission, and audits each change with before and after.
--   * Asking for what is already true changes nothing and writes no audit row: a double-click or a
--     retry is harmless.

alter table work_items add column due_on date;

create or replace function public.work_item_manage(
  p_work_item_id uuid, p_expected_version integer,
  p_set_owner boolean, p_owner_id uuid,
  p_set_due boolean, p_due_on date,
  p_set_next_check boolean, p_next_check timestamptz,
  p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  w work_items;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  select * into w from work_items where id = p_work_item_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- Another brokerage's item does not exist, as far as this caller can tell.
  if app.current_membership(w.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(w.organization_id, 'job', 'edit') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if w.task_status = 'done' then raise exception 'work_item_done' using errcode = '23514'; end if;
  if p_set_owner and p_owner_id is not null and not exists (
       select 1 from organization_memberships m
        where m.organization_id = w.organization_id and m.user_id = p_owner_id and m.status = 'active') then
    raise exception 'owner_not_member' using errcode = '23514';
  end if;
  if p_set_next_check and p_next_check is not null and p_next_check < now() - interval '1 minute' then
    raise exception 'next_check_in_past' using errcode = '23514';
  end if;

  if p_set_owner and w.owner_id is distinct from p_owner_id then
    v_before := v_before || jsonb_build_object('owner_id', w.owner_id);
    v_after := v_after || jsonb_build_object('owner_id', p_owner_id);
  end if;
  if p_set_due and w.due_on is distinct from p_due_on then
    v_before := v_before || jsonb_build_object('due_on', w.due_on);
    v_after := v_after || jsonb_build_object('due_on', p_due_on);
  end if;
  if p_set_next_check and w.task_next_check is distinct from p_next_check then
    v_before := v_before || jsonb_build_object('task_next_check', w.task_next_check);
    v_after := v_after || jsonb_build_object('task_next_check', p_next_check);
  end if;

  -- Already so: nothing to write, whatever version the caller saw.
  if v_after = '{}'::jsonb then
    return jsonb_build_object('id', w.id, 'changed', false, 'version', w.version);
  end if;
  if w.version <> p_expected_version then raise exception 'version_stale'; end if;

  update work_items set
    owner_id = case when p_set_owner then p_owner_id else owner_id end,
    due_on = case when p_set_due then p_due_on else due_on end,
    task_next_check = case when p_set_next_check then p_next_check else task_next_check end,
    version = version + 1, updated_at = now()
   where id = w.id;
  perform app.engine_audit(w.organization_id, v_user,
    case when v_after ? 'owner_id' and (v_after - 'owner_id') = '{}'::jsonb then 'work_item.assigned'
         when v_after ? 'due_on' and (v_after - 'due_on') = '{}'::jsonb then 'work_item.due_changed'
         else 'work_item.managed' end,
    'work_item', w.id, v_before, v_after || jsonb_build_object('note', p_note));
  return jsonb_build_object('id', w.id, 'changed', true, 'version', w.version + 1, 'changes', v_after);
end $$;
revoke all on function public.work_item_manage(uuid, integer, boolean, uuid, boolean, date, boolean, timestamptz, text) from public, anon;
grant execute on function public.work_item_manage(uuid, integer, boolean, uuid, boolean, date, boolean, timestamptz, text) to authenticated;
