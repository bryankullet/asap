-- 0086 — Focus, registered for Living surfaces (D-165).
--
-- Ask ASAP inside a workspace: a request becomes a typed focus (an intent, and a name from the record),
-- and the workspace recomposes — the answer, built from records, at the front, and the blocks it concerns
-- brought forward. FocusPanel is that answer. Read-only to the application; living-registry.test.ts holds
-- it equal to its Zod source.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('FocusPanel', 1, 'Focus', 'The answer to a request asked inside a workspace, from records, with the blocks it concerns brought forward.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"question":{"type":"string","minLength":1,"maxLength":500},"understood":{"type":"string","minLength":1,"maxLength":500},"items":{"maxItems":12,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"detail":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]},"tone":{"type":"string","enum":["green","gold","red","grey"]},"ref":{"anyOf":[{"type":"object","propertyNames":{"type":"string","maxLength":60},"additionalProperties":{"anyOf":[{"type":"string","maxLength":200},{"maxItems":10,"type":"array","items":{"type":"string","maxLength":200}}]}},{"type":"null"}]}},"required":["label","detail","tone","ref"],"additionalProperties":false}},"empty":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]},"emphasis":{"maxItems":6,"type":"array","items":{"type":"string","maxLength":80}},"source":{"type":"string","enum":["rules","model"]}},"required":["question","understood","items","empty","emphasis","source"],"additionalProperties":false}'::jsonb);
