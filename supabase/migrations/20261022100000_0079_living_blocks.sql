-- 0079 — The Living Interface's blocks, registered (D-156).
--
-- A Living Surface is composed on the server from records the viewer may read, validated against
-- this registry and the matching Zod schemas in packages/schema/src/living.ts, filtered by
-- permission, and only then sent to the browser — the same contract the Space plan follows (D-059).
-- Platform configuration, not tenant data: no organization_id, read-only to the application, and
-- a component arrives only by migration. apps/api/test/component-registry.test.ts fails if a schema
-- here drifts from its Zod source.
--
-- `allowed_spaces` is 'living' for all of them: they compose Living Surfaces, not the older plans.
-- QuoteComparison and Timeline were named in the registry's vocabulary but never seeded; they are
-- seeded here at version 1 with the Living shapes.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('ContextHeader', 1, 'Context header', 'What the workspace is about: the record, its client, its status and who holds it.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"eyebrow":{"type":"string","minLength":1,"maxLength":200},"title":{"type":"string","minLength":1,"maxLength":200},"client":{"anyOf":[{"type":"object","properties":{"id":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"name":{"type":"string","minLength":1,"maxLength":200}},"required":["id","name"],"additionalProperties":false},{"type":"null"}]},"facts":{"maxItems":6,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"value":{"type":"string","minLength":1,"maxLength":500}},"required":["label","value"],"additionalProperties":false}},"status":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"tone":{"type":"string","enum":["green","gold","red","grey"]}},"required":["label","tone"],"additionalProperties":false},"owner":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]}},"required":["eyebrow","title","client","facts","status","owner"],"additionalProperties":false}'::jsonb),
  ('RenewalJourney', 1, 'Renewal journey', 'Where the renewal stands, stage by stage, derived from the records.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stages":{"maxItems":9,"type":"array","items":{"type":"object","properties":{"key":{"type":"string","enum":["attention","preparing","awaiting_terms","comparing","deciding","placing","issuing","verified","stopped"]},"label":{"type":"string","minLength":1,"maxLength":200},"state":{"type":"string","enum":["done","now","next"]}},"required":["key","label","state"],"additionalProperties":false}},"summary":{"type":"string","minLength":1,"maxLength":500}},"required":["stages","summary"],"additionalProperties":false}'::jsonb),
  ('ProgressOpportunity', 1, 'Progress opportunities', 'What could move the work forward now, why, who holds it and what blocks it.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":6,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":200},"title":{"type":"string","minLength":1,"maxLength":500},"why":{"type":"string","minLength":1,"maxLength":500},"responsible":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"deadline":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"actionableNow":{"type":"boolean"},"requiresApproval":{"type":"boolean"},"blockedBy":{"maxItems":6,"type":"array","items":{"type":"string","minLength":1,"maxLength":500}},"tone":{"type":"string","enum":["green","gold","red","grey"]}},"required":["id","title","why","responsible","deadline","actionableNow","requiresApproval","blockedBy","tone"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('ObligationTracker', 1, 'Obligations', 'Who holds the next step, since when, and by when.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":10,"type":"array","items":{"type":"object","properties":{"party":{"type":"string","minLength":1,"maxLength":200},"what":{"type":"string","minLength":1,"maxLength":500},"since":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"due":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"kind":{"type":"string","enum":["outside","brokerage","asap"]}},"required":["party","what","since","due","kind"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('ChangeComparison', 1, 'Change comparison', 'An earlier value beside a revised one, and what the revision affects.',
   array['living']::text[],
   array[]::text[],
   true, true,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":10,"type":"array","items":{"type":"object","properties":{"subject":{"type":"string","minLength":1,"maxLength":200},"field":{"type":"string","minLength":1,"maxLength":200},"earlier":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"revised":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"revision":{"type":"integer","minimum":1,"maximum":9007199254740991},"receivedAt":{"type":["string","null"]},"affects":{"maxItems":4,"type":"array","items":{"type":"string","minLength":1,"maxLength":500}}},"required":["subject","field","earlier","revised","revision","receivedAt","affects"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('ConsequencePanel', 1, 'Consequences', 'What a change or a gap means, marked confirmed, potential or unknown.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"certainty":{"type":"string","enum":["confirmed","potential","missing"]},"text":{"type":"string","minLength":1,"maxLength":500}},"required":["certainty","text"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('CoverageEffectiveState', 1, 'Cover state', 'The expiring period and the renewed cover exactly as the server''s cover reading states it.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"expiring":{"anyOf":[{"type":"object","properties":{"periodStart":{"type":"string","maxLength":40},"periodEnd":{"type":"string","maxLength":40},"insurerName":{"type":"string","minLength":1,"maxLength":200},"policyNumber":{"anyOf":[{"type":"string","maxLength":100},{"type":"null"}]}},"required":["periodStart","periodEnd","insurerName","policyNumber"],"additionalProperties":false},{"type":"null"}]},"renewed":{"anyOf":[{"type":"object","properties":{"state":{"anyOf":[{"type":"string","maxLength":60},{"type":"null"}]},"line":{"type":"string","minLength":1,"maxLength":500}},"required":["state","line"],"additionalProperties":false},{"type":"null"}]},"daysToExpiry":{"anyOf":[{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},{"type":"null"}]},"statement":{"type":"string","minLength":1,"maxLength":500}},"required":["expiring","renewed","daysToExpiry","statement"],"additionalProperties":false}'::jsonb),
  ('QuoteComparison', 1, 'Quote comparison', 'Insurer answers side by side as named facts, never ranked by ASAP.',
   array['living']::text[],
   array[]::text[],
   true, true,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"insurers":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":200},"stage":{"type":"string","minLength":1,"maxLength":200},"premium":{"anyOf":[{"type":"string","maxLength":80},{"type":"null"}]},"validUntil":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"revision":{"anyOf":[{"type":"integer","minimum":1,"maximum":9007199254740991},{"type":"null"}]},"terms":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"value":{"anyOf":[{"type":"string","maxLength":300},{"type":"null"}]},"unclear":{"type":"boolean"}},"required":["label","value","unclear"],"additionalProperties":false}},"declineReason":{"anyOf":[{"type":"string","maxLength":500},{"type":"null"}]}},"required":["name","stage","premium","validUntil","revision","terms","declineReason"],"additionalProperties":false}},"note":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]}},"required":["insurers","note"],"additionalProperties":false}'::jsonb),
  ('PlacementProgress', 1, 'Placement progress', 'Instruction, request, insurer confirmation and issuance, each from its record.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"insurerName":{"type":"string","minLength":1,"maxLength":200},"steps":{"maxItems":10,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"state":{"type":"string","enum":["done","now","next","blocked"]},"note":{"anyOf":[{"type":"string","maxLength":300},{"type":"null"}]}},"required":["label","state","note"],"additionalProperties":false}},"coverLine":{"type":"string","minLength":1,"maxLength":500},"blockers":{"maxItems":6,"type":"array","items":{"type":"string","minLength":1,"maxLength":500}}},"required":["insurerName","steps","coverLine","blockers"],"additionalProperties":false}'::jsonb),
  ('EvidenceInspector', 1, 'Evidence', 'The documents and references behind the facts on the surface, each openable.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"label":{"type":"string","minLength":1,"maxLength":200},"reference":{"type":"string","minLength":1,"maxLength":500},"documentId":{"anyOf":[{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},{"type":"null"}]},"recordedAt":{"type":["string","null"]}},"required":["label","reference","documentId","recordedAt"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('Timeline', 1, 'Recent changes', 'What changed recently on this work, in order, with who did it.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"events":{"maxItems":15,"type":"array","items":{"type":"object","properties":{"at":{"type":"string"},"text":{"type":"string","minLength":1,"maxLength":500},"actor":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]}},"required":["at","text","actor"],"additionalProperties":false}}},"required":["events"],"additionalProperties":false}'::jsonb);
