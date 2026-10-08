-- pgTAP: claim settlement figures and endorsement premium adjustments (0077, D-154).
begin;
select plan(12);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label) values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap');

select ok((select relrowsecurity from pg_class where relname = 'endorsement_premium_adjustments'), 'row level security is on for premium adjustments');
select is_empty($$ select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = 'endorsement_premium_adjustments'
  and grantee in ('anon', 'authenticated', 'asap_worker') and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$, 'no role writes a premium adjustment directly');
select ok(exists(select 1 from pg_constraint where conname = 'endorsement_premium_adjustments_amount'), '"none" carries no amount; a premium always carries its currency');

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
create temp table t_wi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'claim', 'Jane Wanjiku — claim, incident 2026-09-02', 'Jane Wanjiku',
  '[{"id":"capture","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000b', null, null) ->> 'id')::uuid as id;
create temp table t_claim as select claim_create((select id from t_wi), '70000000-0000-4000-8000-00000000000b', null, '2026-09-02', 'Side mirror broken', 'manual') as id;

select throws_ok($$select claim_amount_record((select id from t_claim), 'offer', 50000, 'KES', null)$$, '22023', 'reference_first', 'the figure follows the voucher''s reference');
select lives_ok($$select claim_fact_record((select id from t_claim), 'offer', 'Discharge voucher DV-9')$$, 'the offer''s reference recorded');
select throws_ok($$select claim_amount_record((select id from t_claim), 'offer', 50000, 'kes', null)$$, '22023', 'amount_required', 'a currency is a three-letter code');
select lives_ok($$select claim_amount_record((select id from t_claim), 'offer', 50000, 'KES', null)$$, 'the offer''s figure recorded');
select throws_ok($$select claim_amount_record((select id from t_claim), 'offer', 60000, 'KES', null)$$, '23505', 'already_recorded', 'a figure is never overwritten');
select lives_ok($$select claim_fact_record((select id from t_claim), 'payment', 'RTGS FT-1')$$, 'the payment''s reference recorded');
select throws_ok($$select claim_amount_record((select id from t_claim), 'payment', 50000, 'KES', current_date + 3)$$, '22023', 'paid_on_required', 'a payment is received on a day that has happened');
select lives_ok($$select claim_amount_record((select id from t_claim), 'payment', 50000, 'KES', current_date)$$, 'the payment''s figure and day recorded');
select throws_ok($$select endorsement_premium_record(gen_random_uuid(), 'none', null, null, 'No change in premium')$$, 'P0002', 'not_found', 'an endorsement that is not there takes no adjustment');
reset role;
select * from finish();
rollback;
