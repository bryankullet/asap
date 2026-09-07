-- 0010 — events
-- A dispatch log with a retention policy, not the system of record. Business facts live in
-- business tables. Phase 1 event types: record.changed, schedule.fired, user.action.
create table events (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations(id) on delete cascade,
  event_type           text not null,
  entity_type          text,
  entity_id            uuid,
  actor                text not null default 'system'
                       constraint events_actor_check
                       check (actor in ('user','ai','automation','system')),
  actor_user_id        uuid references users(id),
  payload              jsonb not null default '{}'::jsonb,   -- before/after for changes
  occurred_at          timestamptz not null default now(),
  processed_at         timestamptz,
  processing_attempts  integer not null default 0,
  last_error           text
);

create index events_organization_id_occurred_at_idx
  on events (organization_id, occurred_at desc);
create index events_organization_id_event_type_occurred_at_idx
  on events (organization_id, event_type, occurred_at desc);
create index events_unprocessed_idx
  on events (occurred_at) where processed_at is null;
create index events_entity_type_entity_id_idx
  on events (entity_type, entity_id);

-- Per-consumer idempotency. One event, many consumers, each recording its own outcome.
create table event_deliveries (
  event_id      uuid not null references events(id) on delete cascade,
  consumer      text not null,
  processed_at  timestamptz not null default now(),
  result        text not null default 'success'
                constraint event_deliveries_result_check
                check (result in ('success','failure','skipped')),
  error         text,
  primary key (event_id, consumer)
);
