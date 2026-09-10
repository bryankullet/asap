-- 0031 — The component registry (D-059, Architecture §18, UI Build Spec Part 4)
--
-- `component_definitions` is the authoritative registry of the components a Space may render and
-- of their property schemas. D-059 settled build spec Part 13 item 6: `UiIntent` is the small
-- validated result envelope and references registered component ids; this table is the registry.
-- The renderer may render only what is here, and the API validates every plan against it before
-- anything reaches the browser.
--
-- Not tenant data. It is platform configuration, like `roles` and `permissions`: every brokerage
-- renders from the same registry, so there is no organization_id and no per-tenant row. RLS is
-- still enabled (D-010: every public table), with read for signed-in users and no write path at
-- all — a component arrives by migration, reviewed, never by an API call or a model.
--
-- Versioned, because a block stores the version it was rendered with: a Space rendered in 2026
-- must still render in 2028 (§18). Deprecating a component means migrating stored blocks, not
-- deleting the row.
--
-- Seeded with the nine components the first Renewal Space uses, and nothing else. props_schema is
-- the JSON Schema of the matching Zod shape in packages/schema/src/spaces/blocks.ts;
-- apps/api/test/component-registry.test.ts fails if the two drift apart.

create table component_definitions (
  component_id      text    not null,
  version           integer not null check (version >= 1),
  name              text    not null check (length(btrim(name)) > 0),
  purpose           text    not null check (length(btrim(purpose)) > 0),
  -- Which Space types may carry this block. A plan naming any other is rejected.
  allowed_spaces    text[]  not null check (cardinality(allowed_spaces) > 0),
  -- Permissions the caller must hold for the block to reach them. Empty means any member.
  -- Filtering happens server-side, before the plan is sent (§34): never render-then-hide.
  required_permissions text[] not null default '{}',
  -- May this block carry an action? A block that may not is rejected if a plan gives it one.
  can_contain_action boolean not null,
  -- Must a displayed fact cite a source? A block that must and does not is rejected.
  requires_evidence  boolean not null,
  props_schema      jsonb   not null,
  deprecated_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (component_id, version)
);

comment on table component_definitions is
  'The registry of renderable components and their property schemas (D-059). Read-only to the application; components arrive by migration.';

alter table component_definitions enable row level security;

-- Read for any signed-in user and for the worker role. No insert, update or delete policy exists,
-- so no role can write a component through the data API, whatever else it holds.
create policy component_definitions_read on component_definitions
  for select to authenticated, asap_worker using (true);

grant select on component_definitions to authenticated, asap_worker;
revoke insert, update, delete on component_definitions from authenticated, asap_worker;

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('ClientHeader', 1, 'Client header', 'The client the Space is about, with the human-work status on it.',
   array['renewal', 'claim', 'placement', 'servicing', 'policy']::text[],
   array[]::text[],
   false, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"clientName":{"type":"string","minLength":1,"maxLength":200},"clientKind":{"type":"string","enum":["individual","corporate"]},"taskStatus":{"type":"string","enum":["needs_you","with_party","in_progress","done"]},"taskParty":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"taskSince":{"type":["string","null"]},"fileStatus":{"anyOf":[{"type":"string","enum":["not_started","incomplete","in_review","cleared","refresh_due"]},{"type":"null"}]}},"required":["clientName","clientKind","taskStatus","taskParty","taskSince","fileStatus"],"additionalProperties":false}'::jsonb),
  ('RenewalReadiness', 1, 'Renewal next step', 'The focus block: the next decision in business words, why it is here, and one action.',
   array['renewal']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"eyebrow":{"type":"string","const":"Next step"},"headline":{"type":"string","minLength":1,"maxLength":500},"why":{"type":"string","minLength":1,"maxLength":500},"blockedBy":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]},"ready":{"maxItems":12,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}},"outstanding":{"maxItems":12,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}}},"required":["eyebrow","headline","why","blockedBy","ready","outstanding"],"additionalProperties":false}'::jsonb),
  ('PolicyCard', 1, 'Policy card', 'The period of cover the work is about, with its cover status on its own line.',
   array['renewal', 'placement', 'policy', 'servicing', 'claim']::text[],
   array[]::text[],
   false, true,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"classOfBusiness":{"type":"string","minLength":1,"maxLength":200},"insurerName":{"type":"string","minLength":1,"maxLength":200},"policyNumber":{"anyOf":[{"type":"string","maxLength":100},{"type":"null"}]},"periodStart":{"type":"string"},"periodEnd":{"type":"string"},"coverStatus":{"anyOf":[{"type":"string","enum":["draft","requested","submitted","confirmed","active","expired","cancelled"]},{"type":"null"}]}},"required":["classOfBusiness","insurerName","policyNumber","periodStart","periodEnd","coverStatus"],"additionalProperties":false}'::jsonb),
  ('InsurerResponseTracker', 1, 'Insurer response tracker', 'Which insurers have answered and which have not, each tappable to what is on file.',
   array['renewal', 'placement']::text[],
   array[]::text[],
   false, true,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"insurers":{"maxItems":10,"type":"array","items":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":200},"state":{"type":"string","enum":["on_file","not_on_file","declined"]},"reference":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]},"recordedAt":{"type":["string","null"]}},"required":["name","state","reference","recordedAt"],"additionalProperties":false}}},"required":["insurers"],"additionalProperties":false}'::jsonb),
  ('TermComparison', 1, 'Term comparison', 'Insurer terms side by side as named facts. Never scored, never ranked by ASAP.',
   array['renewal', 'placement']::text[],
   array[]::text[],
   false, true,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"rows":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"fact":{"type":"string","minLength":1,"maxLength":200},"values":{"maxItems":6,"type":"array","items":{"type":"object","properties":{"insurerName":{"type":"string","minLength":1,"maxLength":200},"value":{"type":"string","minLength":1,"maxLength":500}},"required":["insurerName","value"],"additionalProperties":false}}},"required":["fact","values"],"additionalProperties":false}},"note":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]}},"required":["rows","note"],"additionalProperties":false}'::jsonb),
  ('DraftEmail', 1, 'Prepared draft', 'A message prepared for a person to send. Copying is never sending.',
   array['renewal', 'claim', 'servicing', 'communication']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"to":{"type":"string","maxLength":200},"subject":{"type":"string","minLength":1,"maxLength":500},"body":{"type":"string","minLength":1,"maxLength":8000},"sentAt":{"type":["string","null"]},"sentEvidence":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]}},"required":["to","subject","body","sentAt","sentEvidence"],"additionalProperties":false}'::jsonb),
  ('SourceEvidence', 1, 'Source evidence', 'Evidence beside an important fact, tappable to the reference a person recorded.',
   array['renewal', 'claim', 'placement', 'servicing', 'policy', 'document', 'reconciliation']::text[],
   array[]::text[],
   false, true,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"reference":{"type":"string","minLength":1,"maxLength":500},"recordedBy":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"recordedAt":{"type":["string","null"]}},"required":["label","reference","recordedBy","recordedAt"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('ActivityFeed', 1, 'Activity', 'What ASAP did on this record and what a person recorded. Never the only place a decision lives.',
   array['renewal', 'claim', 'placement', 'servicing', 'policy', 'reconciliation']::text[],
   array[]::text[],
   false, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"runs":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":200},"status":{"type":"string","enum":["working","paused","finished","could_not_finish","stopped"]},"nextStep":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]},"startedAt":{"type":"string"},"endedAt":{"type":["string","null"]}},"required":["title","status","nextStep","startedAt","endedAt"],"additionalProperties":false}},"recorded":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"reference":{"type":"string","minLength":1,"maxLength":500},"recordedBy":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]}},"required":["label","reference","recordedBy"],"additionalProperties":false}}},"required":["runs","recorded"],"additionalProperties":false}'::jsonb),
  ('Checklist', 1, 'Every step', 'The steps as supporting context. Ticks are facts about steps, not a progress bar.',
   array['renewal', 'claim', 'placement', 'servicing']::text[],
   array[]::text[],
   false, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":30,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"state":{"type":"string","enum":["todo","now","blocked","done"]},"actor":{"type":"string","enum":["asap","you","insurer","client","bank","finance","regulator"]},"note":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]}},"required":["label","state","actor","note"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb);
