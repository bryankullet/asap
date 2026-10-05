-- pgTAP: a fact is recorded as an event once (0066, D-140).
begin;
select plan(4);

select has_column('events', 'dedupe_key', 'events carry the fact they record');
insert into events (organization_id, event_type, entity_type, entity_id, dedupe_key)
values ('10000000-0000-4000-8000-00000000000a', 'cover.confirmed', 'placement', gen_random_uuid(), 'resp-1:basis-1');
select throws_like($$
  insert into events (organization_id, event_type, entity_type, entity_id, dedupe_key)
  values ('10000000-0000-4000-8000-00000000000a', 'cover.confirmed', 'placement', gen_random_uuid(), 'resp-1:basis-1')
$$, '%events_one_per_fact%', 'the same fact twice is refused');
select lives_ok($$
  insert into events (organization_id, event_type, entity_type, entity_id, dedupe_key)
  values ('10000000-0000-4000-8000-00000000000b', 'cover.confirmed', 'placement', gen_random_uuid(), 'resp-1:basis-1')
$$, 'another brokerage''s fact with the same key is its own');
select lives_ok($$
  insert into events (organization_id, event_type, entity_type, entity_id)
  values ('10000000-0000-4000-8000-00000000000a', 'cover.confirmed', 'placement', gen_random_uuid()),
         ('10000000-0000-4000-8000-00000000000a', 'cover.confirmed', 'placement', gen_random_uuid())
$$, 'events without a key may repeat, as before');

select * from finish();
rollback;
