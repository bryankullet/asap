-- 0053 — Reading a quotation, and the human review between reading it and believing it.
--
-- The extractor could read eight labelled fields off a policy schedule and nothing off a
-- quotation: no excess, no limit as a term of its own, no exclusion, no condition, no validity.
-- Every term compared in 4B-3 was therefore one a person typed. This is the other half.
--
-- The shape matters more than the reading. `document_fields` (0031) holds one value per key,
-- which is right for "the insured's name" and wrong for "the excesses": a quotation states
-- several, and flattening them into one field loses the ones that matter. So repeated terms get
-- their own table, one row per occurrence, each with the page and the rectangle it was read from.
--
-- And a proposal is not a term. Nothing here reaches `quote_terms` until a person accepts or
-- corrects it; the confirmed term keeps a pointer back to the proposal, and the proposal keeps
-- what the extractor originally said. A later re-read cannot overwrite a human correction —
-- enforced in the route and asserted in the tests, because that is the failure that would quietly
-- put an insurer's misread excess in front of a client.

/* A quotation may offer a benefit as well as limit, exclude and condition one. */
alter table quote_terms drop constraint quote_terms_term_type_check;
alter table quote_terms add constraint quote_terms_term_type_check check (
  term_type in ('excess','limit','condition','exclusion','benefit','levy','tax','subjectivity','other'));

create table document_term_proposals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  document_id      uuid not null references documents(id) on delete cascade,
  /*
   * The occurrence's place in the document. Stable across re-reads of the same file, which is
   * what makes a second extraction an update rather than a duplicate.
   */
  ordinal          integer not null check (ordinal >= 0),
  term_type        text not null check (term_type in
                     ('excess','limit','condition','exclusion','benefit','levy','tax','subjectivity','other')),
  label            text not null check (length(btrim(label)) > 0),
  proposed_value   text,
  amount           numeric(14,2),
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- Where on the page, so the proposal opens at the words it was read from.
  page_number      integer check (page_number is null or page_number >= 1),
  region_x         numeric,
  region_y         numeric,
  region_width     numeric,
  region_height    numeric,
  /* How sure the reading is, in the vocabulary 0031 already uses for document fields. */
  condition        text not null default 'inferred'
                     check (condition in ('known','inferred','conflicting','unclear')),
  /* How it was found, so a bad rule can be traced to the reading that produced it. */
  method           text not null check (length(btrim(method)) > 0),
  state            text not null default 'proposed'
                     check (state in ('proposed','accepted','corrected','rejected')),
  corrected_value  text,
  corrected_amount numeric(14,2),
  reviewed_by      uuid references users(id),
  reviewed_at      timestamptz,
  /* The confirmed term this became, once a person accepted or corrected it. */
  quote_term_id    uuid references quote_terms(id) on delete set null,
  /* What the term said before this proposal was applied to it. Null when it created the term. */
  previous_revision_id uuid references quote_term_revisions(id),
  created_at       timestamptz not null default now(),
  constraint document_term_proposals_one_per_ordinal unique (document_id, ordinal),
  constraint document_term_proposals_decision_has_a_person check (
    state = 'proposed' or (reviewed_by is not null and reviewed_at is not null)),
  constraint document_term_proposals_corrected_has_a_value check (
    state <> 'corrected' or corrected_value is not null or corrected_amount is not null),
  -- A proposal that became a term must say which term. A rejected one never has one.
  constraint document_term_proposals_applied_has_a_term check (
    state not in ('accepted','corrected') or quote_term_id is not null),
  constraint document_term_proposals_rejected_has_no_term check (
    state <> 'rejected' or quote_term_id is null),
  constraint document_term_proposals_says_something check (
    proposed_value is not null or amount is not null or condition = 'unclear'),
  constraint document_term_proposals_amount_needs_currency check (
    amount is null or currency is not null),
  constraint document_term_proposals_region_is_whole check (
    (region_x is null and region_y is null and region_width is null and region_height is null)
    or (page_number is not null and region_x is not null and region_y is not null
        and region_width is not null and region_width > 0
        and region_height is not null and region_height > 0))
);
create index document_term_proposals_organization_id_idx on document_term_proposals (organization_id);
create index document_term_proposals_document_id_idx on document_term_proposals (document_id);
create index document_term_proposals_reviewed_by_idx on document_term_proposals (reviewed_by);
create index document_term_proposals_quote_term_id_idx on document_term_proposals (quote_term_id);
create index document_term_proposals_previous_revision_id_idx on document_term_proposals (previous_revision_id);

comment on table document_term_proposals is
  'What the extractor thinks a quotation says. Never a confirmed term until a person says so.';

/* ---------------------------------------------------------------------------------------------
 * Which answer a quotation document belongs to.
 *
 * `insurer_responses.source_document_id` already says it, and it is the right place: the link is
 * a fact about the answer, not a side effect of a review. What was missing is the guarantee that
 * it means one thing. One quotation document belongs to one insurer's answer; applying the same
 * document to a second answer is not a retry, it is a mistake, and the index refuses it before
 * any term is written.
 *
 * Nothing here matches an insurer or a client by the resemblance of a name. An extracted
 * "Jubilee Alliance" is not evidence that this brokerage's "Jubilee Insurance" sent the
 * quotation, and acting on that resemblance is how one insurer's terms end up against another's.
 * A person chooses the answer; the route refuses to guess.
 */
create unique index insurer_responses_one_per_source_document
  on insurer_responses (organization_id, source_document_id)
  where source_document_id is not null;

alter table document_term_proposals enable row level security;

create policy tenant_select on document_term_proposals for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on document_term_proposals for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on document_term_proposals for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

grant select, insert, update on document_term_proposals to authenticated, asap_worker;
revoke delete on document_term_proposals from asap_worker, authenticated;
