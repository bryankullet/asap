-- pgTAP: quotation and opportunity records are written through the API only (0057).
--
-- For each of the sixteen tables of 0048–0053:
--   * a browser session (a signed-in person, no server-held key) can still read its own rows;
--   * it cannot insert, update or delete any of them — even a row it can see;
--   * the API, acting on the same person's behalf, can still write;
--   * anon has no grant at all, and nobody holds DELETE;
--   * another brokerage sees none of them.
begin;
select plan(12);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-0330');

create temp table protected (t text primary key) on commit drop;
insert into protected values ('requirement_templates'),('opportunities'),('opportunity_requirements'),
  ('opportunity_insurers'),('quote_requests'),('insurer_responses'),('quote_terms'),
  ('quote_request_approvals'),('quote_comparisons'),('quote_comparison_inputs'),
  ('quote_comparison_terms'),('insurer_response_revisions'),('quote_term_revisions'),
  ('company_rules'),('company_rule_versions'),('document_term_proposals');
grant select on protected to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Shape.

select is_empty($$
  select t from protected
   where not exists (select 1 from pg_trigger g where g.tgrelid = t::regclass and g.tgname = '000_through_api')
$$, 'every quotation table has the API-only write gate');
select is_empty($$
  select table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name in (select t from protected)
     and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type = 'DELETE'))
$$, 'anon holds nothing on them, and no browser session holds DELETE');
select is_empty($$
  select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in (select t from protected) and not c.relrowsecurity
$$, 'row level security is enabled on all sixteen');

-- ---------------------------------------------------------------------------------------------
-- One row in every table, written as the API on the person's behalf.

insert into work_items (id, organization_id, kind, title, task_status)
values ('f0100000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'new_business', 'Gate quotation', 'needs_you');
insert into insurers (id, organization_id, name)
values ('f0200000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Gate Insurer');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);

insert into requirement_templates (organization_id, class_of_business, label, source, verified_at)
values ('10000000-0000-4000-8000-00000000000a', 'Gate class', 'Vehicle schedule', 'Brokerage checklist, 2026.', now());
insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('f0300000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'f0100000-0000-4000-8000-00000000000a', 'Gate quotation', 'Commercial motor', 'a0000000-0000-4000-8000-000000000001');
insert into opportunity_requirements (organization_id, opportunity_id, label)
values ('10000000-0000-4000-8000-00000000000a', 'f0300000-0000-4000-8000-00000000000a', 'Vehicle schedule');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('f0400000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f0300000-0000-4000-8000-00000000000a', 'f0200000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');
insert into quote_requests (id, organization_id, opportunity_id, opportunity_insurer_id, subject, body_text, prepared_by)
values ('f0500000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f0300000-0000-4000-8000-00000000000a', 'f0400000-0000-4000-8000-00000000000a',
        'Quotation request', 'We invite terms for commercial motor cover.', 'a0000000-0000-4000-8000-000000000001');
update quote_requests set approved_by = 'a0000000-0000-4000-8000-000000000001', approved_at = now()
 where id = 'f0500000-0000-4000-8000-00000000000a';
insert into quote_request_approvals (organization_id, quote_request_id, body_sha256, approved_by)
select organization_id, id, approved_body_sha256, approved_by from quote_requests where id = 'f0500000-0000-4000-8000-00000000000a';
insert into insurer_responses (id, organization_id, opportunity_id, opportunity_insurer_id, outcome, received_at,
                               source_note, premium_amount, premium_currency, recorded_by)
values ('f0600000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f0300000-0000-4000-8000-00000000000a', 'f0400000-0000-4000-8000-00000000000a', 'quoted', now(),
        'Quotation letter received by email.', 5310000, 'KES', 'a0000000-0000-4000-8000-000000000001');
insert into quote_terms (id, organization_id, insurer_response_id, term_type, label, extracted_value)
values ('f0700000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f0600000-0000-4000-8000-00000000000a', 'excess', 'Own damage', '5% min KES 30,000');
insert into quote_comparisons (id, organization_id, opportunity_id, generated_by)
values ('f0800000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        'f0300000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001');
insert into quote_comparison_inputs (id, organization_id, comparison_id, insurer_response_id, insurer_id, response_sha256, response_revision_id)
select 'f0900000-0000-4000-8000-00000000000a', r.organization_id, 'f0800000-0000-4000-8000-00000000000a', r.id,
       'f0200000-0000-4000-8000-00000000000a',
       app.insurer_response_digest(r.outcome, r.premium_amount, r.premium_currency, r.valid_until),
       (select rev.id from insurer_response_revisions rev where rev.insurer_response_id = r.id order by rev.revision desc limit 1)
  from insurer_responses r where r.id = 'f0600000-0000-4000-8000-00000000000a';
insert into quote_comparison_terms (organization_id, comparison_input_id, quote_term_id, term_type, label, term_sha256, term_revision_id)
select t.organization_id, 'f0900000-0000-4000-8000-00000000000a', t.id, t.term_type, t.label,
       app.quote_term_digest(t.term_type, t.label, t.extracted_value, t.corrected_value, t.amount, t.currency, t.unclear),
       (select rev.id from quote_term_revisions rev where rev.quote_term_id = t.id order by rev.revision desc limit 1)
  from quote_terms t where t.id = 'f0700000-0000-4000-8000-00000000000a';
insert into company_rules (organization_id, key, value, source, verified_at, set_by)
values ('10000000-0000-4000-8000-00000000000a', 'quote.recommendation',
        '{"mode":"cheapest_when_like_for_like","minimumGapPercent":8}'::jsonb,
        'Partners meeting, 4 September 2026.', current_date, 'a0000000-0000-4000-8000-000000000001');
insert into documents (id, organization_id, client_id, filename, storage_path, mime_type, byte_size, content_sha256, kind, uploaded_by)
values ('f0a00000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'gate.pdf', 'org/gate.pdf', 'application/pdf', 1024, repeat('b', 64), 'other', 'a0000000-0000-4000-8000-000000000001');
insert into document_term_proposals (organization_id, document_id, ordinal, term_type, label, proposed_value, page_number,
                                     region_x, region_y, region_width, region_height, condition, method)
values ('10000000-0000-4000-8000-00000000000a', 'f0a00000-0000-4000-8000-00000000000a', 0, 'excess', 'Own damage excess',
        '5% min KES 30,000', 1, 10, 20, 100, 12, 'known', 'labelled_line');

select is_empty($$
  select t from protected p
   where (xpath('/row/n/text()', query_to_xml(format(
            'select count(*) as n from %I where organization_id = %L', p.t, '10000000-0000-4000-8000-00000000000a'), false, true, '')))[1]::text::int = 0
$$, 'the API wrote a row to every one of the sixteen tables, including the engine-minted revisions');

select lives_ok(
  $$update opportunities set title = 'Gate quotation — renamed' where id = 'f0300000-0000-4000-8000-00000000000a'$$,
  'the API, on the person''s behalf, can still change an opportunity');

-- ---------------------------------------------------------------------------------------------
-- A browser session: the same person, no server-held key.

/* Try one statement; return the SQLSTATE and message, or 'ok' if it ran and touched a row. */
create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return case when n = 0 then 'no rows' else 'ok' end;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function pg_temp.attempt(text) to authenticated;

select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);

create temp table outcomes on commit drop as
select p.t,
       (xpath('/row/n/text()', query_to_xml(format(
          'select count(*) as n from %I where organization_id = %L', p.t, '10000000-0000-4000-8000-00000000000a'), false, true, '')))[1]::text::int as visible,
       pg_temp.attempt(format('insert into %I default values', p.t)) as ins,
       pg_temp.attempt(format('update %I set organization_id = organization_id where organization_id = %L', p.t, '10000000-0000-4000-8000-00000000000a')) as upd,
       pg_temp.attempt(format('delete from %I where organization_id = %L', p.t, '10000000-0000-4000-8000-00000000000a')) as del
  from protected p;

select is_empty($$ select t from outcomes where visible = 0 $$,
  'a browser session can still read its own rows in every table');
select is_empty($$ select t || ': ' || ins from outcomes where ins not like '42501 api_only%' $$,
  'a browser session cannot insert into any of them: api_only');
select is_empty($$ select t || ': ' || upd from outcomes where upd not like '42501%' $$,
  'nor update a row it can see in any of them');
select is_empty($$ select t || ': ' || del from outcomes where del not like '42501%' $$,
  'nor delete one');
select is_empty($$
  select t || ': ' || upd from outcomes
   where upd not like case when t in ('quote_comparison_inputs','quote_comparison_terms','insurer_response_revisions',
                                      'quote_term_revisions','company_rule_versions')
                           then '42501 permission denied%' else '42501 api_only%' end
$$, 'append-only and engine-owned tables have no UPDATE grant at all; the rest are refused by the gate itself');

reset role;
select is((select title from opportunities where id = 'f0300000-0000-4000-8000-00000000000a'), 'Gate quotation — renamed',
  'nothing the browser session attempted changed the record');

-- ---------------------------------------------------------------------------------------------
-- Another brokerage.

select pg_temp.login('b0000000-0000-4000-8000-000000000001', true);
select is_empty($$
  select t from protected p
   where (xpath('/row/n/text()', query_to_xml(format(
            'select count(*) as n from %I where organization_id = %L', p.t, '10000000-0000-4000-8000-00000000000a'), false, true, '')))[1]::text::int > 0
$$, 'another brokerage sees none of the sixteen tables'' rows, even with the API key');

select * from finish();
rollback;
