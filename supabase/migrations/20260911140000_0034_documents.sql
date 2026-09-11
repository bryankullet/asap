-- 0034 — Documents, extraction and page positions.
--
-- The rules this schema exists to make structural:
--
--  - **A document's bytes never leave us** (§45 rule 2). Files live in the private
--    `insurance-documents` bucket from 0012, whose policies already scope every object to the
--    brokerage that owns the path. Extraction runs on our own Python service. There is no column
--    here for a third-party document id, because there is no third party.
--  - **A citation you cannot open is not a citation.** Every extracted value carries the page it
--    came from and the region on that page, so a figure in an answer opens to the words behind it.
--    A value with no position is storable, and is shown as having no page reference — never as a
--    citation that goes nowhere.
--  - **Extraction is proposed, not believed** (§45 rule 8). A field arrives as `proposed` and
--    becomes `accepted` only when a person accepts it, or `corrected` when they change it. What a
--    person typed is kept apart from what the extractor read, so "who said this?" always has an
--    answer.
--  - **Nothing here is a business value by itself.** An accepted field is evidence that a document
--    says something. Cover, premium and status still come from the records that own them.

create table documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  -- What the document is about. A document can arrive before it is filed against anything.
  client_id        uuid references clients(id) on delete set null,
  work_item_id     uuid references work_items(id) on delete set null,
  kind             text not null check (kind in (
    'policy_schedule','quote_slip','endorsement','claim_form','invoice','receipt',
    'statement','certificate','correspondence','identity','other')),
  filename         text not null check (length(btrim(filename)) > 0),
  mime_type        text not null,
  byte_size        bigint not null check (byte_size > 0),
  -- The object path inside the private bucket. Never a public URL: reads are signed, briefly.
  storage_path     text not null unique,
  -- sha256 of the bytes, so the same file uploaded twice is recognised rather than duplicated.
  content_sha256   text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  page_count       integer check (page_count is null or page_count > 0),
  -- Where extraction has got to. `failed` is a state a person sees, with its reason, not a silence.
  extraction_state text not null default 'not_started'
    check (extraction_state in ('not_started','queued','working','extracted','failed','not_applicable')),
  extraction_error text,
  uploaded_by      uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint documents_error_only_when_failed check (extraction_state = 'failed' or extraction_error is null)
);
create index documents_organization_id_created_at_idx on documents (organization_id, created_at desc);
create index documents_client_id_idx on documents (client_id);
create index documents_work_item_id_idx on documents (work_item_id);
create index documents_uploaded_by_idx on documents (uploaded_by);
-- The same bytes filed twice in one brokerage is the same document.
create unique index documents_organization_id_content_sha256_key
  on documents (organization_id, content_sha256) where deleted_at is null;

-- One row per page: the text our own extractor read, and the page's size so a region drawn in
-- page coordinates can be placed on any rendering of it.
create table document_pages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  document_id      uuid not null references documents(id) on delete cascade,
  page_number      integer not null check (page_number >= 1),
  text             text not null default '',
  width            numeric not null check (width > 0),
  height           numeric not null check (height > 0),
  constraint document_pages_document_id_page_number_key unique (document_id, page_number)
);
create index document_pages_document_id_idx on document_pages (document_id);
create index document_pages_organization_id_idx on document_pages (organization_id);
-- Full-text search over what a document actually says, per brokerage (§45 rule 7: an exact
-- question is a lookup; this is for the questions that are genuinely searches).
create index document_pages_text_search_idx
  on document_pages using gin (to_tsvector('english', text));

-- One row per field the extractor proposed, with where on the page it came from and what a person
-- decided about it.
create table document_fields (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  document_id      uuid not null references documents(id) on delete cascade,
  -- A stable name, not free text: the review screen and any skill reading this agree on it.
  field_key        text not null check (length(btrim(field_key)) > 0),
  -- What the extractor read, as text. Typing happens when a person accepts it into a record.
  proposed_value   text,
  -- What a person decided it should be. Null until they correct it.
  corrected_value  text,
  page_number      integer check (page_number is null or page_number >= 1),
  -- The region on the page, in that page's own coordinates. All four or none.
  region_x         numeric,
  region_y         numeric,
  region_width     numeric,
  region_height    numeric,
  state            text not null default 'proposed'
    check (state in ('proposed','accepted','corrected','rejected')),
  -- Which of the six evidence conditions this field is in, so the UI can say why it is uncertain
  -- rather than showing a confident blank (D-060).
  condition        text not null default 'inferred'
    check (condition in ('known','inferred','conflicting','missing','stale','waiting')),
  reviewed_by      uuid references users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint document_fields_document_id_field_key_key unique (document_id, field_key),
  constraint document_fields_region_is_whole check (
    (region_x is null and region_y is null and region_width is null and region_height is null)
    or (region_x is not null and region_y is not null and region_width is not null and region_height is not null)),
  -- A region without a page cannot be opened, so it is not storable.
  constraint document_fields_region_needs_a_page check (region_x is null or page_number is not null),
  -- A decision has a decider. Nothing becomes accepted or corrected without one.
  constraint document_fields_decision_has_a_person check (
    state in ('proposed') or (reviewed_by is not null and reviewed_at is not null)),
  constraint document_fields_corrected_has_a_value check (
    state <> 'corrected' or corrected_value is not null)
);
create index document_fields_document_id_idx on document_fields (document_id);
create index document_fields_organization_id_idx on document_fields (organization_id);
create index document_fields_reviewed_by_idx on document_fields (reviewed_by);

comment on table documents is
  'Uploaded documents. Bytes stay in our own private bucket; extraction runs on our own service.';
comment on table document_fields is
  'What extraction proposed and what a person decided, with the page and region behind each value.';

alter table documents enable row level security;
alter table document_pages enable row level security;
alter table document_fields enable row level security;

-- Ordinary tenant scope: shared within the brokerage, invisible outside it. Unlike conversations
-- and pins, a document *is* brokerage work, so colleagues see each other's.
create policy tenant_select on documents for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on documents for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and uploaded_by = (select auth.uid()));
create policy tenant_update on documents for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on document_pages for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on document_pages for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

create policy tenant_select on document_fields for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on document_fields for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on document_fields for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

-- No delete policy on any of the three. A document is soft-deleted through the update policy, and
-- its pages and fields go with it only when the document row itself is removed at offboarding.
grant select, insert, update on documents to authenticated, asap_worker;
grant select, insert on document_pages to authenticated, asap_worker;
grant select, insert, update on document_fields to authenticated, asap_worker;
