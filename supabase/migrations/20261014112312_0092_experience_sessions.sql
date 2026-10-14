-- 0092 — Experience sessions for the progressive interface (D-172).
--
-- One person's continuing working context around an intention, in one brokerage: what they asked,
-- how ASAP read it, which records it concerns (references only), the composition revision, and the
-- interface state worth keeping (drafts, selections, disclosures). Never a business value and never
-- an alternative record: every figure on screen is read from its own record at composition time.
-- Scoped to (brokerage, person) under RLS, like surface_preferences (0080) and space_pins (0078),
-- so a brokerage switch or a colleague never inherits it.

create table experience_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 200),
  kind            text not null check (kind in ('create_client', 'explore_policies', 'renew_policy', 'clarify', 'unsupported')),
  expression      text not null check (length(btrim(expression)) between 1 and 500),
  -- How ASAP read the intention and the parameters it resolved (record ids, a time window).
  intent          jsonb not null default '{}'::jsonb check (jsonb_typeof(intent) = 'object' and pg_column_size(intent) <= 16384),
  -- References to records, as {type, id, label}. Re-authorized on every composition.
  subjects        jsonb not null default '[]'::jsonb check (jsonb_typeof(subjects) = 'array' and pg_column_size(subjects) <= 16384),
  progress        text not null default 'started' check (progress in ('started', 'working', 'waiting_input', 'complete', 'blocked')),
  revision        integer not null default 1 check (revision >= 1),
  ui_state        jsonb not null default '{}'::jsonb check (jsonb_typeof(ui_state) = 'object' and pg_column_size(ui_state) <= 32768),
  ui_version      integer not null default 0 check (ui_version >= 0),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index experience_sessions_owner_idx on experience_sessions (organization_id, user_id, updated_at desc);
create index experience_sessions_user_id_idx on experience_sessions (user_id);
comment on table experience_sessions is 'One person''s continuing working context in one brokerage (D-172). Interface state and record references only.';

alter table experience_sessions enable row level security;
create policy tenant_select on experience_sessions for select to authenticated
  using (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_insert on experience_sessions for insert to authenticated
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));
create policy tenant_update on experience_sessions for update to authenticated
  using (app.can_access(organization_id) and user_id = (select auth.uid()))
  with check (app.can_access(organization_id) and user_id = (select auth.uid()));
-- No delete policy: an experience is archived, never removed by the application.
grant select, insert, update on experience_sessions to authenticated;
revoke all on experience_sessions from anon;
