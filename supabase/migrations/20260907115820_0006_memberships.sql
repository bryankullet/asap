-- 0006 — organization_memberships
create table organization_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references users(id) on delete cascade,
  -- on delete restrict: deleting a role that people hold must fail loudly, not orphan a membership.
  role_id          uuid not null references roles(id) on delete restrict,
  status           text not null default 'active'
                   constraint organization_memberships_status_check
                   check (status in ('active','suspended','removed')),
  is_owner         boolean not null default false,
  invited_by       uuid references users(id),
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organization_memberships_organization_id_user_id_key unique (organization_id, user_id)
);

create index organization_memberships_user_id_idx
  on organization_memberships (user_id) where status = 'active';
create index organization_memberships_organization_id_idx
  on organization_memberships (organization_id) where status = 'active';

-- Exactly one owner per organization.
create unique index organization_memberships_one_owner_idx
  on organization_memberships (organization_id)
  where is_owner and status = 'active';
