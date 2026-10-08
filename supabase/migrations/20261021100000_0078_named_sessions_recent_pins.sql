-- 0078 — Named work sessions, Recent and Pins, kept on the server (D-155).
--
-- The adaptive shell reopens work through Recent, Search, Work, Home and Ask instead of a strip of
-- browser tabs, so what a person had open must survive a refresh, another device and a sign-in.
-- Nothing here is a business fact (§45 rule 14): a conversation's status is derived from the work it
-- is linked to at read time, a Recent entry's title is re-read from its record where there is one,
-- and deleting any of these rows loses a convenience, never a premium, a cover state or an approval.
--
--  - conversations gain what makes them a named session: how the title was made, what the request
--    was for, the Work item and Space it controls, and when anything last happened in it.
--  - recent_items: what this person opened, in this brokerage, newest first, once each.
--  - space_pins: what this person keeps at hand. Personal, like work_item_pins (0033), and like it
--    not a navigation destination and not a status.

alter table conversations
  add column title_source     text not null default 'question' check (title_source in ('question', 'derived', 'person')),
  add column purpose          text not null default 'question'
    check (purpose in ('renewal', 'quotation', 'comparison', 'claim', 'import', 'add_client', 'upload', 'investigate', 'question')),
  add column work_item_id     uuid references work_items(id) on delete set null,
  add column space_ref        jsonb check (space_ref is null or jsonb_typeof(space_ref) = 'object'),
  add column last_activity_at timestamptz not null default now();
create index conversations_work_item_id_idx on conversations (work_item_id);
create index conversations_person_activity_idx on conversations (organization_id, created_by, last_activity_at desc);

-- A linked Work item is in the same brokerage as the conversation, or the link is refused.
create or replace function app.conversation_link_in_tenant() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.work_item_id is not null and not exists (
    select 1 from work_items w where w.id = new.work_item_id and w.organization_id = new.organization_id) then
    raise exception 'work_item_not_in_brokerage' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.conversation_link_in_tenant() from public;
create trigger conversations_link_in_tenant before insert or update of work_item_id on conversations
  for each row execute function app.conversation_link_in_tenant();

-- A turn is activity: Recent and Search order sessions by when something last happened in them.
create or replace function app.touch_conversation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update conversations set updated_at = now(), last_activity_at = now() where id = new.conversation_id;
  return new;
end $$;
revoke all on function app.touch_conversation() from public;

create table recent_items (
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  -- The surface's stable key (packages/schema refKey), or "conversation:<id>".
  ref_key          text not null check (length(ref_key) between 1 and 320),
  kind             text not null check (kind in ('conversation', 'workflow', 'client', 'policy', 'claim', 'quotation', 'document', 'comparison', 'automation', 'record')),
  ref              jsonb check (ref is null or jsonb_typeof(ref) = 'object'),
  conversation_id  uuid references conversations(id) on delete cascade,
  -- The label at the time it was opened; re-read from the record on every listing where one exists.
  title            text not null check (length(btrim(title)) between 1 and 160),
  opened_at        timestamptz not null default now(),
  primary key (organization_id, user_id, ref_key),
  constraint recent_items_conversation_or_ref check ((conversation_id is null) <> (ref is null))
);
create index recent_items_person_idx on recent_items (organization_id, user_id, opened_at desc);
create index recent_items_user_id_idx on recent_items (user_id);
create index recent_items_conversation_id_idx on recent_items (conversation_id);
comment on table recent_items is 'What one person opened in one brokerage, newest first (D-155). A convenience, never a record.';

create table space_pins (
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  ref_key          text not null check (length(ref_key) between 1 and 320),
  kind             text not null check (kind in ('conversation', 'workflow', 'client', 'policy', 'claim', 'quotation', 'document', 'comparison', 'automation', 'record')),
  ref              jsonb check (ref is null or jsonb_typeof(ref) = 'object'),
  conversation_id  uuid references conversations(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 1 and 160),
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id, ref_key),
  constraint space_pins_conversation_or_ref check ((conversation_id is null) <> (ref is null))
);
create index space_pins_person_idx on space_pins (organization_id, user_id, created_at desc);
create index space_pins_user_id_idx on space_pins (user_id);
create index space_pins_conversation_id_idx on space_pins (conversation_id);
comment on table space_pins is 'A personal marker on a surface (D-155). Not shared, not a status, not a navigation destination.';

-- Tenant isolation and personal scope together, on every command, as for work_item_pins.
do $$
declare t text;
begin
  foreach t in array array['recent_items', 'space_pins'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy tenant_select on %I for select to authenticated
      using (app.can_access(organization_id) and user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy tenant_insert on %I for insert to authenticated
      with check (app.can_access(organization_id) and user_id = (select auth.uid())
        and (conversation_id is null or exists (select 1 from conversations c where c.id = conversation_id
             and c.organization_id = %I.organization_id and c.created_by = (select auth.uid())))) $p$, t, t);
    execute format($p$create policy tenant_update on %I for update to authenticated
      using (app.can_access(organization_id) and user_id = (select auth.uid()))
      with check (app.can_access(organization_id) and user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy tenant_delete on %I for delete to authenticated
      using (app.can_access(organization_id) and user_id = (select auth.uid()))$p$, t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;
