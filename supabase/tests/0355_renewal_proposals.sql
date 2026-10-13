-- pgTAP: 0090 (D-167) — saved, versioned renewal proposals. Numbered per renewal; only insurers on that
-- renewal's own quotation; job/edit; another brokerage can neither save nor read; insurers and answer
-- revisions are kept, never figures.
begin;
select plan(9);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-proposal-key-0123456789ab"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label) values (encode(extensions.digest('pgtap-proposal-key-0123456789ab', 'sha256'), 'hex'), 'pgtap-proposal');

-- A renewal with its quotation and one answer; and an insurer on some other quotation.
create temp table t_w as
  with w as (insert into work_items (organization_id, title, kind, task_status) values ('10000000-0000-4000-8000-00000000000a', 'Proposal test renewal', 'renewal', 'needs_you') returning id)
  select id from w;
create temp table t_o as
  with o as (insert into opportunities (organization_id, client_id, work_item_id, title, class_of_business, created_by)
    values ('10000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000a', (select id from t_w), 'Proposal test', 'Motor', 'a0000000-0000-4000-8000-000000000001') returning id)
  select id from o;
create temp table t_oi as
  with oi as (insert into opportunity_insurers (organization_id, opportunity_id, insurer_id, added_by)
    values ('10000000-0000-4000-8000-00000000000a', (select id from t_o), '60000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001') returning id)
  select id from oi;
insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id, outcome, received_at, premium_amount, premium_currency, source_note, recorded_by)
  values ('10000000-0000-4000-8000-00000000000a', (select id from t_o), (select id from t_oi), 'quoted', now(), 150000, 'KES', 'Email', 'a0000000-0000-4000-8000-000000000001');
create temp table t_other as
  with w as (insert into work_items (organization_id, title, kind, task_status) values ('10000000-0000-4000-8000-00000000000a', 'Other', 'new_business', 'needs_you') returning id),
       o as (insert into opportunities (organization_id, client_id, work_item_id, title, class_of_business, created_by)
         select '10000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000a', w.id, 'Other', 'Motor', 'a0000000-0000-4000-8000-000000000001' from w returning id),
       oi as (insert into opportunity_insurers (organization_id, opportunity_id, insurer_id, added_by)
         select '10000000-0000-4000-8000-00000000000a', o.id, '60000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001' from o returning id)
  select id from oi;
grant select on t_w, t_oi, t_other to authenticated;

select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select throws_ok($$select renewal_proposal_save((select id from t_w), array[(select id from t_oi)], null)$$, '42501', 'permission_denied', 'read-only cannot save a proposal');
reset role;
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select throws_ok($$select renewal_proposal_save((select id from t_w), array[(select id from t_oi)], null)$$, 'P0002', 'not_found', 'another brokerage cannot find the renewal');
reset role;
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select throws_ok($$select renewal_proposal_save((select id from t_w), array[(select id from t_other)], null)$$, '23514', 'not_on_this_quotation', 'only insurers on this renewal''s quotation');
select throws_ok($$select renewal_proposal_save((select id from t_w), array[]::uuid[], null)$$, '23514', 'proposal_size', 'a proposal explores at least one insurer');
select is((renewal_proposal_save((select id from t_w), array[(select id from t_oi)], 'First') ->> 'version')::int, 1, 'the first proposal is v1');
select is((renewal_proposal_save((select id from t_w), array[(select id from t_oi)], null) ->> 'version')::int, 2, 'the next is v2');
reset role;
select is((select (revisions ->> (select id::text from t_oi))::int from renewal_proposals where work_item_id = (select id from t_w) and version = 1), 1, 'it keeps the answer revision, not the figure');
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from renewal_proposals), 0, 'another brokerage reads no proposals');
reset role;
select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from renewal_proposals where work_item_id = (select id from t_w)), 2, 'a read-only member reads them');
reset role;
select * from finish();
rollback;
