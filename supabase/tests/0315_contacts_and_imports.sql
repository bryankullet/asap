-- pgTAP: the people at a client, and bringing an existing book in (0039, 0040).
--
-- Two new surfaces, and the rules that must hold whatever the API does above them:
--   - a contact and an import belong to one brokerage, and another cannot read or write them
--   - one primary contact per client, refused by the database rather than remembered in code
--   - the same person twice on one client is a duplicate, not a second contact
--   - a premium is never half-recorded: an amount without a currency or a basis is refused
--   - a premium cannot claim to be verified without naming the document that verifies it
--   - a committed import cannot be committed twice from the same file
begin;
select plan(17);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

\set acme_ae  '''a0000000-0000-4000-8000-000000000002'''
\set beta_ae  '''b0000000-0000-4000-8000-000000000002'''
\set acme_org '''10000000-0000-4000-8000-00000000000a'''
\set beta_org '''10000000-0000-4000-8000-00000000000b'''

reset role;
create temp table t_client as
  select id from clients where organization_id = :acme_org and deleted_at is null limit 1;
create temp table t_period as
  select pp.id from policy_periods pp
  join policies p on p.id = pp.policy_id
  where pp.organization_id = :acme_org limit 1;
-- The fixtures are read as superuser so the seed decides them, then handed to the signed-in
-- roles: the isolation under test is the real tables', not these two scratch ones'.
grant select on t_client, t_period to authenticated;

-- Contacts: tenancy ---------------------------------------------------------------------------

select pg_temp.login(:acme_ae);
insert into client_contacts (organization_id, client_id, full_name, email, is_primary, created_by)
values (:acme_org, (select id from t_client), 'Grace Otieno', 'grace@tested.example', true, :acme_ae);
select is(
  (select count(*)::int from client_contacts where client_id = (select id from t_client)),
  1, 'a member of the brokerage can record a contact and read it back');

select pg_temp.login(:beta_ae);
select is((select count(*)::int from client_contacts), 0,
  'another brokerage sees no contacts at all — RLS, not a filter the API remembered');

select throws_ok(
  format($$ insert into client_contacts (organization_id, client_id, full_name)
            values (%L, %L, 'Planted') $$, :acme_org, (select id from t_client)),
  '42501', null, 'another brokerage cannot plant a contact on a client that is not theirs');

-- Contacts: the rules the database holds -------------------------------------------------------

select pg_temp.login(:acme_ae);
select throws_ok(
  format($$ insert into client_contacts (organization_id, client_id, full_name, is_primary)
            values (%L, %L, 'Second Primary', true) $$, :acme_org, (select id from t_client)),
  '23505', null, 'a client has one primary contact, refused by the database');

select lives_ok(
  format($$ insert into client_contacts (organization_id, client_id, full_name, email, role_label)
            values (%L, %L, 'Peter Kimani', 'peter@tested.example', 'Claims') $$,
         :acme_org, (select id from t_client)),
  'a second, non-primary contact is ordinary — a corporate client has several people');

select throws_ok(
  format($$ insert into client_contacts (organization_id, client_id, full_name, email)
            values (%L, %L, 'Grace Again', 'GRACE@tested.example') $$,
         :acme_org, (select id from t_client)),
  '23505', null, 'the same address twice on one client is a duplicate, whatever its case');

select throws_ok(
  format($$ insert into client_contacts (organization_id, client_id, full_name, email)
            values (%L, %L, 'No Address', 'not-an-address') $$, :acme_org, (select id from t_client)),
  '23514', null, 'something that is not an address does not go in the address column');

select lives_ok(
  format($$ insert into client_contacts (organization_id, client_id, full_name, phone)
            values (%L, %L, 'Phone Only', '+254700000000') $$, :acme_org, (select id from t_client)),
  'a contact with a phone and no email is a real contact, not an invalid one');

-- Premium: recorded, never half-recorded -------------------------------------------------------
--
-- These are constraints, not policies, so they are asserted with the writer's own rights. A
-- signed-in role cannot update `policy_periods` at all — engine writes go through SECURITY
-- DEFINER functions — and testing them from there would only re-prove that grant.
reset role;

select throws_ok(
  format($$ update policy_periods set premium_amount = 250000 where id = %L $$, (select id from t_period)),
  '23514', null, 'an amount without a currency and a basis is refused: it describes nothing');

select lives_ok(
  format($$ update policy_periods
              set premium_amount = 250000, premium_currency = 'KES', premium_basis = 'gross',
                  premium_source = 'import'
            where id = %L $$, (select id from t_period)),
  'an amount with its currency and its basis is a complete record');

select throws_ok(
  format($$ update policy_periods set premium_verified_at = now() where id = %L $$,
         (select id from t_period)),
  '23514', null, 'a figure cannot be verified by nothing: verification must name its document');

select throws_ok(
  format($$ update policy_periods set premium_basis = 'net' where id = %L $$, (select id from t_period)),
  '23514', null, 'the basis is one of two things, because only two things were meant');

select throws_ok(
  format($$ update policy_periods set commission_rate = 1.5 where id = %L $$, (select id from t_period)),
  '23514', null, 'a commission rate is a fraction of premium, not a percentage in the wrong units');

select is(
  (select commission_amount from policy_periods where id = (select id from t_period)),
  null, 'commission is not derived from premium: what the file did not say stays missing');

-- Imports: tenancy and the same-file rule ------------------------------------------------------

select pg_temp.login(:acme_ae);
insert into import_batches (organization_id, filename, content_sha256, row_count, premium_basis, status, created_by, committed_at)
values (:acme_org, 'book.csv', repeat('a', 64), 12, 'gross', 'committed', :acme_ae, now());

select throws_ok(
  format($$ insert into import_batches (organization_id, filename, content_sha256, row_count, status, created_by, committed_at)
            values (%L, 'book-again.csv', %L, 12, 'committed', %L, now()) $$,
         :acme_org, repeat('a', 64), :acme_ae),
  '23505', null, 'the same spreadsheet committed twice is refused, whatever it was renamed to');

select lives_ok(
  format($$ insert into import_batches (organization_id, filename, content_sha256, row_count, status, created_by)
            values (%L, 'attempt.csv', %L, 12, 'abandoned', %L) $$,
         :acme_org, repeat('a', 64), :acme_ae),
  'an abandoned preview of the same file does not block a corrected second attempt');

select pg_temp.login(:beta_ae);
select is((select count(*)::int from import_batches), 0,
  'another brokerage cannot see what this one imported');

select * from finish();
rollback;
