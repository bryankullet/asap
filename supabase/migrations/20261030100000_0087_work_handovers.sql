-- 0087 — Structured handovers of a Work item between colleagues (D-166).
--
-- A handover is the record of responsibility moving from one person to another: what is done, what
-- is still open, and what the next person must watch. The owner changes in the same transaction
-- through the same rules as work_item_manage (0061): job/edit, an active member as the new owner,
-- the version the caller saw, never on done work. The receiver acknowledges it ("I have it"), and
-- until then the workspace shows it to them first. A handover is collaboration, not status: it
-- never changes what the work is waiting on, and no model writes one.

create table work_handovers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  work_item_id    uuid not null references work_items(id),
  from_user_id    uuid not null references users(id),
  to_user_id      uuid not null references users(id),
  done_text       text not null check (length(btrim(done_text)) between 1 and 2000),
  open_text       text not null check (length(btrim(open_text)) between 1 and 2000),
  watch_text      text check (watch_text is null or length(watch_text) <= 2000),
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  check (from_user_id <> to_user_id)
);
create index work_handovers_work_item_idx on work_handovers (work_item_id, created_at desc);
create index work_handovers_organization_id_idx on work_handovers (organization_id);
create index work_handovers_from_user_id_idx on work_handovers (from_user_id);
create index work_handovers_to_user_id_idx on work_handovers (to_user_id);
comment on table work_handovers is 'Responsibility for a Work item moving between colleagues, with what is done, open and to watch (D-166).';

alter table work_handovers enable row level security;
-- Every member who can see the work can read how it changed hands; writes only through the functions.
create policy tenant_select on work_handovers for select to authenticated
  using (app.can_access(organization_id));
grant select on work_handovers to authenticated;
revoke all on work_handovers from anon;

create or replace function public.work_item_hand_over(
  p_work_item_id uuid, p_expected_version integer, p_to_user uuid,
  p_done text, p_open text, p_watch text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  w work_items;
  v_id uuid;
begin
  select * into w from work_items where id = p_work_item_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if app.current_membership(w.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.has_permission(w.organization_id, 'job', 'edit') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if w.task_status = 'done' then raise exception 'work_item_done' using errcode = '23514'; end if;
  if p_to_user is null or p_to_user = v_user then raise exception 'handover_to_self' using errcode = '23514'; end if;
  if not exists (select 1 from organization_memberships m
                  where m.organization_id = w.organization_id and m.user_id = p_to_user and m.status = 'active') then
    raise exception 'owner_not_member' using errcode = '23514';
  end if;
  if coalesce(length(btrim(p_done)), 0) = 0 or coalesce(length(btrim(p_open)), 0) = 0 then
    raise exception 'handover_incomplete' using errcode = '23514';
  end if;
  if w.version <> p_expected_version then raise exception 'version_stale'; end if;

  insert into work_handovers (organization_id, work_item_id, from_user_id, to_user_id, done_text, open_text, watch_text)
  values (w.organization_id, w.id, v_user, p_to_user, btrim(p_done), btrim(p_open), nullif(btrim(coalesce(p_watch, '')), ''))
  returning id into v_id;
  update work_items set owner_id = p_to_user, version = version + 1, updated_at = now() where id = w.id;
  perform app.engine_audit(w.organization_id, v_user, 'work_item.handed_over', 'work_item', w.id,
    jsonb_build_object('owner_id', w.owner_id),
    jsonb_build_object('owner_id', p_to_user, 'handover_id', v_id));
  return jsonb_build_object('id', v_id, 'workItemId', w.id, 'version', w.version + 1);
end $$;
revoke all on function public.work_item_hand_over(uuid, integer, uuid, text, text, text) from public, anon;
grant execute on function public.work_item_hand_over(uuid, integer, uuid, text, text, text) to authenticated;

-- Only the person it was handed to acknowledges it. Acknowledging twice changes nothing.
create or replace function public.work_handover_acknowledge(p_handover_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app.require_api_caller();
  h work_handovers;
begin
  select * into h from work_handovers where id = p_handover_id for update;
  if not found or app.current_membership(h.organization_id) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.to_user_id <> v_user then raise exception 'permission_denied' using errcode = '42501'; end if;
  if h.acknowledged_at is not null then return jsonb_build_object('id', h.id, 'changed', false); end if;
  update work_handovers set acknowledged_at = now() where id = h.id;
  perform app.engine_audit(h.organization_id, v_user, 'work_item.handover_acknowledged', 'work_item', h.work_item_id,
    null, jsonb_build_object('handover_id', h.id));
  return jsonb_build_object('id', h.id, 'changed', true);
end $$;
revoke all on function public.work_handover_acknowledge(uuid) from public, anon;
grant execute on function public.work_handover_acknowledge(uuid) to authenticated;
