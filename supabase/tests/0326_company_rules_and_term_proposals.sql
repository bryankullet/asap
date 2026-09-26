-- pgTAP: a brokerage's own rules (0052) and what the extractor proposes (0053).
--
-- The rules table exists because 4B-3 shipped a 5% premium gap that decided which insurer a
-- client should be advised to take. A universal constant is not entitled to decide that, and
-- CLAUDE.md forbids hard-coding a Kenyan market value in the first place. So: a rule, with its
-- source and the date somebody last checked it, per brokerage, or no recommendation at all.
--
-- The proposals table exists because a quotation states several excesses and `document_fields`
-- holds one value per key. What these hold:
--
--   * two brokerages keep different rules and neither sees the other's;
--   * a rule cannot be stored without saying where it came from;
--   * changing one keeps what it was;
--   * repeated terms are separate rows, and the same document read twice updates rather than
--     duplicates;
--   * a proposal that became a term says which term, and a rejected one never has one;
--   * one quotation document belongs to one insurer's answer, and a second is refused.
begin;
select plan(21);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select has_table('public', 'company_rules', 'company_rules exists');
select has_table('public', 'company_rule_versions', 'company_rule_versions exists');
select has_table('public', 'document_term_proposals', 'document_term_proposals exists');
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('company_rules','company_rule_versions','document_term_proposals')
    and not c.relrowsecurity
$$, 'row level security is enabled on all three');
select is_empty($$
  select table_name || ':' || grantee from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'DELETE'
    and grantee in ('authenticated','asap_worker','anon')
    and table_name in ('company_rules','company_rule_versions','document_term_proposals')
$$, 'no tenant role may delete a rule, its history, or a proposal');

-- ---------------------------------------------------------------------------------------------
-- Rules.

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

select throws_ok(
  $$insert into company_rules (organization_id, key, value, source, verified_at, set_by)
    values ('10000000-0000-4000-8000-00000000000a', 'quote.recommendation',
            '{"mode":"abstain"}'::jsonb, '   ', current_date,
            'a0000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a rule with no source is refused: provenance is not optional');

insert into company_rules (id, organization_id, key, value, source, verified_at, set_by)
values ('aa000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'quote.recommendation', '{"mode":"cheapest_when_like_for_like","minimumGapPercent":8}'::jsonb,
        'Partners meeting, 4 September 2026.', current_date,
        'a0000000-0000-4000-8000-000000000001');

select is(
  (select value ->> 'minimumGapPercent' from company_rules
    where id = 'aa000000-0000-4000-8000-00000000000a'),
  '8', 'a brokerage sets its own gap, and it is data rather than code');

select is(
  (select count(*)::int from company_rule_versions
    where company_rule_id = 'aa000000-0000-4000-8000-00000000000a'),
  1, 'setting it is kept as a version');

update company_rules set value = '{"mode":"abstain"}'::jsonb,
       source = 'Partners reversed it, 20 September 2026.', verified_at = current_date
 where id = 'aa000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from company_rule_versions
    where company_rule_id = 'aa000000-0000-4000-8000-00000000000a'),
  2, 'and changing it keeps what it was');

select throws_ok(
  $$insert into company_rules (organization_id, key, value, source, verified_at, set_by)
    values ('10000000-0000-4000-8000-00000000000a', 'quote.recommendation',
            '{"mode":"abstain"}'::jsonb, 'Again.', current_date,
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one rule per key per brokerage');

-- The other brokerage keeps its own, and neither sees the other's.
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
insert into company_rules (organization_id, key, value, source, verified_at, set_by)
values ('10000000-0000-4000-8000-00000000000b', 'quote.recommendation',
        '{"mode":"cheapest_when_like_for_like","minimumGapPercent":3}'::jsonb,
        'Their own underwriting policy.', current_date,
        'b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from company_rules), 1,
  'a brokerage sees only its own rules');
select is(
  (select value ->> 'minimumGapPercent' from company_rules), '3',
  'and the two brokerages hold different ones');

-- ---------------------------------------------------------------------------------------------
-- Proposals.

select pg_temp.login('a0000000-0000-4000-8000-000000000001');

insert into documents (id, organization_id, client_id, filename, storage_path, mime_type,
                       byte_size, content_sha256, kind, uploaded_by)
values ('ab000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'quotation.pdf', 'org/quotation.pdf', 'application/pdf', 1024, repeat('a', 64),
        'other', 'a0000000-0000-4000-8000-000000000001');

-- Several excesses, which is the whole reason this table is not `document_fields`.
insert into document_term_proposals (organization_id, document_id, ordinal, term_type, label,
                                     proposed_value, page_number, region_x, region_y,
                                     region_width, region_height, condition, method)
values ('10000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-00000000000a', 0,
        'excess', 'Own damage excess', '5% min KES 30,000', 1, 10, 20, 100, 12, 'known', 'labelled_line'),
       ('10000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-00000000000a', 1,
        'excess', 'Theft excess', '10% of claim', 1, 10, 40, 100, 12, 'known', 'labelled_line'),
       ('10000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-00000000000a', 2,
        'exclusion', 'Exclusion', 'Political violence', 1, 10, 60, 100, 12, 'known', 'labelled_line');

select is(
  (select count(*)::int from document_term_proposals
    where document_id = 'ab000000-0000-4000-8000-00000000000a' and term_type = 'excess'),
  2, 'two excesses are two proposals, not one flattened field');

select throws_ok(
  $$insert into document_term_proposals (organization_id, document_id, ordinal, term_type, label,
                                         proposed_value, condition, method)
    values ('10000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-00000000000a', 0,
            'excess', 'Own damage excess', '5% min KES 30,000', 'known', 'labelled_line')$$,
  '23505', null, 'reading the same document again updates rather than duplicating');

select throws_ok(
  $$update document_term_proposals set state = 'accepted'
     where document_id = 'ab000000-0000-4000-8000-00000000000a' and ordinal = 0$$,
  '23514', null, 'a proposal cannot be accepted without saying who accepted it');

-- Accepting it: the confirmed term, and the proposal pointing at it.
/* Engine-owned, as everywhere else: 0018 and 0023 revoke direct insert from `authenticated`. */
set local role postgres;
insert into work_items (id, organization_id, kind, title, task_status)
values ('ac000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'new_business', 'Proposals', 'needs_you');
insert into insurers (id, organization_id, name)
values ('ad000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Proposal Insurer');
select pg_temp.login('a0000000-0000-4000-8000-000000000001');
insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('ae000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'ac000000-0000-4000-8000-00000000000a', 'Proposals', 'Commercial motor',
        'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('af000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'ae000000-0000-4000-8000-00000000000a', 'ad000000-0000-4000-8000-00000000000a',
        'a0000000-0000-4000-8000-000000000001');
insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id,
                               outcome, received_at, source_document_id, premium_amount,
                               premium_currency, recorded_by)
values ('ba000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'ae000000-0000-4000-8000-00000000000a', 'af000000-0000-4000-8000-00000000000a',
        'quoted', now(), 'ab000000-0000-4000-8000-00000000000a', 5310000, 'KES',
        'a0000000-0000-4000-8000-000000000001');
insert into quote_terms (id, organization_id, insurer_response_id, term_type, label,
                         extracted_value, evidence_document_id, evidence_page,
                         region_x, region_y, region_width, region_height)
values ('bb000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'ba000000-0000-4000-8000-00000000000a', 'excess', 'Own damage excess',
        '5% min KES 30,000', 'ab000000-0000-4000-8000-00000000000a', 1, 10, 20, 100, 12);

update document_term_proposals
   set state = 'accepted', reviewed_by = 'a0000000-0000-4000-8000-000000000001',
       reviewed_at = now(), quote_term_id = 'bb000000-0000-4000-8000-00000000000a'
 where document_id = 'ab000000-0000-4000-8000-00000000000a' and ordinal = 0;
select is(
  (select state from document_term_proposals
    where document_id = 'ab000000-0000-4000-8000-00000000000a' and ordinal = 0),
  'accepted', 'a person accepting it records who and when, and which term it became');

select is(
  (select evidence_page from quote_term_revisions
    where quote_term_id = 'bb000000-0000-4000-8000-00000000000a' and revision = 1),
  1, 'and the confirmed term carries the page it was read from into its revision');
select is(
  (select region_y from quote_term_revisions
    where quote_term_id = 'bb000000-0000-4000-8000-00000000000a' and revision = 1),
  20::numeric, 'with the rectangle, so an old comparison still opens at the right words');

select throws_ok(
  $$update document_term_proposals
       set state = 'rejected', reviewed_by = 'a0000000-0000-4000-8000-000000000001',
           reviewed_at = now(), quote_term_id = 'bb000000-0000-4000-8000-00000000000a'
     where document_id = 'ab000000-0000-4000-8000-00000000000a' and ordinal = 1$$,
  '23514', null, 'a rejected proposal never becomes a term');

-- ---------------------------------------------------------------------------------------------
-- One document, one insurer's answer. The link is already on the answer; what 0053 adds is that
-- it means one thing.

insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('af000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a',
        'ae000000-0000-4000-8000-00000000000a',
        (select id from insurers where organization_id = '10000000-0000-4000-8000-00000000000a'
          and id <> 'ad000000-0000-4000-8000-00000000000a' limit 1),
        'a0000000-0000-4000-8000-000000000001');

select throws_ok(
  $$insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id,
                                   outcome, received_at, source_document_id, premium_amount,
                                   premium_currency, recorded_by)
    values ('10000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-00000000000a',
            'af000000-0000-4000-8000-00000000000b', 'quoted', now(),
            'ab000000-0000-4000-8000-00000000000a', 5620000, 'KES',
            'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'one quotation document belongs to one answer: a second is refused, not retried');

select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is(
  (select count(*)::int from document_term_proposals), 0,
  'another brokerage sees none of these proposals');

select * from finish();
rollback;
