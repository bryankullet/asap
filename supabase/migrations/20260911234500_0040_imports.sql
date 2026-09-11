-- 0040 — bringing an existing book in.
--
-- A brokerage joining ASAP has years of clients and policies in a spreadsheet, and until now the
-- only way in was one record at a time. This is the machinery for the other way.
--
-- Two tables rather than one, because the two halves answer different questions:
--
--   `import_batches`  what file, by whom, when, and what became of it.
--   `import_rows`     what each line of it said, what we made of it, and what it created.
--
-- Why the rows are stored at all, rather than parsed twice: **the preview a person approves must
-- be the thing that gets written.** Re-parsing at commit time means the file could be edited, the
-- matcher could resolve a name differently, or a client could be created in between — and the
-- person would have approved something other than what happened. Storing the decision makes the
-- preview binding.
--
-- It is also the audit trail. "Where did this client come from?" is answerable for every record an
-- import creates, down to the line of the file and who pressed the button.

create table import_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  filename         text not null check (length(btrim(filename)) > 0),
  -- The same spreadsheet twice is recognised rather than imported twice. Uniqueness is per
  -- brokerage and only over batches that were actually committed: a preview somebody abandoned
  -- must not block a second, corrected attempt at the same file.
  content_sha256   text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  row_count        integer not null check (row_count >= 0),
  -- What the file's "premium" column means. Asked once per file, because it cannot be inferred
  -- from the numbers and getting it wrong is silent (0039).
  premium_basis    text check (premium_basis in ('gross','total_payable')),
  status           text not null default 'previewed'
                   check (status in ('previewed','committed','abandoned','failed')),
  -- Counted at commit, so "what did this actually do?" needs no recount over the rows.
  clients_created  integer not null default 0 check (clients_created >= 0),
  contacts_created integer not null default 0 check (contacts_created >= 0),
  policies_created integer not null default 0 check (policies_created >= 0),
  periods_created  integer not null default 0 check (periods_created >= 0),
  rows_skipped     integer not null default 0 check (rows_skipped >= 0),
  failure_reason   text,
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  committed_at     timestamptz
);

create index import_batches_organization_id_created_at_idx
  on import_batches (organization_id, created_at desc);
create index import_batches_created_by_idx on import_batches (created_by);
create unique index import_batches_committed_content_key
  on import_batches (organization_id, content_sha256) where status = 'committed';

create table import_rows (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  batch_id         uuid not null references import_batches(id) on delete cascade,
  -- The line number in the file the person uploaded, so a problem can be found in their own copy.
  line_number      integer not null check (line_number >= 1),
  -- The row exactly as it was read, before any interpretation. Kept so that a disagreement about
  -- what the file said can be settled by looking, rather than by re-uploading.
  raw              jsonb not null,
  -- What we made of it, and what we would do. `needs_review` is a duplicate a person must resolve;
  -- `invalid` is a row we will not write and can say why.
  outcome          text not null default 'pending'
                   check (outcome in ('pending','create','match','needs_review','invalid','skipped','committed','failed')),
  -- Plain language, never a variable name or a constraint name.
  problem          text,
  -- The client this row resolved to, when it matched an existing one.
  matched_client_id uuid references clients(id) on delete set null,
  -- What it actually created. Null until committed; the record of what this line became.
  created_client_id  uuid references clients(id) on delete set null,
  created_contact_id uuid references client_contacts(id) on delete set null,
  created_policy_id  uuid references policies(id) on delete set null,
  created_period_id  uuid references policy_periods(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint import_rows_batch_id_line_number_key unique (batch_id, line_number)
);

create index import_rows_organization_id_idx on import_rows (organization_id);
create index import_rows_batch_id_outcome_idx on import_rows (batch_id, outcome);

-- Every foreign key carries a covering index (0203 hygiene). These also answer the question a
-- person actually asks of an import: "what did this file create, and where is it now?"
create index import_rows_matched_client_id_idx on import_rows (matched_client_id);
create index import_rows_created_client_id_idx on import_rows (created_client_id);
create index import_rows_created_contact_id_idx on import_rows (created_contact_id);
create index import_rows_created_policy_id_idx on import_rows (created_policy_id);
create index import_rows_created_period_id_idx on import_rows (created_period_id);

alter table import_batches enable row level security;
alter table import_rows enable row level security;

create policy tenant_select on import_batches for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on import_batches for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_update on import_batches for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on import_batches for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

create policy tenant_select on import_rows for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on import_rows for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on import_rows for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));
create policy tenant_delete on import_rows for delete to authenticated, asap_worker
  using (app.can_access(organization_id));

grant select, insert, update, delete on import_batches to authenticated, asap_worker;
grant select, insert, update, delete on import_rows to authenticated, asap_worker;
