# RLS and database test conventions

pgTAP, run against a real database: `pnpm test:rls` (CI after `supabase db reset`; locally after `scripts/db-verify-local.sh`). Every file in this directory runs in its own transaction and rolls back.

## Rules

1. **Isolation is proven here, not in API tests.** A user in Brokerage A acting as Brokerage B's session returns zero rows from every tenant table; cannot insert a row carrying B's `organization_id`; cannot move a B row into A. A worker with no `app.organization_id` reads nothing; with A's context it reads A and none of B.
2. **Coverage guard.** Every table in `public` has RLS enabled and at least one policy. Every table carrying `organization_id` has a policy that references it. A new table without a policy fails the suite.
3. **Policies evaluate to false for anon, never throw.** Under the `anon` role a table anon may SELECT (today only `storage.objects`) returns zero rows without an error; a table anon may not SELECT is refused at the grant layer with `permission denied for table …`, which is the grant layer speaking, not a policy. A `permission denied for function …` or any other error under anon means a policy raised, and that is the defect. A policy that raises for anon is a defect even though the result is still denied: PostgREST and the storage API turn an error into a 4xx/5xx where an empty result is expected, and it leaks the existence of the function it could not call. Achieved by scoping policies `to authenticated, asap_worker` (0021) so anon evaluates nothing; enforced by `0202_anon_never_errors.sql`.
4. **No implicit API-role privileges.** anon and authenticated hold no privilege on a public table unless a migration granted it; REFERENCES, TRIGGER, TRUNCATE and MAINTAIN are never granted to either. The test creates a throwaway table so the rule covers tables created after 0015.
5. **One permissive SELECT policy per table.** Write policies are per command (insert / update / delete), never `for all`.
6. **Helper functions pin `search_path`.** Anything the policies call has `search_path` set explicitly.
7. **Fixtures.** Use the seed identities (`supabase/seed.sql`): Acme admin `a…0001`, Beta admin `b…0001`, the shared consultant `c…0001`, organizations `1…00a` / `1…00b`. Impersonate with `set role authenticated` plus `set_config('request.jwt.claims', …, true)`; always `reset role` before the next actor.
8. **Plans.** Files that loop over catalog-driven table lists use `no_plan()`; fixed-shape files declare `plan(n)`.
9. **Never rely on data outside the seed.** A test that needs rows creates them inside its own transaction.
