-- Release rehearsal on supabase/postgres:17.6.1.166 (D-170): what Supabase's auth and storage
-- services create at runtime on a hosted project and the bare database image lacks. Nothing else
-- is stood in for: roles, grants, default privileges, auth.uid()/role(), extensions are the image's.
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists raw_user_meta_data jsonb;
alter table auth.users add column if not exists is_super_admin boolean;
alter table auth.users add column if not exists confirmation_token text;
alter table auth.users add column if not exists recovery_token text;
alter table auth.users add column if not exists email_change text;
alter table auth.users add column if not exists email_change_token_new text;
alter table auth.users add column if not exists email_change_token_current text;
alter table auth.users add column if not exists phone_change text;
alter table auth.users add column if not exists phone_change_token text;
alter table auth.users add column if not exists reauthentication_token text;
alter table auth.users add column if not exists is_sso_user boolean default false;
alter table auth.users add column if not exists is_anonymous boolean default false;
create table if not exists auth.identities (
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text, provider text,
  identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, unique (provider_id, provider));
create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[]; begin select string_to_array(name, '/') into parts; return parts[1 : array_length(parts, 1) - 1]; end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
-- The auth service's current helpers (hosted has these; the bare image ships the legacy ones that read
-- only request.jwt.claim.*, while PostgREST 12 sets request.jwt.claims).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;

-- Hosted project configuration that is not in any migration, read from the hosted catalogue
-- (read-only, 12 Oct 2026) so the rehearsal matches it rather than the image's defaults:
-- 1. Default privileges for objects `postgres` creates in public. The image grants EXECUTE on new
--    functions and all sequence rights to anon/authenticated; hosted grants functions to postgres
--    only and sequences to postgres (rwU) and service_role (rU). (Tables are handled by 0015.)
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke update on sequences from service_role;
-- 2. The dashboard's "enable automatic RLS" setting: rls_auto_enable() owned by postgres, fired by
--    the ensure_rls event trigger on CREATE TABLE in public. Migration 0017 revokes it from the API roles.
set role postgres;
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql security definer set search_path to 'pg_catalog' as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end $$;
drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable();
reset role;
-- 3. The test harness only: pgTAP in public, where the suite and the asap_worker role look for it.
create extension if not exists pgtap with schema public;
-- pgTAP's own views pick up the image's supabase_admin defaults; they are harness objects, not ASAP's.
revoke truncate, references, trigger, maintain on public.pg_all_foreign_keys, public.tap_funky from anon, authenticated;
