-- 0084 — Work journey and work checklist, registered for Living surfaces (D-161).
--
-- Claims and policy changes get Living workspaces on the same contract as renewals. WorkJourney shows
-- any workflow's own steps as its run records them; WorkChecklist shows things each done or
-- outstanding with who holds them — claim documents, the insurer's decision on each endorsement item,
-- and the claim's offer, acceptance and payment as three separate facts. The older registry's
-- 'Checklist' (0031) is a different component and is left as it is.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('WorkJourney', 1, 'Work journey', 'Any workflow''s own steps in order, done, now, waiting or next, as its run records them.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"steps":{"maxItems":16,"type":"array","items":{"type":"object","properties":{"key":{"type":"string","maxLength":60},"label":{"type":"string","minLength":1,"maxLength":200},"state":{"type":"string","enum":["done","now","next","waiting","stopped","skipped"]}},"required":["key","label","state"],"additionalProperties":false}},"summary":{"type":"string","minLength":1,"maxLength":500}},"required":["steps","summary"],"additionalProperties":false}'::jsonb),
  ('WorkChecklist', 1, 'Work checklist', 'Things each done or outstanding, with who holds them: documents, decisions, separately recorded facts.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":40,"type":"array","items":{"type":"object","properties":{"key":{"type":"string","maxLength":80},"label":{"type":"string","minLength":1,"maxLength":200},"detail":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]},"state":{"type":"string","enum":["done","outstanding","rejected","pending"]},"party":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"since":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]}},"required":["key","label","detail","state","party","since"],"additionalProperties":false}},"note":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]}},"required":["items","note"],"additionalProperties":false}'::jsonb);
