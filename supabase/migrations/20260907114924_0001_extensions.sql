-- 0001 — Extensions
-- pgcrypto: gen_random_uuid. pg_trgm: fuzzy name matching (Phase 2). vector: pgvector (Phase 3).
-- Installed into the `extensions` schema, which Supabase places on the search path.
create schema if not exists extensions;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm"  with schema extensions;
create extension if not exists "vector"   with schema extensions;
