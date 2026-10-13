-- 0088 — Arrived email, handover, related work, what usually happens and what was decided last time, registered for Living surfaces (D-166).
--
-- Insurance-native intelligence in every workspace: email the inbound router filed and nobody has dealt
-- with, with ASAP's reading labelled as a reading and the governed step it proposes; responsibility moving
-- between colleagues (0087); other open work on the same client or policy and why it bears on this work;
-- and insurer response times measured from the brokerage's own records, as an estimate with its basis.
-- Read-only to the application; living-registry.test.ts holds each equal to its Zod source.
-- DecisionTrail carries the client's previous round for the same cover forward: answers, declines with
-- their reasons and the client's instruction, each with its evidence.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('ArrivedMail', 1, 'Arrived email', 'Email filed to this work and not yet dealt with, ASAP''s reading labelled as a reading, and the governed step it proposes.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"id":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"from":{"type":"string","minLength":1,"maxLength":200},"subject":{"type":"string","minLength":1,"maxLength":500},"at":{"type":"string","maxLength":40},"party":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"reading":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]},"proposal":{"anyOf":[{"type":"object","properties":{"summary":{"type":"string","minLength":1,"maxLength":500},"words":{"anyOf":[{"type":"string","minLength":1,"maxLength":500},{"type":"null"}]}},"required":["summary","words"],"additionalProperties":false},{"type":"null"}]},"proposed":{"type":"string","minLength":1,"maxLength":500}},"required":["id","from","subject","at","party","reading","proposal","proposed"],"additionalProperties":false}},"note":{"type":"string","minLength":1,"maxLength":500}},"required":["items","note"],"additionalProperties":false}'::jsonb),
  ('HandoverNote', 1, 'Handover', 'Responsibility moving between colleagues: what is done, open and to watch, and whether the receiver has it.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"from":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"to":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]},"at":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"done":{"anyOf":[{"type":"string","minLength":1,"maxLength":2000},{"type":"null"}]},"open":{"anyOf":[{"type":"string","minLength":1,"maxLength":2000},{"type":"null"}]},"watch":{"anyOf":[{"type":"string","minLength":1,"maxLength":2000},{"type":"null"}]},"acknowledgedAt":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"forViewer":{"type":"boolean"},"earlier":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["from","to","at","done","open","watch","acknowledgedAt","forViewer","earlier"],"additionalProperties":false}'::jsonb),
  ('RelatedWork', 1, 'Related work', 'Other open work on the same client or policy, and why it bears on this work.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":200},"kind":{"type":"string","minLength":1,"maxLength":200},"status":{"type":"string","minLength":1,"maxLength":500},"why":{"type":"string","minLength":1,"maxLength":500},"certainty":{"type":"string","enum":["potential","context"]},"ref":{"type":"object","propertyNames":{"type":"string","maxLength":60},"additionalProperties":{"anyOf":[{"type":"string","maxLength":200},{"maxItems":10,"type":"array","items":{"type":"string","maxLength":200}}]}}},"required":["title","kind","status","why","certainty","ref"],"additionalProperties":false}}},"required":["items"],"additionalProperties":false}'::jsonb),
  ('ResponsePatterns', 1, 'What usually happens', 'Response times measured from this brokerage''s own records, as an estimate with its basis and sample.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"party":{"type":"string","minLength":1,"maxLength":200},"measure":{"type":"string","minLength":1,"maxLength":500},"sample":{"type":"integer","minimum":0,"maximum":9007199254740991},"enough":{"type":"boolean"}},"required":["party","measure","sample","enough"],"additionalProperties":false}},"basis":{"type":"string","minLength":1,"maxLength":500}},"required":["items","basis"],"additionalProperties":false}'::jsonb),
  ('DecisionTrail', 1, 'Decided last time', 'What was decided in the client''s last round for the same cover, each decision with its evidence.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"round":{"type":"string","minLength":1,"maxLength":500},"items":{"maxItems":10,"type":"array","items":{"type":"object","properties":{"at":{"anyOf":[{"type":"string","maxLength":40},{"type":"null"}]},"text":{"type":"string","minLength":1,"maxLength":500},"by":{"anyOf":[{"type":"string","maxLength":200},{"type":"null"}]},"tone":{"type":"string","enum":["green","gold","red","grey"]},"ref":{"anyOf":[{"type":"object","propertyNames":{"type":"string","maxLength":60},"additionalProperties":{"anyOf":[{"type":"string","maxLength":200},{"maxItems":10,"type":"array","items":{"type":"string","maxLength":200}}]}},{"type":"null"}]}},"required":["at","text","by","tone","ref"],"additionalProperties":false}},"note":{"type":"string","minLength":1,"maxLength":500}},"required":["round","items","note"],"additionalProperties":false}'::jsonb);
