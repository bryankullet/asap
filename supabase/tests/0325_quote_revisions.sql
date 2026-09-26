-- pgTAP: an old comparison shows what it compared, whatever has happened since (0051).
--
-- Before this migration, opening a comparison joined it to today's rows: it showed September's
-- excess under August's name and claimed that was what the client saw. Worse than a blank. These
-- assertions are the seven things that really happen to a quote between the day a comparison is
-- made and the day somebody asks what was shown, and after each one the old comparison must
-- still be able to answer.
begin;
select plan(24);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'insurer_response_revisions', 'insurer_response_revisions exists');
select has_table('public', 'quote_term_revisions', 'quote_term_revisions exists');
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('insurer_response_revisions','quote_term_revisions')
    and not c.relrowsecurity
$$, 'row level security is enabled on both');
select is_empty($$
  select table_name || ':' || grantee || ':' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type in ('DELETE','UPDATE')
    and grantee in ('authenticated','asap_worker','anon')
    and table_name in ('insurer_response_revisions','quote_term_revisions')
$$, 'no tenant role may change or delete a revision');

-- ---------------------------------------------------------------------------------------------
-- A quotation, compared, then changed in every way that matters.

insert into work_items (id, organization_id, kind, title, task_status)
values ('b1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'new_business', 'Revisions', 'needs_you');
insert into insurers (id, organization_id, name)
values ('b2000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Revision Insurer');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('b3000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'b1000000-0000-4000-8000-00000000000a', 'Revisions', 'Commercial motor',
        'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('b5000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'b3000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001');
insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id,
                               outcome, received_at, source_note, premium_amount, premium_currency,
                               valid_until, recorded_by)
values ('b7000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'b3000000-0000-4000-8000-00000000000a', 'b5000000-0000-4000-8000-00000000000a',
        'quoted', now(), 'Quotation letter.', 5310000, 'KES', '2027-01-31',
        'a0000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from insurer_response_revisions
    where insurer_response_id = 'b7000000-0000-4000-8000-00000000000a'),
  1, 'recording an answer mints its first revision, without anybody asking');

insert into quote_terms (id, organization_id, insurer_response_id, term_type, label, extracted_value)
values ('b8000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'b7000000-0000-4000-8000-00000000000a', 'excess', 'Own damage', '5% min KES 30,000'),
       ('b8000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'b7000000-0000-4000-8000-00000000000a', 'limit', 'Third party', 'KES 20,000,000'),
       ('b8000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000a',
        'b7000000-0000-4000-8000-00000000000a', 'condition', 'Tracking', 'Within 30 days');

-- A write that changes nothing mints nothing, or the history becomes noise.
update quote_terms set position = position where id = 'b8000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from quote_term_revisions where quote_term_id = 'b8000000-0000-4000-8000-00000000000a'),
  1, 'a write that moves nothing mints no revision');

create or replace function pg_temp.compare(p_id uuid) returns void language plpgsql as $$
begin
  insert into quote_comparisons (id, organization_id, opportunity_id, generated_by)
  values (p_id, '10000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-00000000000a',
          'a0000000-0000-4000-8000-000000000001');
  insert into quote_comparison_inputs (organization_id, comparison_id, insurer_response_id,
                                       insurer_id, response_sha256, response_revision_id)
  select r.organization_id, p_id, r.id, oi.insurer_id,
         app.insurer_response_digest(r.outcome, r.premium_amount, r.premium_currency, r.valid_until),
         (select rev.id from insurer_response_revisions rev
           where rev.insurer_response_id = r.id order by rev.revision desc limit 1)
    from insurer_responses r join opportunity_insurers oi on oi.id = r.opportunity_insurer_id
   where r.opportunity_id = 'b3000000-0000-4000-8000-00000000000a';
  insert into quote_comparison_terms (organization_id, comparison_input_id, quote_term_id,
                                      term_type, label, term_sha256, term_revision_id)
  select t.organization_id, i.id, t.id, t.term_type, t.label,
         app.quote_term_digest(t.term_type, t.label, t.extracted_value, t.corrected_value,
                               t.amount, t.currency, t.unclear),
         (select rev.id from quote_term_revisions rev
           where rev.quote_term_id = t.id order by rev.revision desc limit 1)
    from quote_comparison_inputs i
    join quote_terms t on t.insurer_response_id = i.insurer_response_id
   where i.comparison_id = p_id;
end $$;

select pg_temp.compare('b9000000-0000-4000-8000-00000000000a');
select is(
  (select version from quote_comparisons where id = 'b9000000-0000-4000-8000-00000000000a'),
  1, 'the first comparison is version 1, numbered by the database');

-- The seven changes.
update insurer_responses set premium_amount = 5410000 where id = 'b7000000-0000-4000-8000-00000000000a';
update insurer_responses set valid_until = '2027-03-31' where id = 'b7000000-0000-4000-8000-00000000000a';
update quote_terms set corrected_value = '5% min KES 50,000',
       corrected_by = 'a0000000-0000-4000-8000-000000000001', corrected_at = now()
 where id = 'b8000000-0000-4000-8000-00000000000a';
update quote_terms set extracted_value = 'KES 30,000,000' where id = 'b8000000-0000-4000-8000-00000000000b';
update quote_terms set corrected_value = 'Within 14 days',
       corrected_by = 'a0000000-0000-4000-8000-000000000001', corrected_at = now()
 where id = 'b8000000-0000-4000-8000-00000000000c';
insert into quote_terms (organization_id, insurer_response_id, term_type, label, extracted_value)
values ('10000000-0000-4000-8000-00000000000a', 'b7000000-0000-4000-8000-00000000000a',
        'exclusion', 'Political violence', 'Excluded');

-- ---------------------------------------------------------------------------------------------
-- What the old comparison can still show.

select is(
  (select rev.premium_amount from quote_comparison_inputs i
     join insurer_response_revisions rev on rev.id = i.response_revision_id
    where i.comparison_id = 'b9000000-0000-4000-8000-00000000000a'),
  5310000.00, 'the premium the client saw is still the premium the comparison shows');
select is(
  (select r.premium_amount from insurer_responses r where r.id = 'b7000000-0000-4000-8000-00000000000a'),
  5410000.00, 'while the quote itself shows the new one');
select is(
  (select rev.valid_until from quote_comparison_inputs i
     join insurer_response_revisions rev on rev.id = i.response_revision_id
    where i.comparison_id = 'b9000000-0000-4000-8000-00000000000a'),
  '2027-01-31'::date, 'and the validity it was compared under');

select is(
  (select coalesce(rev.corrected_value, rev.extracted_value)
     from quote_comparison_terms t join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.label = 'Own damage'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000a')),
  '5% min KES 30,000', 'the excess the client saw, not the one a person corrected it to');
select is(
  (select coalesce(rev.corrected_value, rev.extracted_value)
     from quote_comparison_terms t join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.label = 'Third party'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000a')),
  'KES 20,000,000', 'the limit as it stood');
select is(
  (select coalesce(rev.corrected_value, rev.extracted_value)
     from quote_comparison_terms t join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.label = 'Tracking'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000a')),
  'Within 30 days', 'and the condition as it read');

-- The exclusion added afterwards was never in it, and does not appear in it now.
select is(
  (select count(*)::int from quote_comparison_terms t
     join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.term_type = 'exclusion'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000a')),
  0, 'a term added afterwards does not appear in a comparison made before it');

select isnt(
  (select superseded_at from quote_comparisons where id = 'b9000000-0000-4000-8000-00000000000a'),
  null, 'and the comparison says it has been superseded');

-- ---------------------------------------------------------------------------------------------
-- Old and new coexist.

select pg_temp.compare('b9000000-0000-4000-8000-00000000000b');
select is(
  (select version from quote_comparisons where id = 'b9000000-0000-4000-8000-00000000000b'),
  2, 'regenerating makes version 2');
select is(
  (select count(*)::int from quote_comparisons where opportunity_id = 'b3000000-0000-4000-8000-00000000000a'),
  2, 'and both exist');
select is(
  (select coalesce(rev.corrected_value, rev.extracted_value)
     from quote_comparison_terms t join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.label = 'Own damage'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000b')),
  '5% min KES 50,000', 'the new comparison shows the corrected excess');
select is(
  (select coalesce(rev.corrected_value, rev.extracted_value)
     from quote_comparison_terms t join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.label = 'Own damage'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000a')),
  '5% min KES 30,000', 'and the old one is untouched by it');

-- ---------------------------------------------------------------------------------------------
-- A revision cannot be edited, and a comparison cannot be made without naming one.

select throws_ok(
  $$update quote_term_revisions set extracted_value = 'Something else'
     where quote_term_id = 'b8000000-0000-4000-8000-00000000000a' and revision = 1$$,
  '42501', null, 'no signed-in person may edit a revision');

select throws_ok(
  $$insert into quote_comparison_inputs (organization_id, comparison_id, insurer_response_id,
                                         insurer_id, response_sha256)
    values ('10000000-0000-4000-8000-00000000000a', 'b9000000-0000-4000-8000-00000000000b',
            'b7000000-0000-4000-8000-00000000000a', 'b2000000-0000-4000-8000-00000000000a',
            repeat('a', 64))$$,
  '23502', null, 'a comparison input that names no revision is refused');

-- ---------------------------------------------------------------------------------------------
-- A quotation that is deleted outright leaves its history behind.

set local role postgres;
delete from quote_terms where id = 'b8000000-0000-4000-8000-00000000000b';
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is(
  (select coalesce(rev.corrected_value, rev.extracted_value)
     from quote_comparison_terms t join quote_term_revisions rev on rev.id = t.term_revision_id
    where rev.label = 'Third party'
      and t.comparison_input_id in (select id from quote_comparison_inputs
                                     where comparison_id = 'b9000000-0000-4000-8000-00000000000a')),
  'KES 20,000,000', 'deleting the term outright does not change what the comparison shows');

-- ---------------------------------------------------------------------------------------------
-- Tenancy.

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from quote_term_revisions
    where insurer_response_id = 'b7000000-0000-4000-8000-00000000000a'),
  0, 'another brokerage sees none of these revisions');
select is(
  (select count(*)::int from insurer_response_revisions
    where insurer_response_id = 'b7000000-0000-4000-8000-00000000000a'),
  0, 'nor any of these answers');

select * from finish();
rollback;
