-- 0091 — Related work, version 2: a plain list for a client investigation (D-167).
--
-- A client investigation lists the client's open work without the "same client" or "may bear on this"
-- markers a workspace uses for work related to its own record. RelatedWork gains certainty "none"; version
-- 1 stays registered. living-registry.test.ts holds the latest version equal to its Zod source.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('RelatedWork', 2, 'Related work', 'Other open work on the same client or policy, and why it bears on this work.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":200},"kind":{"type":"string","minLength":1,"maxLength":200},"status":{"type":"string","minLength":1,"maxLength":500},"why":{"type":"string","minLength":1,"maxLength":500},"certainty":{"type":"string","enum":["potential","context","none"]},"ref":{"type":"object","propertyNames":{"type":"string","maxLength":60},"additionalProperties":{"anyOf":[{"type":"string","maxLength":200},{"maxItems":10,"type":"array","items":{"type":"string","maxLength":200}}]}}},"required":["title","kind","status","why","certainty","ref"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb);
