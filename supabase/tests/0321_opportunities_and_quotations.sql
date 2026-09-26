-- pgTAP: opportunities, insurer approaches and the terms that come back (0048).
--
-- What these prove, each of which is a way the lifecycle could tell a lie:
--
--   * a prepared request cannot say it was sent without a provider message id, and cannot be sent
--     at all without an approval;
--   * a quoted response must name where it came from — a blank row is not a received quote;
--   * silence carries no premium and no time;
--   * a declined response must say why;
--   * a term correction never destroys what was extracted;
--   * one live approach per insurer, so a double-clicked "add" cannot make two;
--   * one prepared request and one response per approach;
--   * nothing here can be deleted, by anybody;
--   * and one brokerage sees none of another's.
begin;
select plan(37);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shape.

select has_table('public', 'opportunities', 'opportunities exists');
select has_table('public', 'opportunity_requirements', 'opportunity_requirements exists');
select has_table('public', 'opportunity_insurers', 'opportunity_insurers exists');
select has_table('public', 'quote_requests', 'quote_requests exists');
select has_table('public', 'insurer_responses', 'insurer_responses exists');
select has_table('public', 'quote_terms', 'quote_terms exists');
select has_table('public', 'requirement_templates', 'requirement_templates exists');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('opportunities','opportunity_requirements','opportunity_insurers',
                      'quote_requests','insurer_responses','quote_terms','requirement_templates')
    and not c.relrowsecurity
$$, 'row level security is enabled on every new table');

-- Nothing here is erased: an opportunity that came to nothing is closed with a reason.
select is_empty($$
  select table_name || ':' || grantee from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'DELETE'
    and grantee in ('authenticated','asap_worker','anon')
    and table_name in ('opportunities','opportunity_requirements','opportunity_insurers',
                       'quote_requests','insurer_responses','quote_terms','requirement_templates')
$$, 'no tenant role may delete an opportunity, an approach, a request, a response or a term');

select is_empty($$
  select tablename || '.' || policyname from pg_policies
  where schemaname = 'public'
    and tablename in ('opportunities','opportunity_insurers','quote_requests','insurer_responses')
    and roles::text[] @> array['anon']
$$, 'no policy applies to anon');

-- A status column would let the screen and the facts drift apart (D-027).
select hasnt_column('public', 'opportunities', 'status', 'an opportunity stores no status');
select hasnt_column('public', 'opportunities', 'state', 'nor a state');

-- ---------------------------------------------------------------------------------------------
-- Brokerage A: a client needing cover.

/*
 * The work item and the insurers are written as the owner, because the product writes them that
 * way: `work_items` is engine-owned (0018, 0023) and no signed-in role inserts into it directly.
 * Everything this suite is actually testing is then done as a signed-in person.
 */
insert into work_items (id, organization_id, kind, title, task_status)
values ('f1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'new_business', 'Quotation work', 'needs_you');

insert into insurers (id, organization_id, name)
values ('f2000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Test Insurer A'),
       ('f2000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'Test Insurer B');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('f3000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'f1000000-0000-4000-8000-00000000000a', 'Fleet quotation — 2027', 'Commercial motor',
        'a0000000-0000-4000-8000-000000000001');

select is(
  (select title from opportunities where id = 'f3000000-0000-4000-8000-00000000000a'),
  'Fleet quotation — 2027',
  'an opportunity is recorded with the title a person gave it');

-- Half a period describes nothing.
select throws_ok(
  $$update opportunities set cover_start = '2027-01-01'
    where id = 'f3000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a cover period with only a start is refused');

-- Closing says what happened, and why.
select throws_ok(
  $$update opportunities set closed_at = now(), closed_outcome = 'lost'
    where id = 'f3000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'closing without a reason is refused');

-- ---------------------------------------------------------------------------------------------
-- Requirements: supplied means somebody named what proves it.

insert into opportunity_requirements (id, organization_id, opportunity_id, label)
values ('f4000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f3000000-0000-4000-8000-00000000000a', 'Vehicle schedule with declared values');

select throws_ok(
  $$update opportunity_requirements
      set supplied_at = now(), supplied_by = 'a0000000-0000-4000-8000-000000000001'
    where id = 'f4000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a requirement cannot be ticked without evidence');

update opportunity_requirements
   set supplied_at = now(), supplied_by = 'a0000000-0000-4000-8000-000000000001',
       evidence_note = 'Schedule received by hand at the client meeting.'
 where id = 'f4000000-0000-4000-8000-00000000000a';
select isnt(
  (select supplied_at from opportunity_requirements where id = 'f4000000-0000-4000-8000-00000000000a'),
  null, 'and is accepted when a person says what proves it');

-- ---------------------------------------------------------------------------------------------
-- Insurers: one live approach each.

insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('f5000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f3000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001');

select throws_ok(
  $$insert into opportunity_insurers (organization_id, opportunity_id, insurer_id, added_by)
    values ('10000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a',
            'f2000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'the same insurer cannot be approached twice at once');

select throws_ok(
  $$update opportunity_insurers set removed_at = now()
    where id = 'f5000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'removing an insurer without saying why is refused');

-- ---------------------------------------------------------------------------------------------
-- The request: prepared is not approved, and approved is not sent.

insert into quote_requests (id, organization_id, opportunity_id, opportunity_insurer_id,
                            subject, body_text, prepared_by)
values ('f6000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f3000000-0000-4000-8000-00000000000a', 'f5000000-0000-4000-8000-00000000000a',
        'Quotation request', 'We invite terms for commercial motor cover.',
        'a0000000-0000-4000-8000-000000000001');

select is(
  (select approved_at is null and sent_at is null from quote_requests
   where id = 'f6000000-0000-4000-8000-00000000000a'),
  true, 'a prepared request is neither approved nor sent');

select throws_ok(
  $$update quote_requests set sent_at = now()
    where id = 'f6000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'it cannot be sent without the provider''s own message id');

/*
 * Approving no longer needs the caller to supply a digest and is no longer trusted to: 0049 puts
 * a trigger in front of this write that computes it from the row itself. What 0048 could only ask
 * of a careful caller is now simply true.
 */
update quote_requests set approved_by = 'a0000000-0000-4000-8000-000000000001', approved_at = now()
 where id = 'f6000000-0000-4000-8000-00000000000a';
select is(
  (select approved_body_sha256 = app.quote_request_digest(subject, body_text)
     from quote_requests where id = 'f6000000-0000-4000-8000-00000000000a'),
  true, 'approving records the digest of exactly the text being approved');

/* Editing it withdraws the approval, which is 0049's rule and is proved in full in 0322. */
update quote_requests set subject = 'Quotation request (revised)'
 where id = 'f6000000-0000-4000-8000-00000000000a';
select is(
  (select approved_at from quote_requests where id = 'f6000000-0000-4000-8000-00000000000a'),
  null, 'and editing the request afterwards leaves it unapproved again');

select throws_ok(
  $$insert into quote_requests (organization_id, opportunity_id, opportunity_insurer_id,
                                subject, body_text, prepared_by)
    values ('10000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a',
            'f5000000-0000-4000-8000-00000000000a', 'Second', 'Second body',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one prepared request per insurer, so a retry updates rather than duplicates');

-- ---------------------------------------------------------------------------------------------
-- The answer: a quote must say where it came from.

select throws_ok(
  $$insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id,
                                   outcome, received_at, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a',
            'f5000000-0000-4000-8000-00000000000a', 'quoted', now(),
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a quoted response with no source is refused: a blank row is not a received quote');

select throws_ok(
  $$insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id,
                                   outcome, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a',
            'f5000000-0000-4000-8000-00000000000a', 'declined',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a decline must say why');

select throws_ok(
  $$insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id,
                                   outcome, premium_amount, premium_currency, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a',
            'f5000000-0000-4000-8000-00000000000a', 'no_response', 100, 'KES',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'silence carries no premium');

insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id,
                               outcome, received_at, source_note, premium_amount, premium_currency,
                               recorded_by)
values ('f7000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f3000000-0000-4000-8000-00000000000a', 'f5000000-0000-4000-8000-00000000000a',
        'quoted', now(), 'Terms read out over the telephone by the underwriter.',
        5310000, 'KES', 'a0000000-0000-4000-8000-000000000001');

select is(
  (select outcome from insurer_responses where id = 'f7000000-0000-4000-8000-00000000000a'),
  'quoted', 'a quoted response naming its source is accepted');

select throws_ok(
  $$insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id,
                                   outcome, received_at, source_note, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a',
            'f5000000-0000-4000-8000-00000000000a', 'quoted', now(), 'again',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one answer per insurer, so re-recording updates rather than duplicating');

-- ---------------------------------------------------------------------------------------------
-- Terms: a correction is written beside what was read, never over it.

insert into quote_terms (id, organization_id, insurer_response_id, term_type, label, extracted_value)
values ('f8000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f7000000-0000-4000-8000-00000000000a', 'excess', 'Own damage excess', '2.5% min 30,000');

select throws_ok(
  $$update quote_terms set corrected_value = '2.5% min 35,000'
    where id = 'f8000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a correction without who made it is refused');

update quote_terms
   set corrected_value = '2.5% min 35,000',
       corrected_by = 'a0000000-0000-4000-8000-000000000001', corrected_at = now()
 where id = 'f8000000-0000-4000-8000-00000000000a';

select is(
  (select extracted_value from quote_terms where id = 'f8000000-0000-4000-8000-00000000000a'),
  '2.5% min 30,000',
  'and what was extracted survives the correction, so both can be shown');

select throws_ok(
  $$insert into quote_terms (organization_id, insurer_response_id, term_type, label)
    values ('10000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-00000000000a',
            'limit', 'Says nothing')$$,
  '23514', null, 'a term that says nothing at all is refused');

-- An insurer wording that cannot be compared is recorded as unclear rather than as a value.
insert into quote_terms (organization_id, insurer_response_id, term_type, label, unclear)
values ('10000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-00000000000a',
        'excess', 'Theft excess', true);
select is(
  (select unclear from quote_terms where insurer_response_id = 'f7000000-0000-4000-8000-00000000000a'
     and label = 'Theft excess'),
  true, 'an uncomparable wording is recorded as unclear, not invented into a number');

-- ---------------------------------------------------------------------------------------------
-- Another brokerage.

reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');

select is((select count(*)::int from opportunities), 0, 'another brokerage sees no opportunity');
select is((select count(*)::int from insurer_responses), 0, 'nor any insurer response');
select is((select count(*)::int from quote_terms), 0, 'nor any term');

update quote_terms set corrected_value = 'rewritten by the wrong brokerage'
 where id = 'f8000000-0000-4000-8000-00000000000a';
reset role;
select is(
  (select corrected_value from quote_terms where id = 'f8000000-0000-4000-8000-00000000000a'),
  '2.5% min 35,000',
  'and an update aimed straight at a term changes nothing');

select * from finish();
rollback;
