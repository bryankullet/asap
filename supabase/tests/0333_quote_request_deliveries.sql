-- pgTAP: a quotation request delivered by a person (0060), and derived work state.
--
--   * the table has RLS, the API-only gate, no DELETE/UPDATE grant, anon holds nothing;
--   * a browser session without the server key cannot record a delivery;
--   * only an approved request can be delivered, and only its approved text;
--   * one delivery per request; a future date is refused;
--   * another brokerage sees none of it;
--   * work_item_set_state needs the API key, names a party for with_party, and audits.
begin;
select plan(14);

create or replace function pg_temp.login(p_user uuid, p_with_key boolean) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_with_key then '{"x-asap-api-key":"pgtap-internal-key-0333-abcdef0123456789"}' else '{}' end, true);
  perform set_config('role', 'authenticated', true);
end $$;

insert into app.api_keys (key_hash, label)
values (encode(extensions.digest('pgtap-internal-key-0333-abcdef0123456789', 'sha256'), 'hex'), 'pgtap-0333');

select ok(exists (select 1 from pg_trigger where tgrelid = 'quote_request_deliveries'::regclass and tgname = '000_through_api'),
  'deliveries carry the API-only write gate');
select is_empty($$
  select grantee || ':' || privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'quote_request_deliveries'
     and (grantee = 'anon' or (grantee in ('authenticated', 'asap_worker') and privilege_type in ('UPDATE', 'DELETE')))
$$, 'anon holds nothing; nobody may update or delete a delivery');
select ok((select relrowsecurity from pg_class where oid = 'quote_request_deliveries'::regclass), 'row level security is on');

-- Fixture, as the owner.
insert into work_items (id, organization_id, kind, title, task_status)
values ('f3330000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'new_business', 'Delivery quotation', 'needs_you');
insert into insurers (id, organization_id, name)
values ('f3330000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'Delivery Insurer');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
insert into opportunities (id, organization_id, client_id, work_item_id, title, class_of_business, created_by)
values ('f3330000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000a',
        (select id from clients where organization_id = '10000000-0000-4000-8000-00000000000a' limit 1),
        'f3330000-0000-4000-8000-00000000000a', 'Delivery quotation', 'Commercial motor', 'a0000000-0000-4000-8000-000000000001');
insert into opportunity_insurers (id, organization_id, opportunity_id, insurer_id, added_by)
values ('f3330000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-00000000000a',
        'f3330000-0000-4000-8000-00000000000c', 'f3330000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000001');
insert into quote_requests (id, organization_id, opportunity_id, opportunity_insurer_id, subject, body_text, prepared_by)
values ('f3330000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-00000000000a',
        'f3330000-0000-4000-8000-00000000000c', 'f3330000-0000-4000-8000-00000000000d',
        'Quotation request', 'We invite terms for commercial motor cover.', 'a0000000-0000-4000-8000-000000000001');

select throws_like($$
  insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
  values ('10000000-0000-4000-8000-00000000000a', 'f3330000-0000-4000-8000-00000000000e', 'own_email', 'Emailed 10:02', 'x', now(), 'a0000000-0000-4000-8000-000000000001')
$$, '%not_approved%', 'an unapproved request cannot be delivered');

update quote_requests set approved_by = 'a0000000-0000-4000-8000-000000000001', approved_at = now()
 where id = 'f3330000-0000-4000-8000-00000000000e';

select throws_like($$
  insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
  values ('10000000-0000-4000-8000-00000000000a', 'f3330000-0000-4000-8000-00000000000e', 'own_email', 'Emailed 10:02', 'not-the-approved-digest', now(), 'a0000000-0000-4000-8000-000000000001')
$$, '%not_the_approved_text%', 'only the approved text can be delivered');

select throws_like($$
  insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
  select organization_id, id, 'own_email', 'Emailed tomorrow', approved_body_sha256, now() + interval '2 days', 'a0000000-0000-4000-8000-000000000001'
    from quote_requests where id = 'f3330000-0000-4000-8000-00000000000e'
$$, '%delivered_in_future%', 'a delivery cannot be dated in the future');

-- A browser session (no server key) cannot record one.
select pg_temp.login('a0000000-0000-4000-8000-000000000001', false);
select throws_ok($$
  insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
  select organization_id, id, 'own_email', 'Emailed 10:02', approved_body_sha256, now(), 'a0000000-0000-4000-8000-000000000001'
    from quote_requests where id = 'f3330000-0000-4000-8000-00000000000e'
$$, NULL, 'a browser session without the server key cannot record a delivery');

select pg_temp.login('a0000000-0000-4000-8000-000000000001', true);
select lives_ok($$
  insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
  select organization_id, id, 'own_email', 'Emailed from Outlook 10:02', approved_body_sha256, now(), 'a0000000-0000-4000-8000-000000000001'
    from quote_requests where id = 'f3330000-0000-4000-8000-00000000000e'
$$, 'the API records the delivery of the approved text');

select throws_like($$
  insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
  select organization_id, id, 'own_email', 'Emailed twice', approved_body_sha256, now(), 'a0000000-0000-4000-8000-000000000001'
    from quote_requests where id = 'f3330000-0000-4000-8000-00000000000e'
$$, '%quote_request_deliveries_one_per_request%', 'one delivery per request');

-- Derived work state.
select throws_like($$
  select work_item_set_state('f3330000-0000-4000-8000-00000000000a', 'with_party', null, null, null, 'why', 'Chase', null)
$$, '%with_party_needs_party_and_since%', 'with_party must name the party and the date');
select lives_ok($$
  select work_item_set_state('f3330000-0000-4000-8000-00000000000a', 'with_party', 'Delivery Insurer', now(), now() + interval '3 days',
    'The client is waiting on terms.', 'Chase Delivery Insurer for terms', null)
$$, 'the API writes the derived next action onto the work item');
select is((select task_party || ' / ' || required_action from work_items where id = 'f3330000-0000-4000-8000-00000000000a'),
  'Delivery Insurer / Chase Delivery Insurer for terms', 'the work item names who holds it and what to do');

reset role;
select ok(exists (select 1 from audit_log where action = 'work_item.state_derived' and object_id = 'f3330000-0000-4000-8000-00000000000a'),
  'the derived state is audited');

-- Another brokerage sees none of it.
select pg_temp.login('b0000000-0000-4000-8000-000000000001', true);
select is_empty($$ select id from quote_request_deliveries $$, 'another brokerage sees no delivery, even with the API key');

select * from finish();
rollback;
