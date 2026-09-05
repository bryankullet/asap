-- 0004 — users
-- A profile table mirroring auth.users. Application code never reads auth.users directly.
-- Not tenant-scoped: a person can work at two brokerages. Tenancy lives in organization_memberships.
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
                constraint users_status_check check (status in ('active','disabled')),
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
