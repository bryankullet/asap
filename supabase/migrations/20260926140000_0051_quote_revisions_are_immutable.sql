-- 0051 — A comparison points at what was compared, not at rows that have moved on.
--
-- 0050 stored digests. A digest proves *that* something changed and is worth keeping, but it
-- cannot show what the broker put in front of the client. Worse than a blank: an old comparison
-- joined to today's rows renders today's figures under the old comparison's name, so opening the
-- comparison a client saw in August shows September's excess and claims that is what they saw.
-- A probe against a real database confirmed exactly that before this migration was written.
--
-- The fix is immutable revisions. Every insurer response and every quote term mints a revision
-- whenever it is written, by trigger, so no route can change one without leaving the previous
-- reading intact. A comparison references revision ids. Reading an old comparison then reads the
-- revisions it named, and nothing that happens afterwards can alter what it shows.
--
-- Revisions hold business values, so they live under the same tenant RLS as the rows they come
-- from and never go near an audit payload. Nothing deletes one.

/* ---------------------------------------------------------------------------------------------
 * Where a figure sits on its page.
 *
 * `quote_terms` could say which document and page a term came from but not where on the page.
 * A citation you cannot open at the right rectangle is not a citation (§36), and the extraction
 * work in this same increment proposes terms with rectangles, so the column has to exist to
 * receive them.
 */
alter table quote_terms
  add column region_x      numeric,
  add column region_y      numeric,
  add column region_width  numeric,
  add column region_height numeric,
  add constraint quote_terms_region_is_whole check (
    (region_x is null and region_y is null and region_width is null and region_height is null)
    or (region_x is not null and region_y is not null
        and region_width is not null and region_width > 0
        and region_height is not null and region_height > 0));

/* ---------------------------------------------------------------------------------------------
 * What one insurer's answer said, at one moment.
 */
create table insurer_response_revisions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  -- Null once the response itself is gone (offboarding). The revision survives it: a comparison
  -- that showed those figures must still be able to show them.
  insurer_response_id uuid references insurer_responses(id) on delete set null,
  opportunity_id      uuid not null references opportunities(id) on delete cascade,
  revision            integer not null check (revision >= 1),
  outcome             text not null,
  received_at         timestamptz,
  premium_amount      numeric(14,2),
  premium_currency    text,
  valid_until         date,
  decline_reason      text,
  source_email_message_id uuid references email_messages(id) on delete set null,
  source_document_id      uuid references documents(id) on delete set null,
  source_note         text,
  sha256              text not null check (length(sha256) = 64),
  created_at          timestamptz not null default now(),
  constraint insurer_response_revisions_one_per_revision unique (insurer_response_id, revision)
);
create index insurer_response_revisions_organization_id_idx on insurer_response_revisions (organization_id);
create index insurer_response_revisions_insurer_response_id_idx on insurer_response_revisions (insurer_response_id);
create index insurer_response_revisions_opportunity_id_idx on insurer_response_revisions (opportunity_id);
create index insurer_response_revisions_source_document_id_idx on insurer_response_revisions (source_document_id);
create index insurer_response_revisions_source_email_message_id_idx on insurer_response_revisions (source_email_message_id);

comment on table insurer_response_revisions is
  'Immutable. What an insurer answer said at one moment, so a comparison can still show it.';

/* ---------------------------------------------------------------------------------------------
 * What one term said, at one moment — with where it was read from.
 */
create table quote_term_revisions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  quote_term_id       uuid references quote_terms(id) on delete set null,
  insurer_response_id uuid references insurer_responses(id) on delete set null,
  revision            integer not null check (revision >= 1),
  term_type           text not null,
  label               text not null,
  extracted_value     text,
  corrected_value     text,
  corrected_by        uuid references users(id),
  corrected_at        timestamptz,
  amount              numeric(14,2),
  currency            text,
  unclear             boolean not null default false,
  -- The evidence exactly as it stood. An old comparison's citation opens the page it opened then.
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_page       integer,
  region_x            numeric,
  region_y            numeric,
  region_width        numeric,
  region_height       numeric,
  sha256              text not null check (length(sha256) = 64),
  created_at          timestamptz not null default now(),
  constraint quote_term_revisions_one_per_revision unique (quote_term_id, revision)
);
create index quote_term_revisions_organization_id_idx on quote_term_revisions (organization_id);
create index quote_term_revisions_quote_term_id_idx on quote_term_revisions (quote_term_id);
create index quote_term_revisions_insurer_response_id_idx on quote_term_revisions (insurer_response_id);
create index quote_term_revisions_corrected_by_idx on quote_term_revisions (corrected_by);
create index quote_term_revisions_evidence_document_id_idx on quote_term_revisions (evidence_document_id);

comment on table quote_term_revisions is
  'Immutable. What a term said at one moment, and where on the page it was read from.';

/* ---------------------------------------------------------------------------------------------
 * Minting, and never editing.
 *
 * By trigger rather than by a route, because a revision written only where somebody remembered is
 * a revision missing exactly where it mattered. AFTER, so a row that failed its constraints mints
 * nothing.
 */
create or replace function app.mint_insurer_response_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_digest text;
  v_next   integer;
begin
  v_digest := app.insurer_response_digest(new.outcome, new.premium_amount, new.premium_currency, new.valid_until);

  /* The digest covers the figures a comparison shows; the source and the reason do not move a
   * comparison but do belong in the record, so the revision is minted on any real change. */
  if tg_op = 'UPDATE'
     and old.outcome is not distinct from new.outcome
     and old.premium_amount is not distinct from new.premium_amount
     and old.premium_currency is not distinct from new.premium_currency
     and old.valid_until is not distinct from new.valid_until
     and old.decline_reason is not distinct from new.decline_reason
     and old.source_note is not distinct from new.source_note
     and old.source_document_id is not distinct from new.source_document_id
     and old.source_email_message_id is not distinct from new.source_email_message_id
  then
    return null;
  end if;

  select coalesce(max(revision), 0) + 1 into v_next
    from public.insurer_response_revisions where insurer_response_id = new.id;

  insert into public.insurer_response_revisions (
    organization_id, insurer_response_id, opportunity_id, revision, outcome, received_at,
    premium_amount, premium_currency, valid_until, decline_reason,
    source_email_message_id, source_document_id, source_note, sha256)
  values (new.organization_id, new.id, new.opportunity_id, v_next, new.outcome, new.received_at,
          new.premium_amount, new.premium_currency, new.valid_until, new.decline_reason,
          new.source_email_message_id, new.source_document_id, new.source_note, v_digest);
  return null;
end $$;
revoke all on function app.mint_insurer_response_revision() from public;

create trigger insurer_responses_mint_revision
  after insert or update on insurer_responses
  for each row execute function app.mint_insurer_response_revision();

create or replace function app.mint_quote_term_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_digest text;
  v_next   integer;
begin
  v_digest := app.quote_term_digest(new.term_type, new.label, new.extracted_value,
                                    new.corrected_value, new.amount, new.currency, new.unclear);

  if tg_op = 'UPDATE'
     and old.term_type is not distinct from new.term_type
     and old.label is not distinct from new.label
     and old.extracted_value is not distinct from new.extracted_value
     and old.corrected_value is not distinct from new.corrected_value
     and old.amount is not distinct from new.amount
     and old.currency is not distinct from new.currency
     and old.unclear is not distinct from new.unclear
     and old.evidence_document_id is not distinct from new.evidence_document_id
     and old.evidence_page is not distinct from new.evidence_page
     and old.region_x is not distinct from new.region_x
     and old.region_y is not distinct from new.region_y
  then
    return null;
  end if;

  select coalesce(max(revision), 0) + 1 into v_next
    from public.quote_term_revisions where quote_term_id = new.id;

  insert into public.quote_term_revisions (
    organization_id, quote_term_id, insurer_response_id, revision, term_type, label,
    extracted_value, corrected_value, corrected_by, corrected_at, amount, currency, unclear,
    evidence_document_id, evidence_page, region_x, region_y, region_width, region_height, sha256)
  values (new.organization_id, new.id, new.insurer_response_id, v_next, new.term_type, new.label,
          new.extracted_value, new.corrected_value, new.corrected_by, new.corrected_at,
          new.amount, new.currency, new.unclear, new.evidence_document_id, new.evidence_page,
          new.region_x, new.region_y, new.region_width, new.region_height, v_digest);
  return null;
end $$;
revoke all on function app.mint_quote_term_revision() from public;

create trigger quote_terms_mint_revision
  after insert or update on quote_terms
  for each row execute function app.mint_quote_term_revision();

/*
 * Immutable means immutable. There is no update grant below, and this refuses the write even from
 * a role that has one — a revision that can be edited is not a record of anything.
 *
 * With one exception, and it is not a loophole: the `on delete set null` links above. Offboarding
 * hard-deletes a brokerage's rows, and the revision must survive that deletion while ceasing to
 * point at something gone. That write only ever nulls a link; every recorded value is untouched,
 * and the check below says so rather than trusting the foreign key to behave.
 */
create or replace function app.revisions_are_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.sha256 = old.sha256
     and to_jsonb(new) - 'quote_term_id' - 'insurer_response_id'
         = to_jsonb(old) - 'quote_term_id' - 'insurer_response_id'
     and (new.quote_term_id is null or new.quote_term_id is not distinct from old.quote_term_id)
     and (new.insurer_response_id is null
          or new.insurer_response_id is not distinct from old.insurer_response_id)
  then
    return new;  -- The parent row was deleted. Nothing this revision recorded has changed.
  end if;

  raise exception 'A revision records what was said at one moment and cannot be changed.'
    using errcode = 'restrict_violation';
end $$;
revoke all on function app.revisions_are_immutable() from public;

create trigger quote_term_revisions_immutable
  before update or delete on quote_term_revisions
  for each row execute function app.revisions_are_immutable();

/* The response table has no `quote_term_id`; its own check is the same rule, one column fewer. */
create or replace function app.response_revisions_are_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.sha256 = old.sha256
     and to_jsonb(new) - 'insurer_response_id' = to_jsonb(old) - 'insurer_response_id'
     and new.insurer_response_id is null
  then
    return new;
  end if;

  raise exception 'A revision records what was said at one moment and cannot be changed.'
    using errcode = 'restrict_violation';
end $$;
revoke all on function app.response_revisions_are_immutable() from public;

create trigger insurer_response_revisions_immutable
  before update or delete on insurer_response_revisions
  for each row execute function app.response_revisions_are_immutable();

/* ---------------------------------------------------------------------------------------------
 * Backfill: every row that exists now gets its revision 1.
 *
 * Written before the comparison columns below so those can point at something. A comparison whose
 * digest no longer matches the row is one whose compared values predate this migration and cannot
 * be recovered — it is left unlinked and said to be so, rather than quietly pointed at a revision
 * holding today's figures, which is the exact lie this migration exists to end.
 */
insert into insurer_response_revisions (
  organization_id, insurer_response_id, opportunity_id, revision, outcome, received_at,
  premium_amount, premium_currency, valid_until, decline_reason,
  source_email_message_id, source_document_id, source_note, sha256)
select r.organization_id, r.id, r.opportunity_id, 1, r.outcome, r.received_at,
       r.premium_amount, r.premium_currency, r.valid_until, r.decline_reason,
       r.source_email_message_id, r.source_document_id, r.source_note,
       app.insurer_response_digest(r.outcome, r.premium_amount, r.premium_currency, r.valid_until)
  from insurer_responses r;

insert into quote_term_revisions (
  organization_id, quote_term_id, insurer_response_id, revision, term_type, label,
  extracted_value, corrected_value, corrected_by, corrected_at, amount, currency, unclear,
  evidence_document_id, evidence_page, sha256)
select t.organization_id, t.id, t.insurer_response_id, 1, t.term_type, t.label,
       t.extracted_value, t.corrected_value, t.corrected_by, t.corrected_at,
       t.amount, t.currency, t.unclear, t.evidence_document_id, t.evidence_page,
       app.quote_term_digest(t.term_type, t.label, t.extracted_value, t.corrected_value,
                             t.amount, t.currency, t.unclear)
  from quote_terms t;

/* ---------------------------------------------------------------------------------------------
 * The comparison points at revisions.
 */
alter table quote_comparison_inputs
  add column response_revision_id uuid references insurer_response_revisions(id);
create index quote_comparison_inputs_response_revision_id_idx
  on quote_comparison_inputs (response_revision_id);

alter table quote_comparison_terms
  add column term_revision_id uuid references quote_term_revisions(id);
create index quote_comparison_terms_term_revision_id_idx
  on quote_comparison_terms (term_revision_id);

update quote_comparison_inputs i
   set response_revision_id = rev.id
  from insurer_response_revisions rev
 where rev.insurer_response_id = i.insurer_response_id
   and rev.sha256 = i.response_sha256;

update quote_comparison_terms t
   set term_revision_id = rev.id
  from quote_term_revisions rev
 where rev.quote_term_id = t.quote_term_id
   and rev.sha256 = t.term_sha256;

/* A comparison made before revisions existed, whose rows have since moved, says so. */
update quote_comparisons c
   set superseded_at = coalesce(c.superseded_at, now()),
       superseded_reason = coalesce(
         c.superseded_reason,
         'This comparison was made before ASAP kept the exact values it compared. What it showed cannot be recovered.')
 where exists (select 1 from quote_comparison_inputs i
                where i.comparison_id = c.id and i.response_revision_id is null);

/*
 * From here on a comparison input without a revision is a defect, not a possibility. Enforced by
 * trigger rather than NOT NULL so the pre-migration rows above keep their honest null.
 */
create or replace function app.comparison_inputs_name_a_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.response_revision_id is null then
    raise exception 'A comparison must say which revision of the answer it compared.'
      using errcode = 'not_null_violation';
  end if;
  return new;
end $$;
revoke all on function app.comparison_inputs_name_a_revision() from public;

create trigger quote_comparison_inputs_name_a_revision
  before insert on quote_comparison_inputs
  for each row execute function app.comparison_inputs_name_a_revision();

create or replace function app.comparison_terms_name_a_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.term_revision_id is null then
    raise exception 'A comparison must say which revision of the term it compared.'
      using errcode = 'not_null_violation';
  end if;
  return new;
end $$;
revoke all on function app.comparison_terms_name_a_revision() from public;

create trigger quote_comparison_terms_name_a_revision
  before insert on quote_comparison_terms
  for each row execute function app.comparison_terms_name_a_revision();

/*
 * Regenerating makes a new version rather than a replacement, and the number is the database's:
 * two people pressing at once must not both be version 3.
 */
alter table quote_comparisons add column version integer;

with numbered as (
  select id, row_number() over (partition by opportunity_id order by generated_at, id) as n
    from quote_comparisons)
update quote_comparisons c set version = numbered.n from numbered where numbered.id = c.id;

create or replace function app.number_the_comparison()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  select coalesce(max(version), 0) + 1 into new.version
    from public.quote_comparisons where opportunity_id = new.opportunity_id;
  return new;
end $$;
revoke all on function app.number_the_comparison() from public;

create trigger quote_comparisons_number_it
  before insert on quote_comparisons
  for each row execute function app.number_the_comparison();

alter table quote_comparisons
  add constraint quote_comparisons_one_per_version unique (opportunity_id, version);

/* ---------------------------------------------------------------------------------------------
 * Tenancy. Revisions are business records and carry business values: same RLS, no deletes.
 */
alter table insurer_response_revisions enable row level security;
alter table quote_term_revisions enable row level security;

create policy tenant_select on insurer_response_revisions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on insurer_response_revisions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_select on quote_term_revisions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on quote_term_revisions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

grant select, insert on insurer_response_revisions to authenticated, asap_worker;
grant select, insert on quote_term_revisions to authenticated, asap_worker;
revoke update, delete on insurer_response_revisions, quote_term_revisions
  from asap_worker, authenticated;
