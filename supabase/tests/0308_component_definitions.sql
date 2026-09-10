-- pgTAP: the component registry (0031, D-059).
--
-- The registry is platform configuration, not tenant data, so the isolation suite's
-- organization_id rules do not apply to it. What must hold instead: every signed-in user can read
-- it, anon evaluates nothing, and no application role can write a component. A component arrives
-- by migration, reviewed — never through the data API and never from a model.
begin;
select plan(11);

select has_table('public', 'component_definitions', 'component_definitions exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.component_definitions'::regclass),
  'row level security is enabled');

-- Read for signed-in users and the worker; nothing for anon (0021's rule, restated here).
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'component_definitions'),
  1,
  'exactly one policy');
select is(
  (select cmd from pg_policies
   where schemaname = 'public' and tablename = 'component_definitions'),
  'SELECT',
  'the only policy is FOR SELECT');
select ok(
  (select roles::text[] @> array['authenticated','asap_worker']
   from pg_policies where schemaname = 'public' and tablename = 'component_definitions'),
  'the policy applies to authenticated and asap_worker');
select ok(
  not (select roles::text[] @> array['anon']
       from pg_policies where schemaname = 'public' and tablename = 'component_definitions'),
  'the policy does not apply to anon');

-- No write path exists for any application role, policy or grant.
select ok(not has_table_privilege('authenticated', 'public.component_definitions', 'INSERT'),
  'authenticated cannot insert a component');
select ok(not has_table_privilege('authenticated', 'public.component_definitions', 'UPDATE'),
  'authenticated cannot update a component');
select ok(not has_table_privilege('authenticated', 'public.component_definitions', 'DELETE'),
  'authenticated cannot delete a component');
select ok(not has_table_privilege('anon', 'public.component_definitions', 'SELECT'),
  'anon cannot select from the registry at all');

-- Every seeded row is closed, so an extra property is a rejection rather than a pass.
select is_empty($$
  select component_id from component_definitions
  where props_schema->>'additionalProperties' is distinct from 'false'
$$, 'every seeded property schema is closed');

select * from finish();
rollback;
