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

-- ---------------------------------------------------------------------------
-- work items and runs (UI Build Spec Phase 1): enough for Today, the four Work views and the
-- Activity chip to show real rows. Titles name the record or outcome, never a recipe.
-- ---------------------------------------------------------------------------
insert into work_items (id, organization_id, title, kind, owner_id, task_status, task_party, task_since, task_next_check, cover_status, money_status, reason, steps, completed_at, updated_at)
values
  -- Acme
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a',
   'Acme Motors — renewal terms from Jubilee', 'renewal', 'a0000000-0000-4000-8000-000000000002',
   'with_party', 'Jubilee', now() - interval '3 days', now() + interval '2 days', 'active', 'unpaid',
   'Terms were requested from Jubilee three days ago; the next check is in two days.',
   '[{"id":"s1","label":"Request terms","actor":"you","state":"done"},{"id":"s2","label":"Terms received","actor":"insurer","state":"now"},{"id":"s3","label":"Compare and recommend","actor":"asap","state":"todo"}]',
   null, now() - interval '1 hour'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a',
   'KDA 482A — motor certificate', 'certificate', 'a0000000-0000-4000-8000-000000000002',
   'needs_you', null, null, null, 'confirmed', null,
   'Cover is confirmed but no certificate number has been allocated for this vehicle.',
   '[{"id":"s1","label":"Cover confirmed","actor":"insurer","state":"done"},{"id":"s2","label":"Allocate a number","actor":"you","state":"now"},{"id":"s3","label":"Issue","actor":"you","state":"todo"}]',
   null, now() - interval '20 minutes'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a',
   'Jane Wanjiku — claim review pack', 'claim', 'a0000000-0000-4000-8000-000000000002',
   'in_progress', null, null, null, 'active', null,
   'ASAP is assembling the missing-document list from the claim form.',
   '[{"id":"s1","label":"Claim form received","actor":"client","state":"done"},{"id":"s2","label":"List missing documents","actor":"asap","state":"now"}]',
   null, now() - interval '5 minutes'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000000a',
   'Acme Motors — Q2 statement reconciled', 'reconciliation', 'a0000000-0000-4000-8000-000000000003',
   'done', null, null, null, null, 'reconciled',
   null, '[{"id":"s1","label":"Statement imported","actor":"finance","state":"done"},{"id":"s2","label":"Lines matched","actor":"asap","state":"done"}]',
   now() - interval '2 days', now() - interval '2 days'),
  -- Beta
  ('30000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b',
   'Otieno household — new business quote', 'new_business', 'b0000000-0000-4000-8000-000000000002',
   'needs_you', null, null, null, 'draft', 'not_invoiced',
   'Three quotes are back; a recommendation is waiting for you.',
   '[{"id":"s1","label":"Quotes requested","actor":"you","state":"done"},{"id":"s2","label":"Choose and recommend","actor":"you","state":"now"}]',
   null, now() - interval '30 minutes'),
  ('30000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000b',
   'Beta Risk — CIC premium statement', 'money_in', 'b0000000-0000-4000-8000-000000000003',
   'with_party', 'CIC', now() - interval '6 days', now() + interval '1 day', null, 'part_paid',
   'CIC has acknowledged the query and owes a reply by tomorrow.',
   '[]', null, now() - interval '6 days');

insert into runs (id, organization_id, work_item_id, title, status, next_step, started_by, started_at, ended_at)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000003',
   'Missing-document list', 'working', null, 'a0000000-0000-4000-8000-000000000002', now() - interval '5 minutes', null),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000001',
   'Renewal pack prepared', 'finished', null, 'a0000000-0000-4000-8000-000000000002', now() - interval '3 days', now() - interval '3 days' + interval '4 minutes'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000002',
   'Certificate extraction', 'could_not_finish', 'Check this file', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 hour', now() - interval '55 minutes'),
  ('40000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b',
   'Quote comparison prepared', 'finished', null, 'b0000000-0000-4000-8000-000000000002', now() - interval '40 minutes', now() - interval '31 minutes');

-- ---------------------------------------------------------------------------
-- Phase 4: insurers, clients (every one lands not_started), agreements and rates
-- ---------------------------------------------------------------------------
insert into insurers (id, organization_id, name) values
  ('60000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Jubilee'),
  ('60000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'CIC'),
  ('60000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000b', 'CIC');

insert into clients (id, organization_id, name, kind, source, created_by) values
  ('70000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', 'Acme Motors', 'corporate', 'seed', 'a0000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000a', 'Jane Wanjiku', 'individual', 'seed', 'a0000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000b', 'Otieno household', 'individual', 'seed', 'b0000000-0000-4000-8000-000000000001');

-- Jane's identity document has been received; her file is incomplete, not cleared.
insert into client_file_documents (organization_id, client_id, kind, label, reference, received_at, recorded_by) values
  ('10000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000b', 'identity', 'National ID', 'Scan received 2 Sep', now() - interval '6 days', 'a0000000-0000-4000-8000-000000000002');
update clients set file_status = 'incomplete', file_owner_id = 'a0000000-0000-4000-8000-000000000002' where id = '70000000-0000-4000-8000-00000000000b';

update work_items set client_id = '70000000-0000-4000-8000-00000000000a', insurer_id = '60000000-0000-4000-8000-00000000000a', class_of_business = 'Motor commercial'
 where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004');
update work_items set client_id = '70000000-0000-4000-8000-00000000000a', insurer_id = '60000000-0000-4000-8000-00000000000a', class_of_business = 'Motor private'
 where id = '30000000-0000-4000-8000-000000000002';
update work_items set client_id = '70000000-0000-4000-8000-00000000000b' where id = '30000000-0000-4000-8000-000000000003';
update work_items set client_id = '70000000-0000-4000-8000-00000000000c', insurer_id = '60000000-0000-4000-8000-00000000000c', class_of_business = 'Domestic package'
 where id = '30000000-0000-4000-8000-00000000000b';

-- A placement for Acme Motors sitting at approval: the gate blocks it (file not started).
insert into work_items (id, organization_id, title, kind, client_id, insurer_id, class_of_business, owner_id, task_status, cover_status, reason, steps)
values ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-00000000000a',
  'Acme Motors — Motor commercial placement with Jubilee', 'placement', '70000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'Motor commercial',
  'a0000000-0000-4000-8000-000000000002', 'needs_you', 'requested',
  'Approval is blocked until Acme Motors'' client file is cleared.',
  '[{"id":"prepare","label":"Placement prepared","actor":"asap","state":"done","guards":[],"evidence":[],"actions":[{"verb":"prepare","label":"Prepare the placement","guards":[],"disabledReason":null}],"party":null,"reason":null,"recorded":[],"runId":null},
    {"id":"approve","label":"Placement approved","actor":"you","state":"now","guards":["client_file_cleared","version_current"],"evidence":[{"kind":"approval","label":"Approval record"}],"actions":[{"verb":"approve","label":"Approve","guards":["client_file_cleared","version_current"],"disabledReason":null}],"party":null,"reason":null,"recorded":[],"runId":null},
    {"id":"instruct","label":"Jubilee instructed","actor":"you","state":"todo","guards":[],"evidence":[{"kind":"record_send","label":"The instruction as sent"}],"actions":[{"verb":"draft","label":"Draft the instruction","guards":[],"disabledReason":null},{"verb":"record_send","label":"I sent this","guards":["evidence_present"],"disabledReason":null}],"party":null,"reason":null,"recorded":[],"runId":null},
    {"id":"requirements","label":"Underwriting requirements","actor":"insurer","state":"todo","guards":[],"evidence":[{"kind":"document","label":"Each requirement and its response"}],"actions":[{"verb":"record_evidence","label":"Record the requirements","guards":["evidence_present"],"disabledReason":null}],"party":"Jubilee","reason":null,"recorded":[],"runId":null},
    {"id":"cover_confirmed","label":"Cover confirmed","actor":"insurer","state":"todo","guards":[],"evidence":[{"kind":"confirmation","label":"Cover note or written confirmation"}],"actions":[{"verb":"record_evidence","label":"Record the confirmation","guards":["evidence_present"],"disabledReason":null}],"party":"Jubilee","reason":null,"recorded":[],"runId":null},
    {"id":"documents","label":"Policy documents checked","actor":"asap","state":"todo","guards":[],"evidence":[],"actions":[{"verb":"prepare","label":"Check the documents","guards":[],"disabledReason":null}],"party":null,"reason":null,"recorded":[],"runId":null},
    {"id":"complete","label":"Acme Motors — Motor commercial placed","actor":"you","state":"todo","guards":[],"evidence":[],"actions":[{"verb":"complete","label":"Complete","guards":["evidence_present","version_current"],"disabledReason":null},{"verb":"exception","label":"Record an exception","guards":[],"disabledReason":null}],"party":null,"reason":null,"recorded":[],"runId":null}]');

-- Jubilee: an agreement with one confirmed rate and one proposed by ASAP awaiting confirmation. CIC: no agreement.
insert into agreements (id, organization_id, insurer_id, document_reference, created_by) values
  ('80000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'Jubilee agency agreement 2026.pdf', 'a0000000-0000-4000-8000-000000000001');
insert into agreement_versions (id, organization_id, agreement_id, version, effective_from, payment_terms_days, document_reference, created_by) values
  ('81000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a', '80000000-0000-4000-8000-00000000000a', 1, '2026-01-01', 60, 'Jubilee agency agreement 2026.pdf', 'a0000000-0000-4000-8000-000000000001');
insert into agreement_rates (organization_id, version_id, class_of_business, rate_basis_points, clause_reference, proposed_by, proposed_by_user, confirmed_by, confirmed_at) values
  ('10000000-0000-4000-8000-00000000000a', '81000000-0000-4000-8000-00000000000a', 'Motor private', 1000, 'Schedule A, clause 4.1', 'person', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now() - interval '30 days'),
  ('10000000-0000-4000-8000-00000000000a', '81000000-0000-4000-8000-00000000000a', 'Motor commercial', 1250, 'Schedule A, clause 4.2', 'asap', null, null, null);

commit;
