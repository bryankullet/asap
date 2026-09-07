-- 0007 — teams
-- Teams do not grant permissions in Phase 1. They exist for assignment and workload views later.
create table teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  name             text not null,
  description      text,
  lead_user_id     uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint teams_organization_id_name_key unique (organization_id, name)
);

create table user_team_memberships (
  team_id     uuid not null references teams(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);
