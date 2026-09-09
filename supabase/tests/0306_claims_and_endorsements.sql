-- pgTAP: 0028 — a claim from email is a draft; the clock is all or nothing; the three settlement
-- facts never merge; a call note is a note; a confirmed endorsement is a new version that keeps
-- the old one and shows rejected items uncovered; transfer needs the policyholder's own instruction.
begin;
select plan(26);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-internal-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label) values (encode(extensions.digest('pgtap-internal-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap');

select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select throws_ok($$insert into policy_versions (organization_id, policy_id, version, effective_from, source) values ('10000000-0000-4000-8000-00000000000a', '90000000-0000-4000-8000-00000000000a', 9, '2026-06-01', 'import')$$,
  '42501', null, 'authenticated cannot write policy versions directly');

-- Claims -------------------------------------------------------------------
create temp table t_wi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'claim', 'Jane Wanjiku — claim, incident 2026-09-01', 'Jane Wanjiku',
  '[{"id":"capture","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000b', null, null) ->> 'id')::uuid as id;
create temp table t_claim as select claim_create((select id from t_wi), '70000000-0000-4000-8000-00000000000b', null, '2026-09-01', 'Rear-ended at Uhuru Highway, from the client''s email', 'email') as id;
select is((select status from claims where id = (select id from t_claim)), 'draft', 'a claim captured from email is a draft');
select throws_ok($$select claim_register((select id from t_claim), '91000000-0000-4000-8000-00000000000a')$$, '22023', 'period_not_this_clients',
  'registering against another client''s period is refused');
select lives_ok($$select claim_register((select id from t_claim), '91000000-0000-4000-8000-00000000000b')$$, 'a person registers it against Jane''s period');
select is((select status from claims where id = (select id from t_claim)), 'registered', 'now registered, by a person');

select throws_ok($$select claim_set_clock((select id from t_claim), 'Condition 3, notification', 4, 7, 'incident', '2026-09-01', null)$$,
  '22023', 'clock_inputs_incomplete', 'a clock without the start event''s evidence is refused');
select throws_ok($$select claim_set_clock((select id from t_claim), null, null, 7, 'incident', '2026-09-01', 'Client email 1 Sep')$$,
  '22023', 'clock_inputs_incomplete', 'a clock without the clause and its page is refused');
select is((select clock_clause_days from claims where id = (select id from t_claim)), null, 'nothing partial was stored');
select lives_ok($$select claim_set_clock((select id from t_claim), 'Condition 3, notification', 4, 7, 'incident', '2026-09-01', 'Client email 1 Sep')$$, 'a complete clock is stored');

select lives_ok($$select claim_fact_record((select id from t_claim), 'offer', 'Discharge voucher DV-118')$$, 'offer recorded');
select is((select acceptance_reference is null and payment_reference is null from claims where id = (select id from t_claim)), true,
  'recording the offer touches neither acceptance nor payment');
select lives_ok($$select claim_fact_record((select id from t_claim), 'acceptance', 'Signed DV-118 returned 12 Sep')$$, 'acceptance recorded separately');
select is((select payment_reference from claims where id = (select id from t_claim)), null, 'payment is still its own fact, unrecorded');
select throws_ok($$select claim_fact_record((select id from t_claim), 'offer', 'again')$$, '23505', 'already_recorded', 'a fact is recorded once');
select throws_ok($$select claim_fact_record((select id from t_claim), 'settled', 'x')$$, '22023', 'unknown_fact', 'there is no merged "settled" fact');

select lives_ok($$select claim_note_add((select id from t_claim), 'call_note', 'Mercy at Jubilee claims', 'Said the assessor visits Thursday')$$, 'a call note is stored as a note');
select is((select insurer_reference from claims where id = (select id from t_claim)), null, 'and nothing about the insurer''s words changed');

-- Endorsements ---------------------------------------------------------------
create temp table t_ewi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'endorsement', 'Acme Motors — add KDC 900T', 'Acme Motors',
  '[{"id":"classify","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'Motor commercial') ->> 'id')::uuid as id;
create temp table t_end as select endorsement_create((select id from t_ewi), '90000000-0000-4000-8000-00000000000a', 'add_item', 'policyholder', 'Acme Motors', 'Please add two vehicles', '2026-10-01',
  '[{"id":"kdc900t","label":"KDC 900T Isuzu FRR","before":null,"after":"Add","sumInsuredMinor":520000000,"decision":"pending","note":null},
    {"id":"kdd111a","label":"KDD 111A Nissan Caravan","before":null,"after":"Add","sumInsuredMinor":180000000,"decision":"pending","note":null}]') as id;
select throws_ok($$select endorsement_apply((select id from t_end))$$, '22023', 'items_undecided', 'nothing is applied while any item is undecided');
select lives_ok($$select endorsement_item_decide((select id from t_end), 'kdc900t', 'accepted', null, 'Jubilee email 20 Sep')$$, 'item 1 accepted');
select lives_ok($$select endorsement_item_decide((select id from t_end), 'kdd111a', 'rejected', 'Vehicle age above the insurer''s limit', 'Jubilee email 20 Sep')$$, 'item 2 rejected');
create temp table t_ver as select endorsement_apply((select id from t_end)) as id;
select is((select count(*) from policy_versions where policy_id = '90000000-0000-4000-8000-00000000000a'), 2::bigint, 'a confirmed change is a new version; the old one is kept');
select is((select effective_to from policy_versions where id = '92000000-0000-4000-8000-00000000000a'), '2026-09-30'::date, 'the old version ends the day before');
select is((select count(*) from policy_versions v, jsonb_array_elements(v.items) i where v.id = (select id from t_ver) and (i ->> 'status') = 'rejected_by_insurer' and (i ->> 'covered') = 'false'), 1::bigint,
  'the rejected item is on the new version, uncovered and visible');
reset role;

-- Transfer of ownership: a request from someone else is recorded but cannot be applied.
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
create temp table t_twi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'endorsement', 'Acme Motors — transfer KCB 100X', 'Acme Motors',
  '[{"id":"classify","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'Motor commercial') ->> 'id')::uuid as id;
create temp table t_tr as select endorsement_create((select id from t_twi), '90000000-0000-4000-8000-00000000000a', 'transfer_ownership', 'other', 'Peter Kamau (buyer)', 'Transfer KCB 100X to me', '2026-11-01',
  '[{"id":"kcb100x","label":"KCB 100X Toyota Probox","before":"Acme Motors","after":"Peter Kamau","sumInsuredMinor":null,"decision":"accepted","note":null}]') as id;
select throws_ok($$select endorsement_apply((select id from t_tr))$$, '42501', 'policyholder_instruction_required', 'a transfer requested by the buyer is recorded but cannot be applied');
select lives_ok($$select endorsement_record_instruction((select id from t_tr), 'Buyer''s letter 3 Oct', 'other', 'Peter Kamau')$$, 'the buyer''s letter is recorded');
select throws_ok($$select endorsement_apply((select id from t_tr))$$, '42501', 'policyholder_instruction_required', 'and still does not unblock it');
reset role;

select * from finish();
rollback;
