-- pgTAP: 0085 (D-164) — claim and policy-change mutations require claim:create/edit or policy:edit,
-- not only membership. A read-only member is refused even through the API path; a member with the
-- permission still succeeds; another brokerage is still not a member.
begin;
select plan(14);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-asap-api-key":"pgtap-perm-key-0123456789abcdef"}', true);
  perform set_config('role', 'authenticated', true);
end $$;
insert into app.api_keys (key_hash, label) values (encode(extensions.digest('pgtap-perm-key-0123456789abcdef', 'sha256'), 'hex'), 'pgtap-perm');

-- An account executive (claim and policy create/edit) opens a claim and a policy change.
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
create temp table t_wi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'claim', 'Permission test claim', 'Jane Wanjiku',
  '[{"id":"capture","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000b', null, null) ->> 'id')::uuid as id;
create temp table t_claim as select claim_create((select id from t_wi), '70000000-0000-4000-8000-00000000000b', null, '2026-09-01', 'Permission test', 'manual') as id;
create temp table t_doc as select claim_document_add((select id from t_claim), 'Police abstract', 'client') as id;
create temp table t_ewi as select (work_item_create('10000000-0000-4000-8000-00000000000a', 'endorsement', 'Permission test change', 'Acme Motors',
  '[{"id":"classify","label":"x","actor":"asap","state":"now","guards":[],"evidence":[],"actions":[],"party":null,"reason":null,"recorded":[],"runId":null}]',
  'in_progress', null, '70000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'Motor commercial') ->> 'id')::uuid as id;
create temp table t_end as select endorsement_create((select id from t_ewi), '90000000-0000-4000-8000-00000000000a', 'add_item', 'policyholder', 'Acme Motors', 'Add a vehicle', '2026-10-01',
  '[{"id":"v1","label":"KDC 1","before":null,"after":"Add","sumInsuredMinor":100,"decision":"pending","note":null}]') as id;
select ok((select id from t_claim) is not null and (select id from t_end) is not null, 'an account executive opens a claim and a policy change');
reset role;
grant select on t_wi, t_claim, t_doc, t_ewi, t_end to authenticated;

-- A read-only member of the same brokerage, calling through the API path, is refused every write.
select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select throws_ok($$select claim_document_receive((select id from t_doc), 'Emailed by client')$$, '42501', 'permission_denied', 'read-only cannot record a claim document as received');
select throws_ok($$select claim_document_add((select id from t_claim), 'Logbook', 'client')$$, '42501', 'permission_denied', 'read-only cannot add a claim document');
select throws_ok($$select claim_note_add((select id from t_claim), 'call_note', 'Client', 'Called')$$, '42501', 'permission_denied', 'read-only cannot add a call note');
select throws_ok($$select claim_set_insurer_reference((select id from t_claim), 'CLM-1')$$, '42501', 'permission_denied', 'read-only cannot set the insurer reference');
select throws_ok($$select claim_fact_record((select id from t_claim), 'offer', 'DV-1')$$, '42501', 'permission_denied', 'read-only cannot record a claim fact');
select throws_ok($$select claim_amount_record((select id from t_claim), 'offer', 1000, 'KES', null)$$, '42501', 'permission_denied', 'read-only cannot record a claim amount');
select throws_ok($$select endorsement_item_decide((select id from t_end), 'v1', 'accepted', null, 'Insurer email')$$, '42501', 'permission_denied', 'read-only cannot record an insurer decision');
select throws_ok($$select endorsement_premium_record((select id from t_end), 'none', null, null, 'Insurer email')$$, '42501', 'permission_denied', 'read-only cannot record a premium adjustment');
select throws_ok($$select endorsement_create((select id from t_ewi), '90000000-0000-4000-8000-00000000000a', 'add_item', 'policyholder', 'Acme', 'x', '2026-10-01', '[]')$$, '42501', 'permission_denied', 'read-only cannot open a policy change');
select is((select received_at from claim_documents where id = (select id from t_doc)), null, 'nothing was recorded by the refused calls');
reset role;

-- Another brokerage is still not a member, before any permission is consulted.
select pg_temp.login('b0000000-0000-4000-8000-000000000001');
select throws_ok($$select claim_document_receive((select id from t_doc), 'x')$$, '42501', 'not_a_member', 'another brokerage is refused as a non-member');
reset role;

-- The member with the permission still can.
select pg_temp.login('a0000000-0000-4000-8000-000000000002');
select lives_ok($$select claim_document_receive((select id from t_doc), 'Emailed by client 12 Oct')$$, 'an account executive records the document');
select lives_ok($$select endorsement_item_decide((select id from t_end), 'v1', 'accepted', null, 'Insurer email 12 Oct')$$, 'an account executive records the insurer decision');
reset role;
select * from finish();
rollback;
