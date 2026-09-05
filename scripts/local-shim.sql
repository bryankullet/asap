-- Minimal stand-in for the Supabase-managed `auth` and `storage` schemas and roles, so the
-- migrations can be applied to a plain PostgreSQL server (scripts/db-verify-local.sh).
-- NOT a migration. Never applied to a Supabase project, where these objects already exist.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap;

-- auth -----------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  instance_id                 uuid,
  id                          uuid primary key,
  aud                         text,
  role                        text,
  email                       text,
  encrypted_password          text,
  email_confirmed_at          timestamptz,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  is_super_admin              boolean,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  confirmation_token          text,
  recovery_token              text,
  email_change                text,
  email_change_token_new      text,
  email_change_token_current  text,
  phone_change                text,
  phone_change_token          text,
  reauthentication_token      text,
  is_sso_user                 boolean default false,
  is_anonymous                boolean default false
);

create table if not exists auth.identities (
  id               uuid primary key,
  user_id          uuid references auth.users(id) on delete cascade,
  provider_id      text,
  provider         text,
  identity_data    jsonb,
  last_sign_in_at  timestamptz,
  created_at       timestamptz,
  updated_at       timestamptz,
  unique (provider_id, provider)
);

-- Supabase's auth.uid() reads the JWT claims from request.jwt.claims. Tests set it with
--   select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- storage --------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id          text primary key,
  name        text not null,
  owner       uuid,
  public      boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1 : array_length(parts, 1) - 1];
end $$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

-- Supabase grants the API roles access to public by default privileges. Mirror that.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
