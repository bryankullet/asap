-- pgTAP: a comparison records what it compared, and notices when that changes (0050).
--
-- A comparison is a photograph of the market at one moment, and the failure it can cause is
-- putting a page in front of a client that no longer describes any quote in existence. So:
--
--   * changing a premium, a validity date or a term stales the comparison that included it;
--   * so does adding a term, and so does removing one;
--   * re-saving a response without changing a figure does not, or the marker becomes noise;
--   * the stale reason names the insurer and the term;
--   * `app.quote_comparison_changes` says which insurer and which term, after any number of them;
--   * a stale comparison cannot be presented to a client until it is generated again;
--   * the superseded comparison is kept, not deleted, and nobody may delete one;
--   * one live comparison per opportunity, and one brokerage sees none of another's.
begin;
select plan(22);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Shape.

select has_table('public', 'quote_comparisons', 'quote_comparisons exists');
select has_table('public', 'quote_comparison_inputs', 'quote_comparison_inputs exists');
select has_table('public', 'quote_comparison_terms', 'quote_comparison_terms exists');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('quote_comparisons','quote_comparison_inputs','quote_comparison_terms')
    and not c.relrowsecurity
$$, 'row level security is enabled on all three');

select is_empty($$
  select table_name || ':' || grantee from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'DELETE'
    and grantee in ('authenticated','asap_worker','anon')
    and table_name in ('quote_comparisons','quote_comparison_inputs','quote_comparison_terms')
$$, 'a comparison is evidence of what was shown to a client: nobody may delete one');

-- The comparison stores digests, not a second copy of the client's terms.
select hasnt_column('public', 'quote_comparison_terms', 'extracted_value',
  'a comparison keeps no copy of the term values it compared');

-- ---------------------------------------------------------------------------------------------
-- A quotation with two insurers who both answered.

insert into work_items (id, organization_id, kind, title, task_status)
values ('d1000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'new_business', 'Quotation work', 'needs_you');
insert into insurers (id, organization_id, name)
values ('d2000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Jubilee Test'),
       ('d2000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'CIC Test');

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('d3000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'd1000000-0000-4000-8000-00000000000a', 'Fleet quotation — 2027', 'Commercial motor',
        'a0000000-0000-4000-8000-000000000001');

insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('d5000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'd3000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001'),
       ('d5000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'd3000000-0000-4000-8000-00000000000a', 'd2000000-0000-4000-8000-00000000000b',
        'a0000000-0000-4000-8000-000000000001');

insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id,
                               outcome, received_at, source_note, premium_amount, premium_currency,
                               valid_until, recorded_by)
values ('d7000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'd3000000-0000-4000-8000-00000000000a', 'd5000000-0000-4000-8000-00000000000a',
        'quoted', now(), 'Quotation letter received by email.', 5310000, 'KES', '2027-01-31',
        'a0000000-0000-4000-8000-000000000001'),
       ('d7000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'd3000000-0000-4000-8000-00000000000a', 'd5000000-0000-4000-8000-00000000000b',
        'quoted', now(), 'Quotation letter received by email.', 5620000, 'KES', '2027-01-31',
        'a0000000-0000-4000-8000-000000000001');

insert into quote_terms (id, organization_id, insurer_response_id, term_type, label, extracted_value)
values ('d8000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'd7000000-0000-4000-8000-00000000000a', 'excess', 'Own damage', '5% of claim, min KES 30,000'),
       ('d8000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'd7000000-0000-4000-8000-00000000000b', 'excess', 'Own damage', '5% of claim, min KES 25,000');

-- A comparison, recorded against exactly those rows.
create or replace function pg_temp.compare(p_id uuid) returns void language plpgsql as $$
begin
  insert into quote_comparisons (id, organization_id, opportunity_id, generated_by)
  values (p_id, '10000000-0000-4000-8000-00000000000a', 'd3000000-0000-4000-8000-00000000000a',
          'a0000000-0000-4000-8000-000000000001');

  /* Naming the revision is required since 0051: a comparison points at what it compared. */
  insert into quote_comparison_inputs (organization_id, comparison_id, insurer_response_id,
                                       insurer_id, response_sha256, response_revision_id)
  select r.organization_id, p_id, r.id, oi.insurer_id,
         app.insurer_response_digest(r.outcome, r.premium_amount, r.premium_currency, r.valid_until),
         (select rev.id from insurer_response_revisions rev
           where rev.insurer_response_id = r.id order by rev.revision desc limit 1)
    from insurer_responses r join opportunity_insurers oi on oi.id = r.opportunity_insurer_id
   where r.opportunity_id = 'd3000000-0000-4000-8000-00000000000a';

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

select pg_temp.compare('d9000000-0000-4000-8000-00000000000a');

select is(
  (select count(*)::int from quote_comparison_terms t
     join quote_comparison_inputs i on i.id = t.comparison_input_id
    where i.comparison_id = 'd9000000-0000-4000-8000-00000000000a'),
  2, 'the comparison records the exact terms it compared');

select is_empty(
  $$select insurer_name from app.quote_comparison_changes('d9000000-0000-4000-8000-00000000000a')$$,
  'and nothing has changed the moment it is made');

-- ---------------------------------------------------------------------------------------------
-- A write that moves nothing must not stale it, or the marker stops being read.

update insurer_responses set updated_at = now()
 where id = 'd7000000-0000-4000-8000-00000000000a';
select is(
  (select superseded_at from quote_comparisons where id = 'd9000000-0000-4000-8000-00000000000a'),
  null, 're-saving a response without changing a figure leaves the comparison current');

-- ---------------------------------------------------------------------------------------------
-- A premium that moves.

update insurer_responses set premium_amount = 5410000
 where id = 'd7000000-0000-4000-8000-00000000000a';

select isnt(
  (select superseded_at from quote_comparisons where id = 'd9000000-0000-4000-8000-00000000000a'),
  null, 'a changed premium stales the comparison that included it');

select matches(
  (select superseded_reason from quote_comparisons where id = 'd9000000-0000-4000-8000-00000000000a'),
  '^Jubilee Test', 'and the reason names the insurer that changed it');

select is(
  (select change from app.quote_comparison_changes('d9000000-0000-4000-8000-00000000000a')),
  'The premium or validity changed.', 'and the change is identified against that insurer');

select is(
  (select insurer_name from app.quote_comparison_changes('d9000000-0000-4000-8000-00000000000a')),
  'Jubilee Test', 'by name');

-- A stale comparison is not a page to put in front of a client.
select throws_ok(
  $$update quote_comparisons
       set presented_at = now(), presented_by = 'a0000000-0000-4000-8000-000000000001'
     where id = 'd9000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a stale comparison cannot be presented until it is generated again');

-- ---------------------------------------------------------------------------------------------
-- Generating it again, and the terms.

select pg_temp.compare('d9000000-0000-4000-8000-00000000000b');
select is(
  (select count(*)::int from quote_comparisons
    where opportunity_id = 'd3000000-0000-4000-8000-00000000000a'),
  2, 'the superseded comparison is kept beside the new one, not replaced');

update quote_comparisons
   set presented_at = now(), presented_by = 'a0000000-0000-4000-8000-000000000001'
 where id = 'd9000000-0000-4000-8000-00000000000b';
select isnt(
  (select presented_at from quote_comparisons where id = 'd9000000-0000-4000-8000-00000000000b'),
  null, 'and a current one can be presented');

-- A person corrects a misread excess.
update quote_terms set corrected_value = '5% of claim, min KES 35,000',
                       corrected_by = 'a0000000-0000-4000-8000-000000000001', corrected_at = now()
 where id = 'd8000000-0000-4000-8000-00000000000a';

select matches(
  (select superseded_reason from quote_comparisons where id = 'd9000000-0000-4000-8000-00000000000b'),
  'Own damage', 'correcting a term stales the comparison, and the reason names the term');

select is(
  (select label from app.quote_comparison_changes('d9000000-0000-4000-8000-00000000000b')
    where change = 'This term changed.'),
  'Own damage', 'and the changed term is identified');

-- A term added afterwards is a change to what was compared.
select pg_temp.compare('d9000000-0000-4000-8000-00000000000c');
insert into quote_terms (organization_id, insurer_response_id, term_type, label, extracted_value)
values ('10000000-0000-4000-8000-00000000000a', 'd7000000-0000-4000-8000-00000000000a',
        'exclusion', 'Political violence', 'Excluded unless separately arranged');

select is(
  (select label from app.quote_comparison_changes('d9000000-0000-4000-8000-00000000000c')
    where change = 'This term was added afterwards.'),
  'Political violence', 'a term added afterwards is named as an addition');
select isnt(
  (select superseded_at from quote_comparisons where id = 'd9000000-0000-4000-8000-00000000000c'),
  null, 'and it stales the comparison too');

/*
 * And one removed. No signed-in person can delete a term — 0048 refuses it — so this is the
 * offboarding path, done as the owner. The comparison must still be able to name what went.
 */
select pg_temp.compare('d9000000-0000-4000-8000-00000000000d');
set local role postgres;
delete from quote_terms where id = 'd8000000-0000-4000-8000-00000000000b';
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
select is(
  (select label from app.quote_comparison_changes('d9000000-0000-4000-8000-00000000000d')
    where change = 'This term is no longer recorded.'),
  'Own damage', 'a removed term is still named, because the comparison kept its label');

-- ---------------------------------------------------------------------------------------------
-- Tenancy.

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from quote_comparisons
    where opportunity_id = 'd3000000-0000-4000-8000-00000000000a'),
  0, 'another brokerage sees none of these comparisons');

select * from finish();
rollback;
