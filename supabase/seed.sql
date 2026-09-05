-- =============================================================================
-- ASAP seed fixture — two brokerages, three users each, one cross-brokerage user.
-- Synthetic data only. This is the only data staging ever receives (docs/DECISIONS.md D-003).
--
-- Passwords: seeded auth users get a random, unrecoverable password so no credential lives in
-- git. Sign in locally with a magic link (Inbucket at http://127.0.0.1:54324) or set a password
-- with scripts/seed-set-passwords.sh. See docs/DECISIONS.md D-008.
--
-- IDs are fixed so pgTAP tests can reference them.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- auth.users + auth.identities (public.users rows are created by the 0004 trigger)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.seed_auth_user(p_id uuid, p_email text, p_full_name text)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current, phone_change,
    phone_change_token, reauthentication_token, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    -- random password nobody knows; bcrypt so GoTrue accepts the row
    extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    false,
    now(), now(), '', '', '', '', '', '', '', '', false, false
  )
  on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id, p_id::text, 'email',
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    now(), now(), now()
  )
  on conflict do nothing;
end;
$$;

do $$
begin
-- Brokerage A — Acme Insurance Brokers
perform pg_temp.seed_auth_user('a0000000-0000-4000-8000-000000000001', 'admin@acme-brokers.test',   'Amina Otieno');
perform pg_temp.seed_auth_user('a0000000-0000-4000-8000-000000000002', 'ae@acme-brokers.test',      'Brian Kamau');
perform pg_temp.seed_auth_user('a0000000-0000-4000-8000-000000000003', 'finance@acme-brokers.test', 'Cynthia Wanjiru');

-- Brokerage B — Beta Risk Partners
perform pg_temp.seed_auth_user('b0000000-0000-4000-8000-000000000001', 'admin@beta-risk.test',   'David Mwangi');
perform pg_temp.seed_auth_user('b0000000-0000-4000-8000-000000000002', 'ae@beta-risk.test',      'Esther Njeri');
perform pg_temp.seed_auth_user('b0000000-0000-4000-8000-000000000003', 'finance@beta-risk.test', 'Felix Odhiambo');

-- The deliberate third case: a member of BOTH brokerages. Breaks naive isolation code.
perform pg_temp.seed_auth_user('c0000000-0000-4000-8000-000000000001', 'shared@consultant.test', 'Grace Achieng');
end
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
insert into organizations (id, name, legal_name, country, timezone, currency, subscription_plan, created_by)
values
  ('10000000-0000-4000-8000-00000000000a', 'Acme Insurance Brokers', 'Acme Insurance Brokers Ltd', 'KE', 'Africa/Nairobi', 'KES', 'trial', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000000b', 'Beta Risk Partners',     'Beta Risk Partners Ltd',     'KE', 'Africa/Nairobi', 'KES', 'trial', 'b0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- the nine system roles and the permission matrix — single source: app.seed_default_roles (0014)
-- ---------------------------------------------------------------------------
do $$
declare o record;
begin
  for o in select id from organizations loop
    perform app.seed_default_roles(o.id);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------
insert into organization_memberships (organization_id, user_id, role_id, is_owner, invited_by)
select o.id, m.user_id, r.id, m.is_owner, case when m.is_owner then null else o.created_by end
from (values
  -- Brokerage A
  ('10000000-0000-4000-8000-00000000000a'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'brokerage_admin',   true),
  ('10000000-0000-4000-8000-00000000000a',       'a0000000-0000-4000-8000-000000000002',       'account_executive', false),
  ('10000000-0000-4000-8000-00000000000a',       'a0000000-0000-4000-8000-000000000003',       'finance_officer',   false),
  ('10000000-0000-4000-8000-00000000000a',       'c0000000-0000-4000-8000-000000000001',       'read_only',         false),
  -- Brokerage B
  ('10000000-0000-4000-8000-00000000000b',       'b0000000-0000-4000-8000-000000000001',       'brokerage_admin',   true),
  ('10000000-0000-4000-8000-00000000000b',       'b0000000-0000-4000-8000-000000000002',       'account_executive', false),
  ('10000000-0000-4000-8000-00000000000b',       'b0000000-0000-4000-8000-000000000003',       'finance_officer',   false),
  ('10000000-0000-4000-8000-00000000000b',       'c0000000-0000-4000-8000-000000000001',       'account_executive', false)
) as m(organization_id, user_id, role_key, is_owner)
join organizations o on o.id = m.organization_id
join roles r on r.organization_id = o.id and r.key = m.role_key;

-- ---------------------------------------------------------------------------
-- teams: one per brokerage
-- ---------------------------------------------------------------------------
insert into teams (id, organization_id, name, description, lead_user_id) values
  ('20000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Corporate accounts', 'Large commercial clients', 'a0000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', 'Retail',             'Personal lines',           'b0000000-0000-4000-8000-000000000002');

insert into user_team_memberships (team_id, user_id) values
  ('20000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- invitations: A has one pending, B has one revoked. Only the token hash is stored.
-- ---------------------------------------------------------------------------
insert into invitations (organization_id, email, role_id, token_hash, invited_by, status, expires_at)
select o.id, i.email, r.id, i.token_hash, o.created_by, i.status, i.expires_at
from (values
  ('10000000-0000-4000-8000-00000000000a'::uuid, 'newhire@acme-brokers.test', 'claims_officer',
   encode(extensions.digest('seed-fixture-pending-token-A', 'sha256'), 'hex'), 'pending', now() + interval '7 days'),
  ('10000000-0000-4000-8000-00000000000b',       'former@beta-risk.test',     'renewals_officer',
   encode(extensions.digest('seed-fixture-revoked-token-B', 'sha256'), 'hex'), 'revoked', now() - interval '1 day')
) as i(organization_id, email, role_key, token_hash, status, expires_at)
join organizations o on o.id = i.organization_id
join roles r on r.organization_id = o.id and r.key = i.role_key;

-- ---------------------------------------------------------------------------
-- one audit row and one event per brokerage, so tenant isolation tests have data to hide
-- ---------------------------------------------------------------------------
insert into audit_log (organization_id, actor_type, actor_user_id, action, object_type, object_id, new_state)
select o.id, 'user', o.created_by, 'organization.created', 'organization', o.id,
       jsonb_build_object('name', o.name, 'country', o.country)
from organizations o;

insert into events (organization_id, event_type, entity_type, entity_id, actor, actor_user_id, payload)
select o.id, 'user.action', 'organization', o.id, 'user', o.created_by,
       jsonb_build_object('action', 'organization.created')
from organizations o;

commit;
