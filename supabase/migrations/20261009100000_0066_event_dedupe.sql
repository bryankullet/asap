-- 0066 — a fact is recorded as an event once (D-140).
--
-- Workflows now start and wake on semantic events (`quote.received`, `cover.confirmed`, …). A fact
-- that becomes true once must be one event, even when two requests record it at the same moment or
-- the sweep looks at an overdue check twice. The emitter names the fact (`dedupe_key`), and this
-- index refuses a second row for it. Events without a key are unchanged.
alter table events add column dedupe_key text check (dedupe_key is null or length(dedupe_key) between 1 and 300);
create unique index events_one_per_fact on events (organization_id, event_type, dedupe_key) where dedupe_key is not null;
comment on column events.dedupe_key is
  'Names the fact this event records, so it is recorded once (D-140): e.g. the insurer response id, or the work item and due date of an overdue check.';
