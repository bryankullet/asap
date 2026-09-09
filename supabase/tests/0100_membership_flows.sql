-- pgTAP: work item 4 membership flows (app.create_organization, invitations, memberships).
-- Runs against a migrated + seeded database. Rolls back at the end.
begin;
select plan(27);

create or replace function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

\set acme_admin  '''a0000000-0000-4000-8000-000000000001'''
\set acme_ae     '''a0000000-0000-4000-8000-000000000002'''
\set beta_admin  '''b0000000-0000-4000-8000-000000000001'''
\set acme        '''10000000-0000-4000-8000-00000000000a'''

-- 1. create_organization ---------------------------------------------------------
select pg_temp.login(:beta_admin);

select throws_like(
  $$ select app.create_organization('New Brokerage', null, 'KE', 'KES', 'Africa/Nairobi', false) $$,
  '%terms_not_accepted%', 'create_organization refuses without accepted terms');

select throws_like(
  $$ select app.create_organization('New Brokerage', null, 'Kenya', 'KES', 'Africa/Nairobi', true) $$,
  '%invalid_country%', 'create_organization validates ISO country');

select lives_ok(
  $$ create temp table t_new as select app.create_organization('Gamma Cover Ltd', 'Gamma Cover Limited', 'KE', 'KES', 'Africa/Nairobi', true) as id $$,
  'create_organization succeeds for a signed-in user');

select is((select count(*) from roles where organization_id = (select id from t_new)), 9::bigint,
  'nine system roles are created for the new organization');

select is((select count(*) from organization_memberships where organization_id = (select id from t_new) and is_owner and status = 'active'), 1::bigint,
  'creator is the single owner');

select is((select r.key from roles r join organization_memberships m on m.role_id = r.id
           where m.organization_id = (select id from t_new) and m.user_id = :beta_admin),
  'brokerage_admin', 'creator holds brokerage_admin');

select is((select active_organization_id from users where id = :beta_admin), (select id from t_new),
  'creator''s active organization switches to the new brokerage');

select is((select count(*) from audit_log where organization_id = (select id from t_new)), 2::bigint,
  'organization.created and membership.created audit rows exist');

-- 0029: the same person repeating the same request key gets the same brokerage, once.
select is(
  app.create_organization('Repeat Cover', null, 'KE', 'KES', 'Africa/Nairobi', true, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  app.create_organization('Repeat Cover', null, 'KE', 'KES', 'Africa/Nairobi', true, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'a repeated request key returns the same organization id');
select is((select count(*) from organizations where name = 'Repeat Cover'), 1::bigint,
  'and exactly one brokerage was created');

-- Every seeded user lands in a workspace (D-055): no fixture signs in to an empty Today.
select is((select count(*) from users u where u.email like '%.test' and u.active_organization_id is null),
  0::bigint, 'every seeded user has an active brokerage');
select is((select count(*) from users u
           where u.email like '%.test'
             and not exists (select 1 from organization_memberships m
                             where m.user_id = u.id and m.status = 'active'
                               and m.organization_id = u.active_organization_id)),
  0::bigint, 'and it is a brokerage they are an active member of');

-- 2. send_external matrix (D-022) -------------------------------------------------
reset role;
select is(
  (select count(distinct r.key) from roles r
     join role_permissions rp on rp.role_id = r.id
     join permissions p on p.id = rp.permission_id
   where r.organization_id = :acme and p.verb = 'send_external'),
  7::bigint, 'seven roles hold send_external');

select is(
  (select count(*) from roles r
     join role_permissions rp on rp.role_id = r.id
     join permissions p on p.id = rp.permission_id
   where r.organization_id = :acme and p.verb = 'send_external'
     and r.key in ('policy_administrator', 'read_only')),
  0::bigint, 'policy_administrator and read_only never hold send_external');

-- 3. invitations ----------------------------------------------------------------
select pg_temp.login(:acme_ae);
select throws_like(
  $$ select app.create_invitation('10000000-0000-4000-8000-00000000000a', 'someone@example.test',
       (select id from roles where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'claims_officer'),
       'hash-denied', 168) $$,
  '%permission_denied%', 'a role without user:create cannot invite');
reset role;

select pg_temp.login(:acme_admin);
select lives_ok(
  $$ create temp table t_inv as select app.create_invitation('10000000-0000-4000-8000-00000000000a', 'Newperson@Example.test',
       (select id from roles where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'claims_officer'),
       'hash-ok', 168) as id $$,
  'admin can invite');

select pg_temp.login(:beta_admin);
select throws_like($$ select app.accept_invitation('hash-ok') $$, '%invitation_email_mismatch%',
  'accepting with a different email is refused');

reset role;
insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values ('d0000000-0000-4000-8000-000000000001', 'newperson@example.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now());
select pg_temp.login('d0000000-0000-4000-8000-000000000001');
select is((select app.accept_invitation('hash-ok')), :acme::uuid, 'invitee accepts and gets the organization id');
select is((select app.accept_invitation('hash-ok')), :acme::uuid, 'accepting a second time is idempotent');
reset role;
select is((select count(*) from organization_memberships where organization_id = :acme and user_id = 'd0000000-0000-4000-8000-000000000001'),
  1::bigint, 'exactly one membership after two accepts');

update invitations set expires_at = now() - interval '1 hour', status = 'pending'
where organization_id = :acme and email = 'newhire@acme-brokers.test';
insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values ('d0000000-0000-4000-8000-000000000002', 'newhire@acme-brokers.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now());
select pg_temp.login('d0000000-0000-4000-8000-000000000002');
select throws_like(
  $$ select app.accept_invitation(encode(extensions.digest('seed-fixture-pending-token-A', 'sha256'), 'hex')) $$,
  '%invitation_expired%', 'an expired invitation cannot be accepted');

reset role;
insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values ('d0000000-0000-4000-8000-000000000003', 'former@beta-risk.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now());
select pg_temp.login('d0000000-0000-4000-8000-000000000003');
select throws_like(
  $$ select app.accept_invitation(encode(extensions.digest('seed-fixture-revoked-token-B', 'sha256'), 'hex')) $$,
  '%invitation_revoked%', 'a revoked invitation cannot be accepted');

-- 4. A brand-new signed-in user with zero memberships previews by token, then accepts ---------
-- The path the accept page takes: sign in (session exists, no brokerage yet) → GET preview →
-- POST accept → exactly one membership. Anon-level preview is the same function, granted to
-- anon in 0014, and is exercised by 0202.
reset role;
select pg_temp.login(:acme_admin);
select lives_ok(
  $$ create temp table t_inv2 as select app.create_invitation('10000000-0000-4000-8000-00000000000a', 'fresh@example.test',
       (select id from roles where organization_id = '10000000-0000-4000-8000-00000000000a' and key = 'renewals_officer'),
       'hash-fresh', 168) as id $$,
  'admin invites a person who has no account yet');
reset role;
insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values ('d0000000-0000-4000-8000-000000000004', 'fresh@example.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now());
select pg_temp.login('d0000000-0000-4000-8000-000000000004');
select is((select count(*) from organization_memberships), 0::bigint,
  'the new user starts with zero visible memberships');
select results_eq(
  $$ select organization_name, role_name, email, status from app.invitation_preview('hash-fresh') $$,
  $$ values ('Acme Insurance Brokers', 'Renewals officer', 'fresh@example.test', 'pending') $$,
  'a signed-in user with no memberships can preview the invitation by token');
select is((select app.accept_invitation('hash-fresh')), :acme::uuid, 'and accept it');
reset role;
select is((select count(*) from organization_memberships where user_id = 'd0000000-0000-4000-8000-000000000004'),
  1::bigint, 'ending with exactly one membership');

select * from finish();
rollback;
