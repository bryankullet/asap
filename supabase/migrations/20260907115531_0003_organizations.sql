-- 0003 — organizations
create table organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  legal_name         text,
  country            text not null,                      -- ISO 3166-1 alpha-2
  timezone           text not null default 'Africa/Nairobi',
  currency           text not null default 'KES',        -- ISO 4217
  settings           jsonb not null default '{}'::jsonb,
  subscription_plan  text not null default 'trial'
                     constraint organizations_subscription_plan_check
                     check (subscription_plan in ('trial','standard','professional','enterprise')),
  status             text not null default 'active'
                     constraint organizations_status_check
                     check (status in ('active','suspended','offboarding','closed')),
  created_by         uuid,                                -- users.id, set after first user exists
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index organizations_status_idx on organizations (status) where deleted_at is null;

comment on table organizations is 'One row per brokerage. Every tenant table references this.';
comment on column organizations.settings is
  'Brokerage-level configuration without its own column: default levy rates, working hours, approval thresholds. Anything queried or joined on gets promoted to a real column.';
