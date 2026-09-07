-- 0008 — invitations
-- The raw token goes in the email link only. The table stores its hash, so a database leak
-- does not hand out memberships.
create table invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  email            text not null,
  role_id          uuid not null references roles(id) on delete restrict,
  token_hash       text not null unique,
  invited_by       uuid not null references users(id),
  status           text not null default 'pending'
                   constraint invitations_status_check
                   check (status in ('pending','accepted','revoked','expired')),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index invitations_organization_id_status_idx on invitations (organization_id, status);

-- One live invitation per email per organization.
create unique index invitations_one_pending_per_email_idx
  on invitations (organization_id, lower(email))
  where status = 'pending';
