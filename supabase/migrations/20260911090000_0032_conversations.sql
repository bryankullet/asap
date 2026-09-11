-- 0032 — Ask ASAP conversations (Architecture §22 conversation memory, §33 context model)
--
-- Two tenant tables so a question and its answer survive the page, and so an answer can always be
-- checked against what it was grounded in.
--
-- §45 rule 14: **chat history is not the database.** Nothing here is a business fact. A message
-- stores what was asked, what was said, which declared tools ran, and the citations behind any
-- fact named — and every value a person sees is re-read from its own record by id at render time.
-- Deleting a conversation loses a transcript, never a premium, a cover state or an approval.
--
-- Scope is the context model: a conversation is about the brokerage, one client, or one record.
-- It is resolved server-side from ids the caller can already read; a model never sets it.
--
-- Writes are ordinary tenant writes under the caller's own session — unlike the work engine,
-- where D-042 routes every write through a hashed-key function. A conversation carries no
-- business outcome, so it needs no such gate; what it must not do is become a way to reach
-- anything else, which is why there is no foreign key from any business table back to here.

create table conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  created_by       uuid not null references users(id),
  title            text not null check (length(btrim(title)) > 0),
  -- brokerage-wide, one client, or one record. The chip a person sees names it.
  scope_kind       text not null check (scope_kind in ('brokerage','client','record')),
  scope_id         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint conversations_scope_id_matches_kind check (
    (scope_kind = 'brokerage' and scope_id is null) or (scope_kind <> 'brokerage' and scope_id is not null))
);
create index conversations_organization_id_updated_at_idx
  on conversations (organization_id, updated_at desc);
create index conversations_created_by_idx on conversations (created_by);
create index conversations_scope_idx on conversations (organization_id, scope_kind, scope_id);

create table conversation_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  seq              integer not null check (seq >= 1),
  role             text not null check (role in ('person','asap')),
  body             text not null,
  -- The validated UiIntent for an ASAP turn. Stored as it was validated, never as the model sent it.
  intent           jsonb,
  -- Which declared tools ran, and with what arguments. Never SQL; never a write.
  tools_used       jsonb not null default '[]'::jsonb,
  -- Where each named fact came from. An answer with no citation is an abstention, not a claim.
  citations        jsonb not null default '[]'::jsonb,
  -- Set when ASAP could not answer, with what was missing. Abstention is a state, not a blank.
  abstained        jsonb,
  -- Which provider and model served it, for the evaluation set and the audit trail.
  served_by        text,
  created_at       timestamptz not null default now(),
  constraint conversation_messages_conversation_id_seq_key unique (conversation_id, seq),
  -- A person's turn has no intent, no tools, no citations and no abstention: those are answers.
  constraint conversation_messages_person_turn_is_plain check (
    role <> 'person' or (intent is null and abstained is null
                         and tools_used = '[]'::jsonb and citations = '[]'::jsonb))
);
create index conversation_messages_conversation_id_seq_idx
  on conversation_messages (conversation_id, seq);
create index conversation_messages_organization_id_idx on conversation_messages (organization_id);

comment on table conversations is
  'Ask ASAP conversations. A transcript of asking, not a store of business facts (rule 14).';

alter table conversations enable row level security;
alter table conversation_messages enable row level security;

-- Tenant isolation, and one step further: a conversation is personal. A member of the brokerage
-- reads their own conversations only. The transcript of someone else's questions is not
-- brokerage work; the work it produced is, and that lives in work_items where everyone sees it.
create policy tenant_select on conversations
  for select to authenticated, asap_worker
  using (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_insert on conversations
  for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_update on conversations
  for update to authenticated, asap_worker
  using (app.can_access(organization_id) and created_by = (select auth.uid()))
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_delete on conversations
  for delete to authenticated, asap_worker
  using (app.can_access(organization_id) and created_by = (select auth.uid()));

-- Messages are reached through their conversation, so they inherit the same personal scope.
create policy tenant_select on conversation_messages
  for select to authenticated, asap_worker
  using (app.can_access(organization_id)
         and exists (select 1 from conversations c
                     where c.id = conversation_messages.conversation_id
                       and c.created_by = (select auth.uid())));
create policy tenant_insert on conversation_messages
  for insert to authenticated, asap_worker
  with check (app.can_access(organization_id)
              and exists (select 1 from conversations c
                          where c.id = conversation_messages.conversation_id
                            and c.created_by = (select auth.uid())));
create policy tenant_update on conversation_messages
  for update to authenticated, asap_worker
  using (app.can_access(organization_id)
         and exists (select 1 from conversations c
                     where c.id = conversation_messages.conversation_id
                       and c.created_by = (select auth.uid())))
  with check (app.can_access(organization_id));
create policy tenant_delete on conversation_messages
  for delete to authenticated, asap_worker
  using (app.can_access(organization_id)
         and exists (select 1 from conversations c
                     where c.id = conversation_messages.conversation_id
                       and c.created_by = (select auth.uid())));

grant select, insert, update, delete on conversations to authenticated, asap_worker;
grant select, insert, update, delete on conversation_messages to authenticated, asap_worker;

-- updated_at on a conversation moves when a turn lands, so the recent list is honest.
create or replace function app.touch_conversation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update conversations set updated_at = now() where id = new.conversation_id;
  return new;
end $$;
create trigger conversation_messages_touch
  after insert on conversation_messages
  for each row execute function app.touch_conversation();
