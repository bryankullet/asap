-- 0089 — The renewal journey, version 2: stage nine, the continuing relationship (D-167).
--
-- After the renewed cover is verified and its period has begun (or the renewal work is done), the renewal
-- workspace shows the year ahead: the cover now in force, when its renewal opens under the brokerage's
-- renewal rule, and what carries forward. RenewalJourney gains the stage; version 1 stays registered so
-- anything stored at it still renders. living-registry.test.ts holds the latest version equal to its Zod
-- source and every earlier version still present.

insert into component_definitions
  (component_id, version, name, purpose, allowed_spaces, required_permissions,
   can_contain_action, requires_evidence, props_schema)
values
  ('RenewalJourney', 2, 'Renewal journey', 'Where the renewal stands, stage by stage through the continuing relationship, derived from the records.',
   array['living']::text[],
   array[]::text[],
   true, false,
   '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stages":{"maxItems":9,"type":"array","items":{"type":"object","properties":{"key":{"type":"string","enum":["attention","preparing","awaiting_terms","comparing","deciding","placing","issuing","verified","continuing","stopped"]},"label":{"type":"string","minLength":1,"maxLength":200},"state":{"type":"string","enum":["done","now","next"]}},"required":["key","label","state"],"additionalProperties":false}},"summary":{"type":"string","minLength":1,"maxLength":500}},"required":["stages","summary"],"additionalProperties":false}'::jsonb);
