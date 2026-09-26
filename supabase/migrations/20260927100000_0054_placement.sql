-- 0054 — Placement: what the client instructed, what was frozen, what was sent, what came back.
--
-- The whole of this migration is one refusal: **no step may be inferred from the step before it.**
-- A recommendation is not a client decision. A client decision is not an approved request. An
-- approved request is not a submitted one. A submitted request is not confirmed cover. Confirmed
-- cover is not an issued policy. Each of those collapses is a way a broker ends up telling a
-- client they are covered when they are not, so each is a constraint here rather than a habit.
--
-- The second rule is that a placement freezes what the client accepted. 0051 made quote readings
-- immutable and comparisons reproducible; this points at those revisions rather than at the rows,
-- so a premium revised next week cannot change what the client instructed last week.

/* ---------------------------------------------------------------------------------------------
 * What the client actually said.
 *
 * Not a click. An instruction names how it arrived — an email, a document, a telephone call a
 * person took and wrote down, a signed acceptance — and the constraint below refuses one that
 * does not. A broker pressing a button is a broker pressing a button; it becomes evidence of the
 * client's decision only when the broker says where the decision came from.
 */
create table client_instructions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  -- The exact comparison version the client was shown. Null only for the recorded exception below.
  comparison_id     uuid references quote_comparisons(id),
  -- What they chose, as it stood when they chose it.
  insurer_response_id  uuid not null references insurer_responses(id) on delete cascade,
  response_revision_id uuid not null references insurer_response_revisions(id),
  source            text not null check (source in
                      ('email','document','telephone','meeting','signed_acceptance','in_person')),
  -- Where to find it. A telephone instruction has no attachment, so a note is evidence too — but
  -- then the note is required, and it carries the person, the time and what was said.
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  evidence_document_id      uuid references documents(id) on delete set null,
  evidence_note     text,
  -- What the client asked to be different. Carried into the request rather than lost.
  client_conditions text,
  instructed_at     timestamptz not null,
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  -- Set when the insurer or a material term changed afterwards: this instruction no longer
  -- describes what is being placed, and a new one is needed.
  superseded_at     timestamptz,
  superseded_reason text,
  /*
   * The exception path. A client may instruct a quote that was not in the comparison they were
   * shown — it happens — but it is never the ordinary route, so it needs a person with the
   * permission, a reason and evidence, and it is marked for ever.
   */
  outside_comparison boolean not null default false,
  exception_reason  text,
  exception_by      uuid references users(id),
  constraint client_instructions_evidence_is_required check (
    evidence_email_message_id is not null
    or evidence_document_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 10)),
  constraint client_instructions_superseded_is_whole check (
    (superseded_at is null and superseded_reason is null)
    or (superseded_at is not null
        and superseded_reason is not null and length(btrim(superseded_reason)) > 0)),
  /* An instruction outside the comparison says why and who allowed it, or it is not recorded. */
  constraint client_instructions_exception_is_whole check (
    (not outside_comparison and exception_reason is null and exception_by is null)
    or (outside_comparison
        and exception_reason is not null and length(btrim(exception_reason)) >= 10
        and exception_by is not null)),
  /* And an ordinary instruction names the comparison the client was actually shown. */
  constraint client_instructions_names_the_comparison check (
    outside_comparison or comparison_id is not null)
);
create index client_instructions_organization_id_idx on client_instructions (organization_id);
create index client_instructions_opportunity_id_idx on client_instructions (opportunity_id);
create index client_instructions_client_id_idx on client_instructions (client_id);
create index client_instructions_comparison_id_idx on client_instructions (comparison_id);
create index client_instructions_insurer_response_id_idx on client_instructions (insurer_response_id);
create index client_instructions_response_revision_id_idx on client_instructions (response_revision_id);
create index client_instructions_evidence_document_id_idx on client_instructions (evidence_document_id);
create index client_instructions_evidence_email_message_id_idx on client_instructions (evidence_email_message_id);
create index client_instructions_recorded_by_idx on client_instructions (recorded_by);
create index client_instructions_exception_by_idx on client_instructions (exception_by);
-- One live instruction per opportunity. Changing the choice supersedes the old one, never forks.
create unique index client_instructions_one_live_per_opportunity
  on client_instructions (opportunity_id) where superseded_at is null;

comment on table client_instructions is
  'What the client said, how it arrived, and exactly which quote and revision they accepted.';

/* ---------------------------------------------------------------------------------------------
 * The placement attempt.
 *
 * One client instruction, one insurer, one attempt to put the cover on risk. There is no status
 * column: where it has got to is read from the rows below — instruction, request, approval,
 * submission, confirmation — exactly as everywhere else (D-027).
 */
create table placements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  client_instruction_id uuid not null references client_instructions(id),
  insurer_id        uuid not null references insurers(id),
  work_item_id      uuid not null references work_items(id) on delete cascade,
  -- When cover is asked to begin. The client's, not the insurer's; the insurer confirms its own.
  requested_effective_at timestamptz not null,
  requested_expiry_at    timestamptz,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  abandoned_at      timestamptz,
  abandoned_reason  text,
  constraint placements_abandoned_is_whole check (
    (abandoned_at is null and abandoned_reason is null)
    or (abandoned_at is not null
        and abandoned_reason is not null and length(btrim(abandoned_reason)) > 0)),
  constraint placements_period_is_ordered check (
    requested_expiry_at is null or requested_expiry_at > requested_effective_at),
  -- One live attempt per instruction. A second is a second instruction, not a second attempt.
  constraint placements_one_per_instruction unique (client_instruction_id)
);
create index placements_organization_id_idx on placements (organization_id);
create index placements_opportunity_id_idx on placements (opportunity_id);
create index placements_client_id_idx on placements (client_id);
create index placements_insurer_id_idx on placements (insurer_id);
create index placements_work_item_id_idx on placements (work_item_id);
create index placements_created_by_idx on placements (created_by);

comment on table placements is
  'One client instruction, one insurer, one attempt to put cover on risk. It stores no status.';

/* ---------------------------------------------------------------------------------------------
 * The frozen basis: exactly what the client accepted, copied once and never touched again.
 *
 * Pointing at the live rows would mean a premium revised next week silently rewriting what the
 * client agreed to. Pointing only at digests would prove that it changed without being able to
 * show what it was. So the terms are copied, by revision, at the moment the placement is created.
 */
create table placement_basis_terms (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  quote_term_revision_id uuid not null references quote_term_revisions(id),
  term_type         text not null,
  label             text not null,
  value             text,
  amount            numeric(14,2),
  currency          text,
  unclear           boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint placement_basis_terms_one_per_revision unique (placement_id, quote_term_revision_id)
);
create index placement_basis_terms_organization_id_idx on placement_basis_terms (organization_id);
create index placement_basis_terms_placement_id_idx on placement_basis_terms (placement_id);
create index placement_basis_terms_quote_term_revision_id_idx
  on placement_basis_terms (quote_term_revision_id);

/* The response-level half of the basis: premium, currency, validity, as accepted. */
alter table placements
  add column basis_premium_amount   numeric(14,2),
  add column basis_premium_currency text,
  add column basis_valid_until      date,
  add column basis_sha256           text check (basis_sha256 is null or length(basis_sha256) = 64);

/* ---------------------------------------------------------------------------------------------
 * The request, versioned. Every version immutable once written.
 */
create table placement_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  version           integer not null check (version >= 1),
  subject           text not null check (length(btrim(subject)) > 0),
  body_text         text not null check (length(btrim(body_text)) > 0),
  -- What the request asks the insurer to do, kept apart from the prose so it can be checked.
  cover_requested   text not null check (length(btrim(cover_requested)) > 0),
  effective_at      timestamptz not null,
  outstanding_conditions text,
  -- The canonical digest of this version. Computed by the database; see the trigger below.
  sha256            text not null check (length(sha256) = 64),
  prepared_by       uuid not null references users(id),
  prepared_at       timestamptz not null default now(),
  -- Set when a newer version replaces it, or when the quote it rests on moved underneath it.
  superseded_at     timestamptz,
  superseded_reason text,
  constraint placement_requests_one_per_version unique (placement_id, version),
  constraint placement_requests_superseded_is_whole check (
    (superseded_at is null and superseded_reason is null)
    or (superseded_at is not null
        and superseded_reason is not null and length(btrim(superseded_reason)) > 0))
);
create index placement_requests_organization_id_idx on placement_requests (organization_id);
create index placement_requests_placement_id_idx on placement_requests (placement_id);
create index placement_requests_prepared_by_idx on placement_requests (prepared_by);
create unique index placement_requests_one_live_per_placement
  on placement_requests (placement_id) where superseded_at is null;

comment on table placement_requests is
  'One version of what would be sent to the insurer. Immutable once written; a change is a new version.';

/* ---------------------------------------------------------------------------------------------
 * Approvals of one exact request version. The same shape as 0049, for the same reason.
 */
create table placement_request_approvals (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_request_id uuid not null references placement_requests(id) on delete cascade,
  -- The digest the approval covers. Checked against the request's own; see the trigger.
  sha256            text not null check (length(sha256) = 64),
  approved_by       uuid not null references users(id),
  approved_at       timestamptz not null default now(),
  superseded_at     timestamptz,
  superseded_reason text,
  constraint placement_request_approvals_superseded_is_whole check (
    (superseded_at is null and superseded_reason is null)
    or (superseded_at is not null
        and superseded_reason is not null and length(btrim(superseded_reason)) > 0))
);
create index placement_request_approvals_organization_id_idx
  on placement_request_approvals (organization_id);
create index placement_request_approvals_placement_request_id_idx
  on placement_request_approvals (placement_request_id);
create index placement_request_approvals_approved_by_idx on placement_request_approvals (approved_by);
create unique index placement_request_approvals_one_live_per_request
  on placement_request_approvals (placement_request_id) where superseded_at is null;

/* ---------------------------------------------------------------------------------------------
 * Submission: only where something actually left the brokerage.
 *
 * Nothing in this deployment can send, so the only honest path today is a person recording that
 * they sent it themselves, with how and to whom. The provider path is here because it is the
 * shape a real integration will take, and a `sent_at` without one of the two is refused.
 */
create table placement_submissions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_request_id uuid not null references placement_requests(id) on delete cascade,
  -- The digest of the request version that was sent. Not the current one: the one that went.
  sha256            text not null check (length(sha256) = 64),
  method            text not null check (method in
                      ('provider_email','recorded_manual_email','recorded_portal','recorded_post','recorded_in_person')),
  -- A provider's own id, when a sending integration ever exists. Never fabricated.
  provider_message_id uuid references email_messages(id) on delete set null,
  recipient         text not null check (length(btrim(recipient)) > 0),
  sent_at           timestamptz not null,
  -- What proves it: a document, an email already on file, or a person's account of sending it.
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_note     text,
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  -- The same intent retried carries the same key, so a double click records one submission.
  idempotency_key   text not null check (length(btrim(idempotency_key)) between 8 and 200),
  constraint placement_submissions_one_per_key unique (organization_id, idempotency_key),
  /*
   * The rule this table exists for. A provider submission needs the provider's own message id;
   * anything a person recorded needs evidence — a document, or an account of at least a
   * sentence. Free text saying "sent" with nothing behind it is not a submission.
   */
  constraint placement_submissions_needs_proof check (
    (method = 'provider_email' and provider_message_id is not null)
    or (method <> 'provider_email'
        and (evidence_document_id is not null
             or (evidence_note is not null and length(btrim(evidence_note)) >= 10))))
);
create index placement_submissions_organization_id_idx on placement_submissions (organization_id);
create index placement_submissions_placement_request_id_idx
  on placement_submissions (placement_request_id);
create index placement_submissions_provider_message_id_idx
  on placement_submissions (provider_message_id);
create index placement_submissions_evidence_document_id_idx
  on placement_submissions (evidence_document_id);
create index placement_submissions_recorded_by_idx on placement_submissions (recorded_by);
-- One submission per request version. Sending it again is a new version, not a second send.
create unique index placement_submissions_one_per_request
  on placement_submissions (placement_request_id);

comment on table placement_submissions is
  'Proof that a request left the brokerage. Never written without a provider id or human evidence.';

/* ---------------------------------------------------------------------------------------------
 * What the insurer said back.
 */
create table placement_insurer_responses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  placement_submission_id uuid references placement_submissions(id) on delete set null,
  outcome           text not null check (outcome in
                      ('confirmed_as_requested','confirmed_with_changes','more_information_required',
                       'declined')),
  received_at       timestamptz not null,
  -- Confirmed cover: when it begins, and when it ends where the insurer said.
  effective_at      timestamptz,
  expiry_at         timestamptz,
  -- The insurer's own reference for the cover. A cover note number, a policy number to come.
  insurer_reference text,
  -- What they changed, what they need, or why they declined. Required by the outcome, below.
  changes_note      text,
  information_required text,
  decline_reason    text,
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  evidence_note     text,
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  superseded_at     timestamptz,
  superseded_reason text,
  constraint placement_insurer_responses_superseded_is_whole check (
    (superseded_at is null and superseded_reason is null)
    or (superseded_at is not null
        and superseded_reason is not null and length(btrim(superseded_reason)) > 0)),
  /* A confirmation says when cover begins. Without that there is no cover, only a letter. */
  constraint placement_insurer_responses_confirmed_needs_a_start check (
    outcome not in ('confirmed_as_requested','confirmed_with_changes') or effective_at is not null),
  /* And it is evidenced. "They confirmed" with nothing behind it is not a confirmation. */
  constraint placement_insurer_responses_confirmed_needs_evidence check (
    outcome not in ('confirmed_as_requested','confirmed_with_changes')
    or evidence_document_id is not null
    or evidence_email_message_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 10)),
  constraint placement_insurer_responses_changes_are_named check (
    outcome <> 'confirmed_with_changes'
    or (changes_note is not null and length(btrim(changes_note)) >= 10)),
  constraint placement_insurer_responses_query_is_named check (
    outcome <> 'more_information_required'
    or (information_required is not null and length(btrim(information_required)) >= 5)),
  constraint placement_insurer_responses_decline_has_a_reason check (
    outcome <> 'declined' or (decline_reason is not null and length(btrim(decline_reason)) >= 5)),
  constraint placement_insurer_responses_period_is_ordered check (
    expiry_at is null or effective_at is null or expiry_at > effective_at)
);
create index placement_insurer_responses_organization_id_idx
  on placement_insurer_responses (organization_id);
create index placement_insurer_responses_placement_id_idx on placement_insurer_responses (placement_id);
create index placement_insurer_responses_placement_submission_id_idx
  on placement_insurer_responses (placement_submission_id);
create index placement_insurer_responses_evidence_document_id_idx
  on placement_insurer_responses (evidence_document_id);
create index placement_insurer_responses_evidence_email_message_id_idx
  on placement_insurer_responses (evidence_email_message_id);
create index placement_insurer_responses_recorded_by_idx on placement_insurer_responses (recorded_by);
create unique index placement_insurer_responses_one_live_per_placement
  on placement_insurer_responses (placement_id) where superseded_at is null;

/* ---------------------------------------------------------------------------------------------
 * Cancellation, which is the one cover fact that is not an insurer response.
 */
create table placement_cancellations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  placement_id      uuid not null references placements(id) on delete cascade,
  cancelled_at      timestamptz not null,
  reason            text not null check (length(btrim(reason)) >= 5),
  evidence_document_id uuid references documents(id) on delete set null,
  evidence_email_message_id uuid references email_messages(id) on delete set null,
  evidence_note     text,
  recorded_by       uuid not null references users(id),
  recorded_at       timestamptz not null default now(),
  constraint placement_cancellations_one_per_placement unique (placement_id),
  constraint placement_cancellations_needs_evidence check (
    evidence_document_id is not null
    or evidence_email_message_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 10))
);
create index placement_cancellations_organization_id_idx on placement_cancellations (organization_id);
create index placement_cancellations_placement_id_idx on placement_cancellations (placement_id);
create index placement_cancellations_evidence_document_id_idx
  on placement_cancellations (evidence_document_id);
create index placement_cancellations_evidence_email_message_id_idx
  on placement_cancellations (evidence_email_message_id);
create index placement_cancellations_recorded_by_idx on placement_cancellations (recorded_by);

/* ---------------------------------------------------------------------------------------------
 * The digest a placement approval covers, and the rules that keep it honest.
 */
create or replace function app.placement_request_digest(
  p_subject text, p_body text, p_cover text, p_effective timestamptz, p_conditions text)
returns text language sql immutable security invoker set search_path = '' as $$
  select encode(extensions.digest(
    concat_ws(chr(30), coalesce(p_subject, ''), coalesce(p_body, ''), coalesce(p_cover, ''),
              coalesce(p_effective::text, ''), coalesce(p_conditions, '')), 'sha256'), 'hex')
$$;
revoke all on function app.placement_request_digest(text, text, text, timestamptz, text) from public;
grant execute on function app.placement_request_digest(text, text, text, timestamptz, text)
  to authenticated, asap_worker;

/*
 * A request version is immutable. Editing one is preparing a new version, and the route does
 * exactly that; this refuses the shortcut, including from a role that holds the grant. The one
 * write allowed is superseding it, which changes no content.
 */
create or replace function app.placement_requests_are_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.sha256 = new.sha256
     and old.subject = new.subject and old.body_text = new.body_text
     and old.cover_requested = new.cover_requested and old.effective_at = new.effective_at
     and old.outstanding_conditions is not distinct from new.outstanding_conditions
  then
    return new;  -- Superseding, or nothing. No content moved.
  end if;
  raise exception 'A placement request version cannot be edited. Prepare a new version.'
    using errcode = 'restrict_violation';
end $$;
revoke all on function app.placement_requests_are_immutable() from public;

create trigger placement_requests_immutable
  before update on placement_requests
  for each row execute function app.placement_requests_are_immutable();

/* The digest is the database's, computed from the row, so no caller can hand in a wrong one. */
create or replace function app.placement_request_digest_is_the_rows()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.sha256 := app.placement_request_digest(
    new.subject, new.body_text, new.cover_requested, new.effective_at, new.outstanding_conditions);
  return new;
end $$;
revoke all on function app.placement_request_digest_is_the_rows() from public;

create trigger placement_requests_digest_is_the_rows
  before insert on placement_requests
  for each row execute function app.placement_request_digest_is_the_rows();

/*
 * Numbered by the database: two people preparing at once must not both be version 3, and the
 * older live version is superseded by the newer rather than sitting beside it.
 */
create or replace function app.number_the_placement_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  select coalesce(max(version), 0) + 1 into new.version
    from public.placement_requests where placement_id = new.placement_id;

  update public.placement_requests
     set superseded_at = now(),
         superseded_reason = 'A newer version of this request was prepared.'
   where placement_id = new.placement_id and superseded_at is null;

  return new;
end $$;
revoke all on function app.number_the_placement_request() from public;

create trigger placement_requests_number_it
  before insert on placement_requests
  for each row execute function app.number_the_placement_request();

/*
 * And the approval follows the version. Superseding a request version stales the approval that
 * covered it, so an edit can never leave permission standing over content nobody approved —
 * which is the same rule as 0049, one level up.
 */
create or replace function app.placement_approval_follows_the_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.superseded_at is not null and old.superseded_at is null then
    update public.placement_request_approvals
       set superseded_at = now(),
           superseded_reason = 'The request was changed after it was approved.'
     where placement_request_id = new.id and superseded_at is null;
  end if;
  return new;
end $$;
revoke all on function app.placement_approval_follows_the_version() from public;

create trigger placement_requests_approval_follows
  after update on placement_requests
  for each row execute function app.placement_approval_follows_the_version();

/* An approval must describe the version it claims to approve. */
create or replace function app.placement_approval_covers_the_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_digest text;
begin
  select sha256 into v_digest from public.placement_requests where id = new.placement_request_id;
  if v_digest is null or v_digest <> new.sha256 then
    raise exception 'An approval must cover the exact request it approves.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function app.placement_approval_covers_the_request() from public;

create trigger placement_request_approvals_cover_the_request
  before insert on placement_request_approvals
  for each row execute function app.placement_approval_covers_the_request();

/*
 * Nothing is submitted that was not approved, and what is submitted is what was approved. Both
 * halves matter: the first stops a draft going out, the second stops the approved text being
 * swapped for another before it goes.
 */
create or replace function app.submission_needs_a_live_approval()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_digest text;
begin
  select a.sha256 into v_digest
    from public.placement_request_approvals a
   where a.placement_request_id = new.placement_request_id and a.superseded_at is null;

  if v_digest is null then
    raise exception 'This request has not been approved, so it cannot be recorded as sent.'
      using errcode = 'check_violation';
  end if;
  if v_digest <> new.sha256 then
    raise exception 'What was sent is not what was approved.' using errcode = 'check_violation';
  end if;

  /*
   * And the quotation the client accepted must still be the quotation on file. If the insurer
   * has revised it since — a new premium, a changed excess — the frozen basis no longer
   * describes an offer that exists, and sending a request against it would ask the insurer to
   * bind terms it has withdrawn. The route says which term moved; this makes sure no route can
   * skip the check.
   */
  if exists (
    select 1
      from public.placement_requests r
      join public.placements p on p.id = r.placement_id
      join public.client_instructions ci on ci.id = p.client_instruction_id
     where r.id = new.placement_request_id
       and ci.response_revision_id is distinct from (
         select rev.id from public.insurer_response_revisions rev
          where rev.insurer_response_id = ci.insurer_response_id
          order by rev.revision desc limit 1))
  then
    raise exception 'The quotation has changed since the client accepted it. Nothing can be sent until the change is reviewed.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function app.submission_needs_a_live_approval() from public;

create trigger placement_submissions_need_an_approval
  before insert on placement_submissions
  for each row execute function app.submission_needs_a_live_approval();

/* And an insurer's answer needs something to have been sent to it. */
create or replace function app.confirmation_needs_a_submission()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.placement_submissions s
      join public.placement_requests r on r.id = s.placement_request_id
     where r.placement_id = new.placement_id)
  then
    raise exception 'Nothing has been sent to the insurer for this placement yet.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function app.confirmation_needs_a_submission() from public;

create trigger placement_insurer_responses_need_a_submission
  before insert on placement_insurer_responses
  for each row execute function app.confirmation_needs_a_submission();

/* ---------------------------------------------------------------------------------------------
 * Tenancy. A placement is the record of a promise about cover; nothing deletes one.
 */
alter table client_instructions enable row level security;
alter table placements enable row level security;
alter table placement_basis_terms enable row level security;
alter table placement_requests enable row level security;
alter table placement_request_approvals enable row level security;
alter table placement_submissions enable row level security;
alter table placement_insurer_responses enable row level security;
alter table placement_cancellations enable row level security;

create policy tenant_select on client_instructions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on client_instructions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));
create policy tenant_update on client_instructions for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on placements for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placements for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on placements for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on placement_basis_terms for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_basis_terms for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

create policy tenant_select on placement_requests for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_requests for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));
create policy tenant_update on placement_requests for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on placement_request_approvals for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_request_approvals for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and approved_by = (select auth.uid()));
create policy tenant_supersede on placement_request_approvals for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on placement_submissions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_submissions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));

create policy tenant_select on placement_insurer_responses for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_insurer_responses for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));
create policy tenant_update on placement_insurer_responses for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on placement_cancellations for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on placement_cancellations for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and recorded_by = (select auth.uid()));

grant select, insert, update on client_instructions to authenticated, asap_worker;
grant select, insert, update on placements to authenticated, asap_worker;
grant select, insert on placement_basis_terms to authenticated, asap_worker;
grant select, insert, update on placement_requests to authenticated, asap_worker;
grant select, insert, update on placement_request_approvals to authenticated, asap_worker;
grant select, insert on placement_submissions to authenticated, asap_worker;
grant select, insert, update on placement_insurer_responses to authenticated, asap_worker;
grant select, insert on placement_cancellations to authenticated, asap_worker;

revoke delete on client_instructions, placements, placement_basis_terms, placement_requests,
  placement_request_approvals, placement_submissions, placement_insurer_responses,
  placement_cancellations from asap_worker, authenticated;
revoke update on placement_basis_terms, placement_submissions, placement_cancellations
  from asap_worker, authenticated;
