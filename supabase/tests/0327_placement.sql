-- pgTAP: placement cannot collapse one step into the next (0054).
--
-- Each assertion here is one of the lies a placement flow can tell a client:
--
--   * a click becomes a client decision — an instruction needs evidence of how it arrived;
--   * a quote the client never saw becomes their choice — outside the comparison needs a reason,
--     evidence and the person who allowed it;
--   * a draft is treated as sent — nothing is submitted without a live approval of that digest;
--   * the approved text is swapped before sending — the digest sent must be the digest approved;
--   * an edit keeps its approval — superseding a version stales the approval covering it;
--   * a moved quotation is sent anyway — a revised quote blocks submission;
--   * "sent" with nothing behind it — submission needs a provider id or human evidence;
--   * a confirmation with no start, or no evidence, or changed terms not named;
--   * and one brokerage reaches none of another's, and nothing is deleted.
begin;
select plan(39);

/*
 * Every write here is the API's, on the person's behalf: placement records are written through
 * the API only (0056), so the session carries the server-held key. 0329 proves a browser session
 * without it is refused.
 */
create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-0327');

/* How many policies exist before anything here runs. Compared at the end, not against a clock:
 * a time window passes or fails depending on how recently the seed was loaded. */
create temp table policies_before on commit drop as
  select count(*)::int as n from policies where organization_id = '10000000-0000-4000-8000-00000000000a';
grant select on policies_before to authenticated;

select has_table('public', 'client_instructions', 'client_instructions exists');
select has_table('public', 'placements', 'placements exists');
select has_table('public', 'placement_requests', 'placement_requests exists');
select has_table('public', 'placement_submissions', 'placement_submissions exists');
select has_table('public', 'placement_insurer_responses', 'placement_insurer_responses exists');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    and c.relname in ('client_instructions','placements','placement_basis_terms','placement_requests',
      'placement_request_approvals','placement_submissions','placement_insurer_responses',
      'placement_cancellations')
$$, 'row level security is enabled on every placement table');

select is_empty($$
  select table_name || ':' || grantee from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'DELETE'
    and grantee in ('authenticated','asap_worker','anon')
    and table_name in ('client_instructions','placements','placement_basis_terms','placement_requests',
      'placement_request_approvals','placement_submissions','placement_insurer_responses',
      'placement_cancellations')
$$, 'a placement is the record of a promise about cover: nobody may delete any part of it');

select hasnt_column('public', 'placements', 'status', 'a placement stores no status');
select hasnt_column('public', 'placements', 'cover_status', 'nor a cover status: it is derived');

-- ---------------------------------------------------------------------------------------------
-- A quotation with two quotes, compared.

insert into work_items (id, organization_id, kind, title, task_status)
values ('e1100000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'new_business', 'Placement quotation', 'needs_you'),
       ('e1100000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'placement', 'Placement work', 'needs_you');
insert into insurers (id, organization_id, name)
values ('e1200000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Placement Insurer A'),
       ('e1200000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'Placement Insurer B');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('e1300000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e1100000-0000-4000-8000-00000000000a', 'Placement', 'Commercial motor',
        'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('e1400000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a', 'e1200000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001'),
       ('e1400000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a', 'e1200000-0000-4000-8000-00000000000b',
        'a0000000-0000-4000-8000-000000000001');
insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id,
                               outcome, received_at, source_note, premium_amount, premium_currency,
                               valid_until, recorded_by)
values ('e1500000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a', 'e1400000-0000-4000-8000-00000000000a',
        'quoted', now(), 'Quotation letter.', 5310000, 'KES', current_date + 60,
        'a0000000-0000-4000-8000-000000000001');
insert into quote_terms (id, organization_id, insurer_response_id, term_type, label, extracted_value)
values ('e1600000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1500000-0000-4000-8000-00000000000a', 'excess', 'Own damage', '5% min KES 30,000');

insert into quote_comparisons (id, organization_id, opportunity_id, generated_by)
values ('e1700000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------------------------
-- The client's instruction. A click is not one.

select throws_ok(
  $$insert into client_instructions (organization_id, opportunity_id, client_id, comparison_id,
                                     insurer_response_id, response_revision_id, source,
                                     instructed_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1300000-0000-4000-8000-00000000000a',
            (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
            'e1700000-0000-4000-8000-00000000000a', 'e1500000-0000-4000-8000-00000000000a',
            (select id from insurer_response_revisions where insurer_response_id = 'e1500000-0000-4000-8000-00000000000a'),
            'telephone', now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an instruction with no evidence of how it arrived is refused');

select throws_ok(
  $$insert into client_instructions (organization_id, opportunity_id, client_id, comparison_id,
                                     insurer_response_id, response_revision_id, source,
                                     evidence_note, instructed_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1300000-0000-4000-8000-00000000000a',
            (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
            null, 'e1500000-0000-4000-8000-00000000000a',
            (select id from insurer_response_revisions where insurer_response_id = 'e1500000-0000-4000-8000-00000000000a'),
            'telephone', 'Client rang and chose insurer A on the call.', now(),
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an ordinary instruction must name the comparison the client was shown');

select throws_ok(
  $$insert into client_instructions (organization_id, opportunity_id, client_id,
                                     insurer_response_id, response_revision_id, source,
                                     evidence_note, instructed_at, recorded_by, outside_comparison)
    values ('10000000-0000-4000-8000-00000000000a', 'e1300000-0000-4000-8000-00000000000a',
            (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
            'e1500000-0000-4000-8000-00000000000a',
            (select id from insurer_response_revisions where insurer_response_id = 'e1500000-0000-4000-8000-00000000000a'),
            'telephone', 'Client rang and chose insurer A on the call.', now(),
            'a0000000-0000-4000-8000-000000000001', true)$$,
  '23514', null, 'an instruction outside the comparison without a reason and an approver is refused');

insert into client_instructions (id, organization_id, opportunity_id, client_id, comparison_id,
                                 insurer_response_id, response_revision_id, source, evidence_note,
                                 instructed_at, recorded_by)
values ('e1800000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e1700000-0000-4000-8000-00000000000a', 'e1500000-0000-4000-8000-00000000000a',
        (select id from insurer_response_revisions where insurer_response_id = 'e1500000-0000-4000-8000-00000000000a'),
        'telephone', 'Client rang at 10:40 and chose insurer A on the terms shown.', now(),
        'a0000000-0000-4000-8000-000000000001');
select isnt(
  (select id from client_instructions where id = 'e1800000-0000-4000-8000-00000000000a'),
  null, 'a telephone instruction with a note of the call is recorded');

select throws_ok(
  $$insert into client_instructions (organization_id, opportunity_id, client_id, comparison_id,
                                     insurer_response_id, response_revision_id, source, evidence_note,
                                     instructed_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1300000-0000-4000-8000-00000000000a',
            (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
            'e1700000-0000-4000-8000-00000000000a', 'e1500000-0000-4000-8000-00000000000a',
            (select id from insurer_response_revisions where insurer_response_id = 'e1500000-0000-4000-8000-00000000000a'),
            'email', 'A second instruction recorded at the same time.', now(),
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one live instruction per opportunity: a change supersedes, it does not fork');

-- ---------------------------------------------------------------------------------------------
-- The placement and its frozen basis.

insert into placements (id, organization_id, opportunity_id, client_id, client_instruction_id,
                        insurer_id, work_item_id, requested_effective_at, created_by,
                        basis_premium_amount, basis_premium_currency)
values ('e1900000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e1800000-0000-4000-8000-00000000000a', 'e1200000-0000-4000-8000-00000000000a',
        'e1100000-0000-4000-8000-00000000000b', now() + interval '7 days',
        'a0000000-0000-4000-8000-000000000001', 5310000, 'KES');

insert into placement_basis_terms (organization_id, placement_id, quote_term_revision_id,
                                   term_type, label, value)
select organization_id, 'e1900000-0000-4000-8000-00000000000a', id, term_type, label,
       coalesce(corrected_value, extracted_value)
  from quote_term_revisions where quote_term_id = 'e1600000-0000-4000-8000-00000000000a';

select throws_ok(
  $$update placement_basis_terms set value = 'Something the client never saw'
     where placement_id = 'e1900000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'the frozen basis cannot be edited by anybody');

-- ---------------------------------------------------------------------------------------------
-- The request, and what may happen to it.

insert into placement_requests (id, organization_id, placement_id, version, subject, body_text,
                                cover_requested, effective_at, sha256, prepared_by)
values ('e1a00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'e1900000-0000-4000-8000-00000000000a', 99, 'Placement instruction', 'Please place cover.',
        'Commercial motor, fleet of five', now() + interval '7 days', repeat('0', 64),
        'a0000000-0000-4000-8000-000000000001');

select is(
  (select version from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'),
  1, 'a request version is numbered by the database, not by whoever wrote it');
select is(
  (select sha256 = app.placement_request_digest(subject, body_text, cover_requested, effective_at,
                                                 outstanding_conditions)
     from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'),
  true, 'and its digest is computed from its own content, not handed in');

select throws_ok(
  $$update placement_requests set body_text = 'Something else entirely.'
     where id = 'e1a00000-0000-4000-8000-00000000000a'$$,
  '23001', null, 'a request version cannot be edited: a change is a new version');

-- A draft cannot be recorded as sent.
select throws_ok(
  $$insert into placement_submissions (organization_id, placement_request_id, sha256, method,
                                       recipient, sent_at, evidence_note, recorded_by, idempotency_key)
    select organization_id, id, sha256, 'recorded_manual_email', 'underwriting@insurer-a.test', now(),
           'Sent from my own mailbox at 11:02.', 'a0000000-0000-4000-8000-000000000001', 'submit-draft-1'
      from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'an unapproved request cannot be recorded as sent');

-- An approval must describe the version it approves.
select throws_ok(
  $$insert into placement_request_approvals (organization_id, placement_request_id, sha256, approved_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1a00000-0000-4000-8000-00000000000a',
            repeat('f', 64), 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an approval whose digest does not match the request is refused');

insert into placement_request_approvals (organization_id, placement_request_id, sha256, approved_by)
select organization_id, id, sha256, 'a0000000-0000-4000-8000-000000000001'
  from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a';

select throws_ok(
  $$insert into placement_request_approvals (organization_id, placement_request_id, sha256, approved_by)
    select organization_id, id, sha256, 'a0000000-0000-4000-8000-000000000001'
      from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'$$,
  '23505', null, 'approving the same version twice records one approval');

-- "Sent" with nothing behind it.
select throws_ok(
  $$insert into placement_submissions (organization_id, placement_request_id, sha256, method,
                                       recipient, sent_at, evidence_note, recorded_by, idempotency_key)
    select organization_id, id, sha256, 'recorded_manual_email', 'underwriting@insurer-a.test', now(),
           'sent', 'a0000000-0000-4000-8000-000000000001', 'submit-bare-1'
      from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a manual submission with no real evidence is refused');

-- What was sent must be what was approved.
select throws_ok(
  $$insert into placement_submissions (organization_id, placement_request_id, sha256, method,
                                       recipient, sent_at, evidence_note, recorded_by, idempotency_key)
    select organization_id, id, repeat('e', 64), 'recorded_manual_email', 'underwriting@insurer-a.test',
           now(), 'Sent from my own mailbox at 11:02.', 'a0000000-0000-4000-8000-000000000001', 'submit-swap-1'
      from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a submission of text other than the approved text is refused');

-- An edit — a new version — stales the approval of the old one.
insert into placement_requests (organization_id, placement_id, version, subject, body_text,
                                cover_requested, effective_at, sha256, prepared_by)
values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000a', 1,
        'Placement instruction', 'Please place cover, amended.', 'Commercial motor, fleet of five',
        now() + interval '7 days', repeat('0', 64), 'a0000000-0000-4000-8000-000000000001');

select isnt(
  (select superseded_at from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000a'),
  null, 'preparing a new version supersedes the old one');
select isnt(
  (select superseded_at from placement_request_approvals
    where placement_request_id = 'e1a00000-0000-4000-8000-00000000000a'),
  null, 'and the approval that covered the old version is stale');
select is(
  (select count(*)::int from placement_request_approvals a
     join placement_requests r on r.id = a.placement_request_id
    where r.placement_id = 'e1900000-0000-4000-8000-00000000000a' and a.superseded_at is null),
  0, 'so nothing is approved until the new version is approved');

-- Approve the new version, then move the quotation underneath it.
insert into placement_request_approvals (organization_id, placement_request_id, sha256, approved_by)
select organization_id, id, sha256, 'a0000000-0000-4000-8000-000000000001'
  from placement_requests where placement_id = 'e1900000-0000-4000-8000-00000000000a' and superseded_at is null;

update insurer_responses set premium_amount = 5410000 where id = 'e1500000-0000-4000-8000-00000000000a';

select throws_ok(
  $$insert into placement_submissions (organization_id, placement_request_id, sha256, method,
                                       recipient, sent_at, evidence_note, recorded_by, idempotency_key)
    select organization_id, id, sha256, 'recorded_manual_email', 'underwriting@insurer-a.test', now(),
           'Sent from my own mailbox at 11:02.', 'a0000000-0000-4000-8000-000000000001', 'submit-moved-1'
      from placement_requests where placement_id = 'e1900000-0000-4000-8000-00000000000a' and superseded_at is null$$,
  '23514', null, 'a quotation revised since the client accepted it blocks submission');

select is(
  (select basis_premium_amount from placements where id = 'e1900000-0000-4000-8000-00000000000a'),
  5310000.00, 'the frozen premium is what the client accepted, not the revised one');

-- The revised quote needs a new client instruction against the revision that now exists. The old
-- one is superseded, not edited, so what the client first agreed to stays on the record.
update client_instructions set superseded_at = now(),
       superseded_reason = 'Insurer A revised its premium after the client accepted it.'
 where id = 'e1800000-0000-4000-8000-00000000000a';
insert into client_instructions (id, organization_id, opportunity_id, client_id, comparison_id,
                                 insurer_response_id, response_revision_id, source, evidence_email_message_id,
                                 evidence_note, instructed_at, recorded_by)
values ('e1800000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e1700000-0000-4000-8000-00000000000a', 'e1500000-0000-4000-8000-00000000000a',
        (select id from insurer_response_revisions where insurer_response_id = 'e1500000-0000-4000-8000-00000000000a'
          order by revision desc limit 1),
        'email', null, 'Client confirmed the revised premium by email.', now(),
        'a0000000-0000-4000-8000-000000000001');
insert into placements (id, organization_id, opportunity_id, client_id, client_instruction_id,
                        insurer_id, work_item_id, requested_effective_at, created_by)
values ('e1900000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'e1300000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'e1800000-0000-4000-8000-00000000000b', 'e1200000-0000-4000-8000-00000000000a',
        'e1100000-0000-4000-8000-00000000000b', now() - interval '1 day',
        'a0000000-0000-4000-8000-000000000001');
insert into placement_requests (id, organization_id, placement_id, version, subject, body_text,
                                cover_requested, effective_at, sha256, prepared_by)
values ('e1a00000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000a',
        'e1900000-0000-4000-8000-00000000000b', 1, 'Placement instruction', 'Please place cover.',
        'Commercial motor, fleet of five', now() - interval '1 day', repeat('0', 64),
        'a0000000-0000-4000-8000-000000000001');
insert into placement_request_approvals (organization_id, placement_request_id, sha256, approved_by)
select organization_id, id, sha256, 'a0000000-0000-4000-8000-000000000001'
  from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000c';

-- An insurer's answer needs something to have been sent.
select throws_ok(
  $$insert into placement_insurer_responses (organization_id, placement_id, outcome, received_at,
                                             effective_at, evidence_note, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000b',
            'confirmed_as_requested', now(), now(), 'Cover note received by email.',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an insurer cannot confirm what was never sent to it');

insert into placement_submissions (id, organization_id, placement_request_id, sha256, method,
                                   recipient, sent_at, evidence_note, recorded_by, idempotency_key)
select 'e1b00000-0000-4000-8000-00000000000a', organization_id, id, sha256, 'recorded_manual_email',
       'underwriting@insurer-a.test', now(), 'Sent from my own mailbox at 11:02, reference UW-1.',
       'a0000000-0000-4000-8000-000000000001', 'submit-good-1'
  from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000c';
select isnt(
  (select id from placement_submissions where id = 'e1b00000-0000-4000-8000-00000000000a'),
  null, 'an approved, unchanged request with evidence of sending is recorded as submitted');

select throws_ok(
  $$insert into placement_submissions (organization_id, placement_request_id, sha256, method,
                                       recipient, sent_at, evidence_note, recorded_by, idempotency_key)
    select organization_id, id, sha256, 'recorded_manual_email', 'underwriting@insurer-a.test', now(),
           'Sent again from my own mailbox.', 'a0000000-0000-4000-8000-000000000001', 'submit-good-1'
      from placement_requests where id = 'e1a00000-0000-4000-8000-00000000000c'$$,
  '23505', null, 'recording the same submission twice records one');

-- The insurer's answer.
select throws_ok(
  $$insert into placement_insurer_responses (organization_id, placement_id, outcome, received_at,
                                             evidence_note, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000b',
            'confirmed_as_requested', now(), 'Cover note received by email.',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a confirmation that does not say when cover begins is refused');

select throws_ok(
  $$insert into placement_insurer_responses (organization_id, placement_id, outcome, received_at,
                                             effective_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000b',
            'confirmed_as_requested', now(), now(), 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a confirmation with no evidence is refused');

select throws_ok(
  $$insert into placement_insurer_responses (organization_id, placement_id, outcome, received_at,
                                             effective_at, evidence_note, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000b',
            'confirmed_with_changes', now(), now(), 'Cover note received by email.',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a confirmation with changed terms must say what changed');

insert into placement_insurer_responses (organization_id, placement_id, outcome, received_at,
                                         effective_at, expiry_at, insurer_reference, evidence_note,
                                         recorded_by)
values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000b',
        'confirmed_as_requested', now(), now() - interval '1 day', now() + interval '364 days',
        'CN-2027-0041', 'Cover note CN-2027-0041 received by email at 14:10.',
        'a0000000-0000-4000-8000-000000000001');
select is(
  (select outcome from placement_insurer_responses
    where placement_id = 'e1900000-0000-4000-8000-00000000000b' and superseded_at is null),
  'confirmed_as_requested', 'an evidenced confirmation with a start is recorded');

-- No policy is created by confirming. That is 4B-5's, and a person's.
select is(
  (select count(*)::int from policies where organization_id = '10000000-0000-4000-8000-00000000000a')
    - (select n from policies_before),
  0, 'confirming cover creates no policy');

select throws_ok(
  $$insert into placement_cancellations (organization_id, placement_id, cancelled_at, reason, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'e1900000-0000-4000-8000-00000000000b',
            now(), 'Client withdrew.', 'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a cancellation with no evidence is refused');

-- ---------------------------------------------------------------------------------------------
-- Tenancy.

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from placements where opportunity_id = 'e1300000-0000-4000-8000-00000000000a'),
  0, 'another brokerage sees none of these placements');
select is(
  (select count(*)::int from client_instructions where opportunity_id = 'e1300000-0000-4000-8000-00000000000a'),
  0, 'nor any of these instructions');

select * from finish();
rollback;
