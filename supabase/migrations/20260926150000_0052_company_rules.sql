-- 0052 — A brokerage's own rules, with where each came from and when it was last checked.
--
-- 4B-3 shipped a recommendation that picked the cheaper quote once the premiums were more than
-- 5% apart. That number came from nowhere: not the approved prototype, not the Intent & Skill
-- Map, not the Economic State Machine, not a brokerage. A universal percentage applied to every
-- Kenyan brokerage is exactly the hard-coded market value CLAUDE.md forbids, and it decided
-- something no constant is entitled to decide — which insurer a client should be advised to take.
--
-- So it becomes a rule a brokerage sets, or it does not exist. With no rule configured ASAP
-- states the facts — this one is cheaper by so much, that one states an excess the other does
-- not — and declines to name a recommended quote. Abstention is a state, not a blank (§36).
--
-- Every rule carries its source and the date somebody last checked it, because a rule whose
-- provenance nobody remembers is a number hidden one layer further down.

create table company_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Dotted and stable, e.g. `quote.recommendation`. The API validates the value per key.
  key             text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  value           jsonb not null,
  -- Where this came from: a circular, an Act, a partner's decision. Never blank.
  source          text not null check (length(btrim(source)) > 0),
  -- When a person last confirmed it still holds. A rate checked in 2019 is not a rate.
  verified_at     date not null,
  note            text,
  set_by          uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint company_rules_one_per_key unique (organization_id, key)
);
create index company_rules_organization_id_idx on company_rules (organization_id);
create index company_rules_set_by_idx on company_rules (set_by);

comment on table company_rules is
  'Per-brokerage rules and market values, each with its source and the date it was last checked.';

/* A rule that is changed is a decision, so the history is kept rather than overwritten. */
create table company_rule_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company_rule_id uuid references company_rules(id) on delete set null,
  key             text not null,
  value           jsonb not null,
  source          text not null,
  verified_at     date not null,
  note            text,
  set_by          uuid not null references users(id),
  recorded_at     timestamptz not null default now()
);
create index company_rule_versions_organization_id_idx on company_rule_versions (organization_id);
create index company_rule_versions_company_rule_id_idx on company_rule_versions (company_rule_id);
create index company_rule_versions_set_by_idx on company_rule_versions (set_by);

create or replace function app.keep_the_company_rule_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.company_rule_versions (
    organization_id, company_rule_id, key, value, source, verified_at, note, set_by)
  values (new.organization_id, new.id, new.key, new.value, new.source, new.verified_at,
          new.note, new.set_by);
  return null;
end $$;
revoke all on function app.keep_the_company_rule_version() from public;

create trigger company_rules_keep_the_version
  after insert or update on company_rules
  for each row execute function app.keep_the_company_rule_version();

alter table company_rules enable row level security;
alter table company_rule_versions enable row level security;

create policy tenant_select on company_rules for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on company_rules for insert to authenticated, asap_worker
  with check (app.can_access(organization_id) and set_by = (select auth.uid()));
create policy tenant_update on company_rules for update to authenticated, asap_worker
  using (app.can_access(organization_id)) with check (app.can_access(organization_id));

create policy tenant_select on company_rule_versions for select to authenticated, asap_worker
  using (app.can_access(organization_id));
create policy tenant_insert on company_rule_versions for insert to authenticated, asap_worker
  with check (app.can_access(organization_id));

grant select, insert, update on company_rules to authenticated, asap_worker;
grant select, insert on company_rule_versions to authenticated, asap_worker;
revoke delete on company_rules, company_rule_versions from asap_worker, authenticated;
revoke update on company_rule_versions from asap_worker, authenticated;
