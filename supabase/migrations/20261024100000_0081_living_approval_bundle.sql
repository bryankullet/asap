-- 0081 — The approval bundle, registered for Living surfaces (D-157).
--
-- A Living surface may now carry governed commands (approve, return, record a submission, follow
-- up) executed by the endpoints that already own them. Approving requires seeing exactly what will
-- leave the brokerage, so the frozen payload is shown in full by this block. Platform configuration,
-- read-only to the application; apps/api/test/living-registry.test.ts holds it equal to the Zod source.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('ApprovalBundle', 1, 'Approval bundle', 'Exactly what will leave the brokerage, in full, with the governed approve and return commands.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":200},"why":{"type":"string","minLength":1,"maxLength":500},"items":{"minItems":1,"maxItems":10,"type":"array","items":{"type":"object","properties":{"heading":{"type":"string","minLength":1,"maxLength":200},"to":{"anyOf":[{"type":"string","maxLength":300},{"type":"null"}]},"subject":{"type":"string","maxLength":300},"body":{"type":"string","maxLength":20000}},"required":["heading","to","subject","body"],"additionalProperties":false}},"approverNote":{"anyOf":[{"type":"string","maxLength":300},{"type":"null"}]}},"required":["title","why","items","approverNote"],"additionalProperties":false}'::jsonb);
