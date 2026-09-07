# Phase 1 Schema

Canonical column-level definition for the eleven Phase 1 tables. The architecture document lists table *names*; this document is the contract for their *columns*. If the code and this document disagree, one of them is a bug — fix both in the same PR.

**Conventions**
- Primary keys: `uuid` default `gen_random_uuid()`.
- Timestamps: `timestamptz`, default `now()`.
- Soft delete: `deleted_at timestamptz` on tenant business records. Queries filter it; RLS does not.
- Every tenant table carries `organization_id uuid not null references organizations(id) on delete cascade`.
- Enumerations are Postgres `text` with a `check` constraint, not `enum` types. Adding a value to a native enum requires a migration lock; a check constraint does not.
- Migration files are numbered and append-only.

---

## Migration order

Files are named `<version>_<nnnn>_<name>.sql`. The 14-digit version is what the Supabase migration ledger records and what every environment must agree on (D-034); the `nnnn` sequence and name are how the documents below refer to them. Append-only: a new migration takes a fresh timestamp that sorts after the last one.

```
20260907114924_0001_extensions.sql
20260907115449_0002_app_schema_and_helpers.sql
20260907115531_0003_organizations.sql
20260907115745_0004_users.sql
20260907115802_0005_roles_and_permissions.sql
20260907115820_0006_memberships.sql
20260907120611_0007_teams.sql
20260907120628_0008_invitations.sql
20260907134159_0009_audit_log.sql
20260907134224_0010_events.sql
20260907134623_0011_rls_policies.sql
20260907134639_0012_storage.sql
20260907140717_0013_worker_role.sql
20260907140829_0014_data_api_grants_and_membership_flows.sql
```

---

## 0001 — Extensions

```sql
create extension if not exists "pgcrypto";      -- gen_random_uuid
create extension if not exists "pg_trgm";       -- fuzzy name matching, Phase 2
create extension if not exists "vector";        -- pgvector, Phase 3
```

---

## 0002 — App schema and helper functions

```sql
create schema if not exists app;

-- SQL-language bodies are validated at creation and reference tables from 0005/0006 (D-015).
set check_function_bodies = off;

-- Organizations the signed-in user actively belongs to.
create or replace function app.current_user_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.organization_id
  from organization_memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

-- Organization context set by a background worker.
-- Returns null when unset, which every policy treats as "no access".
create or replace function app.worker_org()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.organization_id', true), '')::uuid;
$$;

-- Single predicate used by every tenant policy.
create or replace function app.can_access(org uuid)
returns boolean
language sql
stable
as $$
  select org is not null
     and (org = app.worker_org() or org in (select app.current_user_orgs()));
$$;

-- Permission check for a specific verb on an object type.
create or replace function app.has_permission(org uuid, obj text, verb text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_memberships m
    join role_permissions rp on rp.role_id = m.role_id
    join permissions p on p.id = rp.permission_id
    where m.user_id = auth.uid()
      and m.organization_id = org
      and m.status = 'active'
      and p.object_type = obj
      and p.verb = verb
  );
$$;
```

`security definer` on `current_user_orgs` is deliberate: the function reads `organization_memberships`, which is itself RLS-protected, and would otherwise recurse.

---

## 0003 — organizations

```sql
create table organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  legal_name         text,
  country            text not null,                      -- ISO 3166-1 alpha-2
  timezone           text not null default 'Africa/Nairobi',
  currency           text not null default 'KES',        -- ISO 4217
  settings           jsonb not null default '{}'::jsonb,
  subscription_plan  text not null default 'trial'
                     check (subscription_plan in ('trial','standard','professional','enterprise')),
  status             text not null default 'active'
                     check (status in ('active','suspended','offboarding','closed')),
  created_by         uuid,                                -- users.id, set after first user exists
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index on organizations (status) where deleted_at is null;
```

`settings` holds brokerage-level configuration that does not warrant its own column: default levy rates, working hours, approval thresholds. Anything queried or joined on gets promoted to a real column.

---

## 0004 — users

A profile table mirroring `auth.users`. Application code never reads `auth.users` directly.

```sql
create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  full_name     text,
  display_name  text,
  avatar_url    text,
  phone         text,
  locale        text not null default 'en',
  timezone      text,
  last_seen_at  timestamptz,
  status        text not null default 'active'
                check (status in ('active','disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app.handle_new_auth_user();
```

`users` is **not** tenant-scoped. A person can work at two brokerages. Tenancy lives in `organization_memberships`.

---

## 0005 — roles and permissions

```sql
create table roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  key              text not null,                         -- stable identifier
  name             text not null,                         -- shown to users
  description      text,
  is_system        boolean not null default false,        -- seeded template, not user-created
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, key)
);

create table permissions (
  id           uuid primary key default gen_random_uuid(),
  object_type  text not null,   -- 'client','policy','claim','document','email',
                                -- 'quote','placement','invoice','payment','commission',
                                -- 'space','job','automation','report','user','role',
                                -- 'organization','audit'
  verb         text not null
               check (verb in ('view','create','edit','approve','export',
                               'delete','send_external','ai_execute')),
  description  text,
  unique (object_type, verb)
);

create table role_permissions (
  role_id        uuid not null references roles(id) on delete cascade,
  permission_id  uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
```

`permissions` is global reference data, not tenant-scoped — the same verbs exist everywhere. `roles` is tenant-scoped because a brokerage may rename or add one.

Migration 0005 also inserts the full permission catalogue (18 object types × 8 verbs = 144 rows), because production needs it and seeds do not run there (D-009).

**Seeded role keys** (created for every new organization by `app.seed_default_roles`, migration 0014): `brokerage_admin`, `account_executive`, `placement_officer`, `policy_administrator`, `claims_officer`, `renewals_officer`, `finance_officer`, `manager`, `read_only`.

Two verbs deserve attention. `send_external` controls whether a user can dispatch anything to a client or insurer — the boundary the approval engine defends. `ai_execute` controls whether the user may ask ASAP to *perform* an action rather than only answer.

---

## 0006 — organization_memberships

```sql
create table organization_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  role_id          uuid not null references roles(id) on delete restrict,
  status           text not null default 'active'
                   check (status in ('active','suspended','removed')),
  is_owner         boolean not null default false,
  invited_by       uuid references users(id),
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index on organization_memberships (user_id) where status = 'active';
create index on organization_memberships (organization_id) where status = 'active';

-- Exactly one owner per organization.
create unique index on organization_memberships (organization_id)
  where is_owner and status = 'active';
```

`role_id` uses `on delete restrict`: deleting a role that people hold must fail loudly rather than orphan a membership.

---

## 0007 — teams

```sql
create table teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  description      text,
  lead_user_id     uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (organization_id, name)
);

create table user_team_memberships (
  team_id     uuid not null references teams(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);
```

Teams do not grant permissions in Phase 1. They exist for assignment and workload views later. Do not build team-based access control now.

---

## 0008 — invitations

```sql
create table invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  email            text not null,
  role_id          uuid not null references roles(id) on delete restrict,
  token_hash       text not null unique,     -- store the hash, never the token
  invited_by       uuid not null references users(id),
  status           text not null default 'pending'
                   check (status in ('pending','accepted','revoked','expired')),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index on invitations (organization_id, status);

-- One live invitation per email per organization.
create unique index on invitations (organization_id, lower(email))
  where status = 'pending';
```

The raw token goes in the email link only. The table stores its hash, so a database leak does not hand out memberships.

---

## 0009 — audit_log

```sql
create table audit_log (
  id                  bigint generated always as identity primary key,
  organization_id     uuid not null references organizations(id) on delete cascade,
  actor_type          text not null
                      check (actor_type in ('user','ai','automation','system')),
  actor_user_id       uuid references users(id),
  action              text not null,          -- 'membership.created','role.updated', ...
  object_type         text not null,
  object_id           uuid,
  previous_state      jsonb,
  new_state           jsonb,
  evidence            jsonb,                  -- document/chunk refs, Phase 3 onward
  approval_id         uuid,                   -- Phase 6
  automation_run_id   uuid,                   -- Phase 12
  result              text not null default 'success'
                      check (result in ('success','failure','denied')),
  failure_reason      text,
  ip_address          inet,
  user_agent          text,
  occurred_at         timestamptz not null default now()
);

create index on audit_log (organization_id, occurred_at desc);
create index on audit_log (organization_id, object_type, object_id);
create index on audit_log (organization_id, actor_user_id, occurred_at desc);
```

**Insert-only.** No application role gets `update` or `delete`:

```sql
revoke update, delete on audit_log from authenticated, anon;
```

A denied action is still an audit row, with `result = 'denied'`. Failed access attempts are exactly what an audit trail is for.

---

## 0010 — events

```sql
create table events (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  event_type           text not null,
  entity_type          text,
  entity_id            uuid,
  actor                text not null default 'system'
                       check (actor in ('user','ai','automation','system')),
  actor_user_id        uuid references users(id),
  payload              jsonb not null default '{}'::jsonb,   -- before/after for changes
  occurred_at          timestamptz not null default now(),
  processed_at         timestamptz,
  processing_attempts  integer not null default 0,
  last_error           text
);

create index on events (organization_id, occurred_at desc);
create index on events (organization_id, event_type, occurred_at desc);
create index on events (occurred_at) where processed_at is null;
create index on events (entity_type, entity_id);

-- Per-consumer idempotency. One event, many consumers, each recording its own outcome.
create table event_deliveries (
  event_id      uuid not null references events(id) on delete cascade,
  consumer      text not null,
  processed_at  timestamptz not null default now(),
  result        text not null default 'success'
                check (result in ('success','failure','skipped')),
  error         text,
  primary key (event_id, consumer)
);
```

**Phase 1 event types:** `record.changed`, `schedule.fired`, `user.action`. The full catalogue in §29 arrives with its phase — do not pre-create handlers for events nothing emits yet.

`events` is a dispatch log with a retention policy, not the system of record. Business facts live in business tables.

---

## 0011 — RLS policies

```sql
-- Tenant tables
alter table organizations              enable row level security;
alter table roles                      enable row level security;
alter table organization_memberships   enable row level security;
alter table teams                      enable row level security;
alter table user_team_memberships      enable row level security;
alter table invitations                enable row level security;
alter table audit_log                  enable row level security;
alter table events                     enable row level security;
alter table event_deliveries           enable row level security;
alter table users                      enable row level security;
alter table permissions                enable row level security;
alter table role_permissions           enable row level security;   -- reached through roles (D-010)

-- Standard tenant pattern, repeated per table.
-- role_permissions and user_team_memberships carry no organization_id; their policies check the
-- parent roles / teams row with app.can_access.
create policy tenant_read on roles
  for select using (app.can_access(organization_id));

create policy tenant_write on roles
  for all using (app.can_access(organization_id))
  with check (app.can_access(organization_id));
```

The `with check` clause is not optional. Without it a user can read only their own rows but still *insert* a row stamped with another organization's ID.

```sql
-- organizations: keyed on id, not organization_id
create policy org_read on organizations
  for select using (app.can_access(id));

create policy org_write on organizations
  for update using (app.can_access(id))
  with check (app.can_access(id));

-- users: yourself, plus anyone sharing an organization with you
create policy user_self on users
  for select using (
    id = auth.uid()
    or exists (
      select 1 from organization_memberships m
      where m.user_id = users.id
        and m.status = 'active'
        and m.organization_id in (select app.current_user_orgs())
    )
  );

-- plus a third clause: members of app.worker_org(), so workers can resolve actors (D-011).

create policy user_update_self on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- permissions: global reference data, readable by any signed-in user
create policy permissions_read on permissions
  for select to authenticated using (true);

-- audit_log: insert and read only
create policy audit_read on audit_log
  for select using (app.can_access(organization_id));

create policy audit_insert on audit_log
  for insert with check (app.can_access(organization_id));

-- event_deliveries: reached through its event
create policy delivery_all on event_deliveries
  for all using (
    exists (select 1 from events e
            where e.id = event_deliveries.event_id
              and app.can_access(e.organization_id))
  )
  with check (
    exists (select 1 from events e
            where e.id = event_deliveries.event_id
              and app.can_access(e.organization_id))
  );
```

**Coverage guard.** This test is the reason Phase 2 will not leak:

```sql
-- supabase/tests/rls_coverage.sql
select is_empty($$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.columns col
    on col.table_name = c.relname and col.table_schema = 'public'
  where n.nspname = 'public'
    and c.relkind = 'r'
    and col.column_name = 'organization_id'
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policies p
                        where p.tablename = c.relname and p.schemaname = 'public'))
$$, 'every table with organization_id has RLS enabled and at least one policy');
```

---

## 0012 — Storage

```sql
insert into storage.buckets (id, name, public)
values ('insurance-documents', 'insurance-documents', false)
on conflict (id) do nothing;

-- Path: organization_id/entity_type/entity_id/document_id/filename
create policy doc_read on storage.objects
  for select using (
    bucket_id = 'insurance-documents'
    and app.can_access((storage.foldername(name))[1]::uuid)
  );

create policy doc_write on storage.objects
  for insert with check (
    bucket_id = 'insurance-documents'
    and app.can_access((storage.foldername(name))[1]::uuid)
  );

create policy doc_delete on storage.objects
  for delete using (
    bucket_id = 'insurance-documents'
    and app.can_access((storage.foldername(name))[1]::uuid)
  );
```

The API still checks permission before issuing a signed URL. Storage RLS is the second line, not the only one.

---

## 0013 — Worker role

The Supabase `service_role` bypasses RLS entirely, which would make `app.worker_org()` decorative. Workers get their own role instead.

```sql
-- Created NOLOGIN with no password, idempotently; the password is set per environment by
-- `pnpm db:worker-password` (D-006). psql variables are not substituted by the Supabase CLI.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'asap_worker') then
    create role asap_worker nologin noinherit;
  end if;
end $$;

grant usage on schema public, app to asap_worker;
grant select, insert, update, delete on all tables in schema public to asap_worker;
grant usage, select on all sequences in schema public to asap_worker;
grant execute on all functions in schema app to asap_worker;

alter default privileges in schema public
  grant select, insert, update, delete on tables to asap_worker;

-- Critically: no bypassrls. RLS applies, and app.worker_org() decides what it sees.
alter role asap_worker nobypassrls;

-- audit_log stays insert-only for workers too; workers may read the permission catalogue.
revoke update, delete, truncate on audit_log from asap_worker;
create policy permissions_read_worker on permissions for select to asap_worker using (true);
```

Worker usage:

```ts
// apps/workers/src/db/withOrganization.ts
export async function withOrganization<T>(
  organizationId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}
```

The `true` third argument scopes the setting to the transaction, so it cannot leak into the next job on a pooled connection. **Every worker database call goes through this helper.** A direct `db.select()` in a worker is a bug.

---

## 0014 — Data API grants and membership flows (work item 4)

Added by work item 4; not in the original eleven-table plan. Three parts:

1. **Explicit Data API grants.** The hosted project has "Automatically expose new tables" off (D-020), so `authenticated` receives an explicit allowlist: `select` on every Phase 1 table; `insert/update/delete` on `teams` and `user_team_memberships`; `insert` on `audit_log` and `events`; column-level `update` on `users` profile fields only. `anon` receives nothing. `service_role` keeps the standard full grant (API server-side only) minus `update/delete` on `audit_log`.
2. **`users.active_organization_id`** (new column) plus `app.set_active_organization(org)`, the only way it is written (D-023).
3. **Security-definer flows** (D-024): `app.seed_default_roles(org)` — the nine roles and the permission matrix, including `send_external` per D-022; `app.create_organization(...)`; `app.create_invitation(org, email, role_id, token_hash, ttl_hours)`; `app.revoke_invitation(id)`; `app.invitation_preview(token_hash)` (anon-callable; the token is the credential); `app.accept_invitation(token_hash)` (idempotent; expired/revoked refused; email must match); `app.update_membership(id, role_id, status)` (owner protected; self-removal refused). Each writes its audit row and `user.action` event on success. Denied attempts are audited by the API, because a row inserted inside a function that then raises is rolled back with it.

Errors are raised with a stable token as the message (`invitation_expired`, `permission_denied`, …) and an SQLSTATE the API maps to HTTP: `28000` → 401, `42501` → 403, `P0002` → 404, `23505` → 409, `22023` → 422.

`supabase/tests/0100_membership_flows.sql` covers create-organization validation, the role seed, the `send_external` matrix, invitation permission, email mismatch, double accept, expired and revoked.

## Seed fixture

`supabase/seed.sql` creates the two brokerages the RLS suite needs:

| | Brokerage A | Brokerage B |
|---|---|---|
| Name | Acme Insurance Brokers | Beta Risk Partners |
| Users | 1 admin, 1 account executive, 1 finance officer | same |
| Country / currency | KE / KES | KE / KES |
| Extra | one team, one pending invitation | one team, one revoked invitation |

No shared users between A and B, plus one deliberate third user who is a member of **both** — the case that breaks naive isolation code.

Fixture IDs are fixed (`10000000-…-00a` / `-00b` for the organizations, `a…`, `b…`, `c…` prefixes for users) so pgTAP tests can reference them. Seed users have an unrecoverable random password (D-008).

---

## Phase 2 preview — do not build yet

`clients`, `client_contacts`, `client_addresses`, `client_relationships`, `client_notes`, `client_preferences`, `client_assignments`, `insurers`, `insurer_contacts`, `insurer_products`, `policies`, `policy_documents`, `mailboxes`, `email_threads`, `emails`, `email_attachments`, `email_entity_links`.

Listed here so Claude Code knows the shape of what comes next, and knows it is out of scope now.
