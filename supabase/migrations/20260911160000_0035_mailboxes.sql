-- 0035 — Connected mailboxes, threads, messages and send attempts.
--
-- ASAP reads and sends from the brokerage's own mailbox, through Gmail or Microsoft 365. The
-- rules this schema makes structural:
--
--  - **A message is not reported as sent without provider evidence.** A send attempt records what
--    the provider returned — its message id and thread id — and only then is the message `sent`.
--    An attempt that timed out or failed ambiguously ends `outcome_unknown`, which is a state a
--    person sees and resolves, never a silent success and never a silent retry.
--  - **Sending is idempotent.** Every attempt carries an `idempotency_key` unique per mailbox. A
--    retry of the same intent reuses the key, so a duplicated webhook, a double click or a worker
--    restart cannot send twice (§45's event rules).
--  - **External sending is never uncontrolled** (§45 rule 13). A send is prepared, approved by a
--    person, and only then attempted. The approval that authorised it is on the attempt row.
--  - **Credentials are encrypted at rest and never leave the server.** Tokens live here as
--    ciphertext; nothing in the API response shape carries them, and the browser is told only
--    that a mailbox is connected and which address it is.
--  - **Resend is not here.** Resend carries platform transactional mail — invitations and the
--    like (D-046) — and never brokerage correspondence. That is why it has no row in this file.

create table mailboxes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  -- One neutral vocabulary. Adding a provider is an adapter and a value here.
  provider         text not null check (provider in ('gmail','microsoft')),
  email_address    text not null check (position('@' in email_address) > 1),
  display_name     text,
  -- Whose authorisation this connection runs on, so a revoked person is a revoked mailbox.
  connected_by     uuid not null references users(id),
  -- Encrypted with ENCRYPTION_KEY, server-side only. Never selected into an API response.
  access_token_encrypted   text,
  refresh_token_encrypted  text,
  token_expires_at         timestamptz,
  -- The provider's own cursor for incremental sync (Gmail historyId, Graph deltaLink).
  sync_cursor      text,
  last_synced_at   timestamptz,
  status           text not null default 'connected'
    check (status in ('connected','needs_reauthorisation','disconnected')),
  -- Why a mailbox needs attention, in plain language. Shown, not logged and forgotten.
  status_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint mailboxes_organization_id_email_address_key unique (organization_id, email_address)
);
create index mailboxes_organization_id_idx on mailboxes (organization_id);
create index mailboxes_connected_by_idx on mailboxes (connected_by);

create table email_threads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  mailbox_id       uuid not null references mailboxes(id) on delete cascade,
  -- The provider's own thread id, kept so a reply lands in the same conversation the client sees.
  provider_thread_id text not null,
  subject          text not null default '',
  client_id        uuid references clients(id) on delete set null,
  work_item_id     uuid references work_items(id) on delete set null,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  constraint email_threads_mailbox_id_provider_thread_id_key unique (mailbox_id, provider_thread_id)
);
create index email_threads_organization_id_last_message_at_idx
  on email_threads (organization_id, last_message_at desc);
create index email_threads_client_id_idx on email_threads (client_id);
create index email_threads_work_item_id_idx on email_threads (work_item_id);

create table email_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  thread_id        uuid not null references email_threads(id) on delete cascade,
  -- The provider's own message id. Unique per mailbox, so the same webhook twice is one message.
  provider_message_id text not null,
  direction        text not null check (direction in ('inbound','outbound')),
  from_address     text not null,
  to_addresses     text[] not null default '{}',
  cc_addresses     text[] not null default '{}',
  subject          text not null default '',
  -- The body, for a brokerage's own correspondence. Never copied into audit rows or logs.
  body_text        text,
  snippet          text,
  sent_at          timestamptz not null,
  has_attachments  boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint email_messages_thread_id_provider_message_id_key unique (thread_id, provider_message_id)
);
create index email_messages_thread_id_sent_at_idx on email_messages (thread_id, sent_at);
create index email_messages_organization_id_idx on email_messages (organization_id);

create table email_attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  message_id       uuid not null references email_messages(id) on delete cascade,
  provider_attachment_id text,
  filename         text not null,
  mime_type        text not null,
  byte_size        bigint not null check (byte_size >= 0),
  -- Set once the bytes have been brought into our own bucket and filed as a document.
  document_id      uuid references documents(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index email_attachments_message_id_idx on email_attachments (message_id);
create index email_attachments_organization_id_idx on email_attachments (organization_id);
create index email_attachments_document_id_idx on email_attachments (document_id);

-- One row per attempt to send. This is the evidence: nothing is reported as sent without it.
create table email_send_attempts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  mailbox_id       uuid not null references mailboxes(id) on delete cascade,
  draft_id         uuid,
  work_item_id     uuid references work_items(id) on delete set null,
  -- The same intent retried carries the same key, so a retry cannot become a second email.
  idempotency_key  text not null,
  -- Who approved this going out. External sending is never uncontrolled (§45 rule 13).
  approved_by      uuid not null references users(id),
  approved_at      timestamptz not null,
  attempt_count    integer not null default 0 check (attempt_count >= 0),
  outcome          text not null default 'preparing'
    check (outcome in ('preparing','sent','failed','outcome_unknown')),
  -- The provider's own ids, returned by the send. Present exactly when the outcome is `sent`.
  provider_message_id text,
  provider_thread_id  text,
  provider_accepted_at timestamptz,
  -- Plain language when it failed or is unknown. Never a provider body: it can echo the message.
  failure_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint email_send_attempts_mailbox_id_idempotency_key_key unique (mailbox_id, idempotency_key),
  -- The rule this table exists for, written where nothing can route around it.
  constraint email_send_attempts_sent_needs_provider_evidence check (
    outcome <> 'sent' or (provider_message_id is not null and provider_accepted_at is not null)),
  constraint email_send_attempts_evidence_means_sent check (
    provider_message_id is null or outcome = 'sent'),
  constraint email_send_attempts_failure_has_a_reason check (
    outcome not in ('failed','outcome_unknown') or failure_reason is not null)
);
create index email_send_attempts_organization_id_created_at_idx
  on email_send_attempts (organization_id, created_at desc);
create index email_send_attempts_mailbox_id_idx on email_send_attempts (mailbox_id);
create index email_send_attempts_work_item_id_idx on email_send_attempts (work_item_id);
create index email_send_attempts_approved_by_idx on email_send_attempts (approved_by);

comment on table email_send_attempts is
  'Send evidence. A message is sent only when the provider said so and the id is on this row.';
comment on column mailboxes.access_token_encrypted is
  'Ciphertext. Never selected into an API response and never logged.';

alter table mailboxes enable row level security;
alter table email_threads enable row level security;
alter table email_messages enable row level security;
alter table email_attachments enable row level security;
alter table email_send_attempts enable row level security;

create policy tenant_select on mailboxes for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on mailboxes for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and connected_by = (select auth.uid()));
create policy tenant_update on mailboxes for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on mailboxes for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

create policy tenant_select on email_threads for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on email_threads for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on email_threads for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on email_messages for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on email_messages for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

create policy tenant_select on email_attachments for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on email_attachments for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on email_attachments for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on email_send_attempts for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on email_send_attempts for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and approved_by = (select auth.uid()));
create policy tenant_update on email_send_attempts for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

-- No column-level grant can hide a token from a select *, so the API's own column lists are what
-- keep ciphertext off the wire. The pgTAP suite asserts no route selects them.
grant select, insert, update, delete on mailboxes to authenticated, asap_worker;
grant select, insert, update on email_threads to authenticated, asap_worker;
grant select, insert on email_messages to authenticated, asap_worker;
grant select, insert, update on email_attachments to authenticated, asap_worker;
grant select, insert, update on email_send_attempts to authenticated, asap_worker;
