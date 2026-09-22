-- 0044 — A reply being written, and what a conversation is about.
--
-- Two gaps 0035 left, both of which the Communication Space needs and neither of which the
-- browser may hold on its own:
--
--  - **A draft is a server record, not React state.** Two conversations open at once must keep
--    two separate replies, a refresh must not lose what somebody wrote, and — the reason this is
--    a table rather than a field — an approval must be attached to an exact body. The approved
--    text's digest is stored beside the approval, so editing the reply after it was approved
--    cannot leave the approval standing. The check constraint makes a half-approval impossible.
--  - **A conversation can be about a policy.** 0035 could link a thread to a client and to a work
--    item; the policy itself had nowhere to go, which is how "which cover is this about?" ended up
--    being guessed from a subject line. It is now a column, set by a person.
--
-- Nothing here sends anything. There is still no send path in this deployment: a message leaves
-- ASAP only through `email_send_attempts`, with the provider's own id on the row (§45 rule 13).

alter table email_threads
  add column policy_id uuid references policies(id) on delete set null;
create index email_threads_policy_id_idx on email_threads (policy_id);
comment on column email_threads.policy_id is
  'Set by a person, never inferred from a similar name in a subject line.';

create table email_drafts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  thread_id        uuid not null references email_threads(id) on delete cascade,
  to_addresses     text[] not null default '{}',
  cc_addresses     text[] not null default '{}',
  subject          text not null default '',
  body_text        text not null default '',
  -- The digest of the exact text that was approved. An edit that changes the reply changes this,
  -- and the API clears the approval when it does: approval is of a body, not of an intention.
  approved_body_sha256 text,
  approved_by      uuid references users(id),
  approved_at      timestamptz,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One reply in progress per conversation. Two conversations keep two.
  constraint email_drafts_thread_id_key unique (thread_id),
  constraint email_drafts_approval_is_whole check (
    (approved_by is null and approved_at is null and approved_body_sha256 is null)
    or (approved_by is not null and approved_at is not null and approved_body_sha256 is not null))
);
create index email_drafts_organization_id_idx on email_drafts (organization_id);
create index email_drafts_thread_id_idx on email_drafts (thread_id);
create index email_drafts_created_by_idx on email_drafts (created_by);
create index email_drafts_approved_by_idx on email_drafts (approved_by);

comment on table email_drafts is
  'A reply being written. Never sent from here, and an approval is of one exact body.';

alter table email_drafts enable row level security;

create policy tenant_select on email_drafts for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on email_drafts for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_update on email_drafts for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on email_drafts for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

grant select, insert, update, delete on email_drafts to authenticated, asap_worker;
