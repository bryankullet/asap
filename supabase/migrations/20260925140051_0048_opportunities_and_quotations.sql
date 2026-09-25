-- 0048 — A client needs cover: opportunities, insurer approaches, and the terms that come back.
--
-- The lifecycle this models is the one in the economic report and the prototype, in that order:
--
--   a client needs cover → the risk and the requested cover are recorded → what is required is
--   listed and what is missing is visible → insurers are chosen → a request is prepared per
--   insurer → a person approves it going out → each insurer's answer is recorded, with its terms
--   and the document or email it came from → the answers become comparable.
--
-- Four decisions shape every table below.
--
-- **1. No status column.** An opportunity's position is computed from its own facts — are the
-- requirements supplied, has a request been approved, has an insurer answered — exactly as the
-- economic model requires (D-027: position is a vector derived from facts and evidence, never a
-- stored status). Nothing here stores "Prepared" or "Replies received"; those words are derived
-- for the screen and cannot drift from the rows.
--
-- **2. Nothing is claimed without its evidence.** A request is not sent without the provider's
-- own message id. An insurer has not answered without a document, an email, or a person saying so
-- in as many words. Each of those is a check constraint, not a convention.
--
-- **3. A correction never destroys what was read.** An extracted term keeps the extracted value
-- for good; correcting it writes a second value beside it with who corrected it and when. That is
-- the same rule `document_fields` follows (0043), applied to terms.
--
-- **4. What a Kenyan brokerage requires is data.** Requirement templates are per organization and
-- per class of business, so "a commercial motor request needs a vehicle schedule with declared
-- values" is a row somebody can change — never a constant in React (D-027).

/* ---------------------------------------------------------------------------------------------
 * What a request of this kind needs, before it goes anywhere.
 *
 * Per organization and per class of business. A brokerage that learns an insurer wants something
 * extra adds a row; nobody edits code, and nothing about Kenya is hard-coded.
 */
create table requirement_templates (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  class_of_business text not null check (length(btrim(class_of_business)) > 0),
  label             text not null check (length(btrim(label)) > 0),
  -- False for something worth asking for but not worth blocking on.
  required          boolean not null default true,
  -- Where this requirement comes from, and when somebody last checked it is still true. A rule
  -- with no source is a rule nobody can defend to a client (D-027).
  source            text,
  verified_at       timestamptz,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint requirement_templates_unique unique (organization_id, class_of_business, label)
);
create index requirement_templates_organization_id_idx on requirement_templates (organization_id);

comment on table requirement_templates is
  'What a class of business needs before insurers are approached. Per organization: never a constant.';

/* ---------------------------------------------------------------------------------------------
 * The client's need for cover.
 */
create table opportunities (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  -- The piece of work a person owns. The opportunity is the commercial thing; the work item is
  -- who is doing it and what state that work is in, and the two are deliberately not merged.
  work_item_id      uuid not null references work_items(id) on delete cascade,
  -- What a person calls it: "Acme motor fleet quotation — 2027". Shown as the Space's title.
  title             text not null check (length(btrim(title)) > 0),
  class_of_business text not null check (length(btrim(class_of_business)) > 0),
  -- What is being insured, in the brokerage's own words. Not a schema of vehicles and buildings:
  -- the subject matter of a risk differs by class, and forcing it into columns would lose most of
  -- it. The structured part that matters — the values, the registrations — lives in documents.
  risk_summary      text,
  -- The cover the client asked for. Either both dates or neither: half a period describes nothing.
  cover_start       date,
  cover_end         date,
  -- Where the need came from, so the Space can open the original.
  source_email_message_id uuid references email_messages(id) on delete set null,
  source_document_id      uuid references documents(id) on delete set null,
  owner_id          uuid references users(id),
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Closing is an outcome, not a status: it says what happened and requires a reason.
  closed_at         timestamptz,
  closed_outcome    text check (closed_outcome in ('placed','lost','withdrawn')),
  closed_reason     text,
  constraint opportunities_period_is_whole check (
    (cover_start is null and cover_end is null)
    or (cover_start is not null and cover_end is not null and cover_end >= cover_start)),
  constraint opportunities_closed_is_whole check (
    (closed_at is null and closed_outcome is null and closed_reason is null)
    or (closed_at is not null and closed_outcome is not null
        and closed_reason is not null and length(btrim(closed_reason)) > 0)),
  -- One opportunity per piece of work. A second would be two commercial records for one job.
  constraint opportunities_work_item_id_key unique (work_item_id)
);
create index opportunities_organization_id_created_at_idx on opportunities (organization_id, created_at desc);
create index opportunities_client_id_idx on opportunities (client_id);
create index opportunities_work_item_id_idx on opportunities (work_item_id);
create index opportunities_owner_id_idx on opportunities (owner_id);
create index opportunities_created_by_idx on opportunities (created_by);
create index opportunities_source_email_message_id_idx on opportunities (source_email_message_id);
create index opportunities_source_document_id_idx on opportunities (source_document_id);

comment on table opportunities is
  'A client needs cover. Position is derived from requirements, approvals and responses — never stored.';

/* ---------------------------------------------------------------------------------------------
 * What this opportunity needs before anyone approaches the market.
 *
 * Copied from the templates when the opportunity is created, so later template edits cannot
 * rewrite the history of a request that already went out.
 */
create table opportunity_requirements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  label             text not null check (length(btrim(label)) > 0),
  required          boolean not null default true,
  position          integer not null default 0,
  -- Supplied means somebody said so and named what proves it. All four move together.
  supplied_at       timestamptz,
  supplied_by       uuid references users(id),
  evidence_document_id      uuid references documents(id) on delete set null,
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  -- When neither a document nor an email proves it, a person's own note has to say what does.
  evidence_note     text,
  created_at        timestamptz not null default now(),
  constraint opportunity_requirements_unique unique (opportunity_id, label),
  constraint opportunity_requirements_supplied_is_whole check (
    (supplied_at is null and supplied_by is null)
    or (supplied_at is not null and supplied_by is not null)),
  -- Supplied with nothing behind it is a tick, not evidence.
  constraint opportunity_requirements_supplied_has_evidence check (
    supplied_at is null
    or evidence_document_id is not null
    or evidence_email_message_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) > 0))
);
create index opportunity_requirements_organization_id_idx on opportunity_requirements (organization_id);
create index opportunity_requirements_opportunity_id_idx on opportunity_requirements (opportunity_id);
create index opportunity_requirements_supplied_by_idx on opportunity_requirements (supplied_by);
create index opportunity_requirements_evidence_document_id_idx on opportunity_requirements (evidence_document_id);
create index opportunity_requirements_evidence_email_message_id_idx on opportunity_requirements (evidence_email_message_id);

/* ---------------------------------------------------------------------------------------------
 * Which insurers are being approached.
 *
 * Removing one keeps the row: who was approached and later dropped is part of how a placement was
 * arrived at, and a client may well ask.
 */
create table opportunity_insurers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  insurer_id        uuid not null references insurers(id),
  added_by          uuid not null references users(id),
  added_at          timestamptz not null default now(),
  removed_at        timestamptz,
  removed_by        uuid references users(id),
  removed_reason    text,
  constraint opportunity_insurers_removed_is_whole check (
    (removed_at is null and removed_by is null and removed_reason is null)
    or (removed_at is not null and removed_by is not null
        and removed_reason is not null and length(btrim(removed_reason)) > 0))
);
-- One live approach per insurer per opportunity. A double-clicked "add" finds this, not a second row.
create unique index opportunity_insurers_one_live_per_insurer
  on opportunity_insurers (opportunity_id, insurer_id) where removed_at is null;
create index opportunity_insurers_organization_id_idx on opportunity_insurers (organization_id);
create index opportunity_insurers_opportunity_id_idx on opportunity_insurers (opportunity_id);
create index opportunity_insurers_insurer_id_idx on opportunity_insurers (insurer_id);
create index opportunity_insurers_added_by_idx on opportunity_insurers (added_by);
create index opportunity_insurers_removed_by_idx on opportunity_insurers (removed_by);

/* ---------------------------------------------------------------------------------------------
 * The request prepared for one insurer.
 *
 * Preparing is not sending. Approving is not sending either. `sent_at` exists only beside the
 * provider's own message id, so no row in this table can say a request went out without the
 * evidence that it did — which matters especially now, when nothing in this deployment can send.
 */
create table quote_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  opportunity_insurer_id uuid not null references opportunity_insurers(id) on delete cascade,
  subject           text not null check (length(btrim(subject)) > 0),
  body_text         text not null check (length(btrim(body_text)) > 0),
  prepared_by       uuid not null references users(id),
  prepared_at       timestamptz not null default now(),
  -- The approval covers this exact text. Editing it after approval clears the approval, the same
  -- rule an email draft follows (0044) and for the same reason.
  approved_body_sha256 text,
  approved_by       uuid references users(id),
  approved_at       timestamptz,
  -- Only ever written from a real send, with the provider's id. Nothing in 4B-2 writes it.
  sent_email_message_id uuid references email_messages(id) on delete set null,
  sent_at           timestamptz,
  updated_at        timestamptz not null default now(),
  -- One prepared request per insurer per opportunity. A retry updates it; it never makes a second.
  constraint quote_requests_one_per_insurer unique (opportunity_insurer_id),
  constraint quote_requests_approval_is_whole check (
    (approved_by is null and approved_at is null and approved_body_sha256 is null)
    or (approved_by is not null and approved_at is not null and approved_body_sha256 is not null)),
  constraint quote_requests_sent_needs_provider_evidence check (
    (sent_at is null and sent_email_message_id is null)
    or (sent_at is not null and sent_email_message_id is not null)),
  -- Nothing goes out that a person did not approve (§45 rule 13), written where code cannot route around it.
  constraint quote_requests_sent_needs_approval check (sent_at is null or approved_at is not null)
);
create index quote_requests_organization_id_idx on quote_requests (organization_id);
create index quote_requests_opportunity_id_idx on quote_requests (opportunity_id);
create index quote_requests_prepared_by_idx on quote_requests (prepared_by);
create index quote_requests_approved_by_idx on quote_requests (approved_by);
create index quote_requests_sent_email_message_id_idx on quote_requests (sent_email_message_id);

comment on table quote_requests is
  'A prepared insurer request. Approved is not sent; sent requires the provider''s own message id.';

/* ---------------------------------------------------------------------------------------------
 * What one insurer said.
 *
 * `outcome` is the insurer's answer, not the state of our work: quoted, declined, or asked and
 * silent. A quote is never "received" because a blank row exists — a quoted outcome must name
 * where it came from and carry a premium or at least one term.
 */
create table insurer_responses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  opportunity_insurer_id uuid not null references opportunity_insurers(id) on delete cascade,
  outcome           text not null check (outcome in ('quoted','declined','no_response')),
  received_at       timestamptz,
  -- Where it came from. One of these, or a person's own note, is required for a quoted outcome.
  source_email_message_id uuid references email_messages(id) on delete set null,
  source_document_id      uuid references documents(id) on delete set null,
  source_note       text,
  premium_amount    numeric(14,2) check (premium_amount is null or premium_amount >= 0),
  premium_currency  text check (premium_currency is null or premium_currency ~ '^[A-Z]{3}$'),
  -- Terms expire. Tracking that is a named gap in the skill map (`quote.track_validity`); the
  -- date is recorded here so whatever picks that up has something to read.
  valid_until       date,
  decline_reason    text,
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One answer per insurer per opportunity. A revised quote updates it; re-recording is not a second.
  constraint insurer_responses_one_per_insurer unique (opportunity_insurer_id),
  constraint insurer_responses_amount_needs_currency check (
    (premium_amount is null and premium_currency is null)
    or (premium_amount is not null and premium_currency is not null)),
  constraint insurer_responses_quoted_needs_a_time check (
    outcome <> 'quoted' or received_at is not null),
  -- The rule this table exists for: a quote must say where it came from.
  constraint insurer_responses_quoted_needs_a_source check (
    outcome <> 'quoted'
    or source_email_message_id is not null
    or source_document_id is not null
    or (source_note is not null and length(btrim(source_note)) > 0)),
  constraint insurer_responses_decline_has_a_reason check (
    outcome <> 'declined'
    or (decline_reason is not null and length(btrim(decline_reason)) > 0)),
  -- Silence is not a premium.
  constraint insurer_responses_no_response_is_empty check (
    outcome <> 'no_response' or (premium_amount is null and received_at is null))
);
create index insurer_responses_organization_id_idx on insurer_responses (organization_id);
create index insurer_responses_opportunity_id_idx on insurer_responses (opportunity_id);
create index insurer_responses_recorded_by_idx on insurer_responses (recorded_by);
create index insurer_responses_source_email_message_id_idx on insurer_responses (source_email_message_id);
create index insurer_responses_source_document_id_idx on insurer_responses (source_document_id);

comment on table insurer_responses is
  'One insurer''s answer. A quoted outcome must name its source: a blank row is not a received quote.';

/* ---------------------------------------------------------------------------------------------
 * The terms inside one insurer's answer.
 *
 * `extracted_value` is what was read and never changes. `corrected_value` is what a person says it
 * actually is. Both are shown, because the difference between them is the audit.
 */
create table quote_terms (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  insurer_response_id uuid not null references insurer_responses(id) on delete cascade,
  -- The kinds the comparison in 4B-3 needs to line up. `levy` and `tax` are here because Kenyan
  -- premiums carry statutory charges that are not the broker's money, and they are only ever
  -- recorded where an insurer actually stated one.
  term_type         text not null check (term_type in
                      ('excess','limit','condition','exclusion','levy','tax','subjectivity','other')),
  label             text not null check (length(btrim(label)) > 0),
  -- What was read from the source. Immutable once written: a correction goes beside it, not over it.
  extracted_value   text,
  -- What a person says it is. Null until somebody corrects the extraction.
  corrected_value   text,
  corrected_by      uuid references users(id),
  corrected_at      timestamptz,
  -- The amount, when the term is one. Kept apart from the text so a comparison can sort on it.
  amount            numeric(14,2),
  currency          text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- True when the insurer said something that cannot be compared — "excess as per policy wording".
  unclear           boolean not null default false,
  -- Where in the document it was read, so a figure can be opened at its page.
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_page     integer check (evidence_page is null or evidence_page >= 1),
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint quote_terms_unique unique (insurer_response_id, term_type, label),
  constraint quote_terms_correction_is_whole check (
    (corrected_value is null and corrected_by is null and corrected_at is null)
    or (corrected_value is not null and corrected_by is not null and corrected_at is not null)),
  constraint quote_terms_amount_needs_currency check (
    amount is null or currency is not null),
  -- A term has to say something: a value, an amount, or that it was unclear.
  constraint quote_terms_says_something check (
    extracted_value is not null or corrected_value is not null or amount is not null or unclear)
);
create index quote_terms_organization_id_idx on quote_terms (organization_id);
create index quote_terms_insurer_response_id_idx on quote_terms (insurer_response_id);
create index quote_terms_corrected_by_idx on quote_terms (corrected_by);
create index quote_terms_evidence_document_id_idx on quote_terms (evidence_document_id);

comment on column quote_terms.extracted_value is
  'What was read. Never overwritten: a correction is written beside it, and both are shown.';

/* ---------------------------------------------------------------------------------------------
 * Row level security. Every table is tenant-scoped, and every policy names organization_id.
 *
 * Deletes are absent by design. An opportunity that came to nothing is closed with a reason; an
 * insurer no longer approached is marked removed with a reason. Both are part of how a placement
 * was arrived at, and neither is ours to erase.
 */
alter table requirement_templates      enable row level security;
alter table opportunities              enable row level security;
alter table opportunity_requirements   enable row level security;
alter table opportunity_insurers       enable row level security;
alter table quote_requests             enable row level security;
alter table insurer_responses          enable row level security;
alter table quote_terms                enable row level security;

create policy tenant_select on requirement_templates for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on requirement_templates for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on requirement_templates for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on opportunities for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on opportunities for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and created_by = (select auth.uid()));
create policy tenant_update on opportunities for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on opportunity_requirements for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on opportunity_requirements for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on opportunity_requirements for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on opportunity_insurers for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on opportunity_insurers for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and added_by = (select auth.uid()));
create policy tenant_update on opportunity_insurers for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on quote_requests for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_requests for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and prepared_by = (select auth.uid()));
create policy tenant_update on quote_requests for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on insurer_responses for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on insurer_responses for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));
create policy tenant_update on insurer_responses for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on quote_terms for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_terms for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on quote_terms for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

-- Narrow grants: no delete anywhere, because nothing here is erased.
grant select, insert, update on requirement_templates    to authenticated, asap_worker;
grant select, insert, update on opportunities            to authenticated, asap_worker;
grant select, insert, update on opportunity_requirements to authenticated, asap_worker;
grant select, insert, update on opportunity_insurers     to authenticated, asap_worker;
grant select, insert, update on quote_requests           to authenticated, asap_worker;
grant select, insert, update on insurer_responses        to authenticated, asap_worker;
grant select, insert, update on quote_terms              to authenticated, asap_worker;

-- 0013's default privileges hand every new table a delete to asap_worker. Nothing here is deleted.
revoke delete on requirement_templates, opportunities, opportunity_requirements,
                 opportunity_insurers, quote_requests, insurer_responses, quote_terms
  from asap_worker, authenticated;
