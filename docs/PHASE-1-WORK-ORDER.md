# Phase 1 Work Order — Secure Brokerage Workspace

**Goal:** a monorepo where two brokerages can exist side by side, users can sign in and be assigned roles, every tenant table is isolated by Row Level Security, files are private, every change is audited, and events are emitted. No insurance features yet.

**Done means:** every acceptance criterion below passes in CI, on a fresh `supabase db reset`.

**Not in this phase:** clients, policies, documents, email, AI, Spaces, Jobs. Resist adding them.

---

## Work item 1 — Monorepo skeleton

**Build**
- pnpm workspace + Turborepo at the root.
- `apps/web` (Vite + React + TS + Tailwind + shadcn/ui), `apps/api` (Hono on Node), `apps/workers` (Node/TS), `apps/extractor` (Python, stub only — a health endpoint and a queue consumer that does nothing yet).
- `packages/schema` (Zod), `packages/db` (Drizzle), `packages/ui` (empty component library with a build).
- Root scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:rls`.
- Shared `tsconfig.base.json`, strict mode on.

**Acceptance**
- [x] `pnpm install && pnpm build` succeeds from a clean checkout.
- [x] `pnpm typecheck` passes with zero errors and no `any` in `packages/schema`.
- [x] `apps/web` imports a type from `packages/schema` and the build fails if that schema changes incompatibly.
- [x] `apps/api` starts and answers `GET /health` with `{ status: "ok", version, commit }`.

---

## Work item 2 — Environment separation

**Build**
- Three Supabase projects: `local` (CLI), `staging`, `production`. Local is the only one used for development.
- `.env.example` at the repo root listing every variable. Real values never committed.
- Config loader in `packages/schema` that parses `process.env` through a Zod schema and **throws at startup** if a required variable is missing. No `process.env.FOO ?? "default"` scattered through the code.
- `docs/SECRETS.md` recording where each secret lives and how to rotate it.

**Acceptance**
- [x] Starting `apps/api` with a missing required variable fails immediately with a message naming the variable.
- [x] No secret value appears anywhere in git history. `scripts/secret-scan.mjs` matches key shapes (`sk-…`, JWTs, private keys, real database passwords, `service_role` assigned a value) — the bare word `service_role` is allowed in docs that forbid the key (D-012).
- [x] `apps/web` bundle contains the anon key only. `apps/web/scripts/check-bundle.mjs` fails the build if a non-`VITE_PUBLIC_` variable name or value reaches the client bundle.

---

## Work item 3 — Database schema and migrations

**Build**
- Migrations for every table in `docs/PHASE-1-SCHEMA.md`, in the order given there.
- Drizzle schema in `packages/db` matching the SQL exactly, with generated types exported.
- `supabase/seed.sql` creating two brokerages, three users each, and role assignments.

**Acceptance**
- [x] `supabase db reset` applies all migrations and the seed with no errors. (Verified locally via `scripts/db-verify-local.sh` against Postgres 16 — D-013; hosted verification pending first deploy.)
- [x] Drizzle types and the SQL schema agree — `pnpm db:drift`; CI wiring is work item 9.
- [x] Every table carrying `organization_id` has `not null` and a foreign key to `organizations(id)`. (`packages/db/test/schema.test.ts`)
- [x] Migrations are append-only; `pnpm db:migrations:immutable` fails if a committed migration file is modified. CI wiring is work item 9.

---

## Work item 4 — Authentication and membership

**Build**
- Supabase Auth email + password, plus magic link. Email confirmation on.
- `users` profile row created by a trigger on `auth.users` insert.
- Create-brokerage flow (§7 Step 1): the first user creates the organization, enters country / currency / timezone, becomes the initial administrator, accepts terms. On creation the system inserts the organization, the nine default roles, the storage namespace and the audit configuration.
- Invite flow (§7 Step 2): administrator invites by email with a role, invitation expires, acceptance creates the membership.
- Nine role templates seeded per organization: brokerage administrator, account executive, placement officer, policy administrator, claims officer, renewals officer, finance officer, manager, read-only user.
- Permissions are verbs against object types: view, create, edit, approve, export, delete, send_external, ai_execute.

**Acceptance**
- [x] A new signup with no organization lands on "create or join a brokerage", not a broken dashboard. (`apps/web` RequireMembership → /onboarding)
- [x] An accepted invitation produces exactly one active membership. Accepting twice does not produce two. (pgTAP 0100, tests 14–16)
- [x] An expired or revoked invitation cannot be accepted. (pgTAP 0100, tests 17–18)
- [x] A user in two brokerages can switch between them, and the active organization is resolved server-side from the session, never from a request body or header supplied by the browser. (`users.active_organization_id` via `app.set_active_organization`; `apps/api/src/context.ts`; D-023)
- [x] Removing a membership immediately blocks that user's reads for that organization on the next request. (RLS via `app.current_user_orgs()` filters `status = 'active'`; the API drops the active organization when the membership is not active — `apps/api/test/app.test.ts`)

---

## Work item 5 — Row Level Security

This is the phase's centre of gravity. Everything else is scaffolding around it.

**Build**
- `app.current_user_orgs()` and `app.worker_org()` helper functions as specified in the schema document.
- RLS enabled and a policy written on every tenant table.
- `asap_worker` database role that does **not** bypass RLS, for worker connections. Workers do not use the `service_role` key for tenant reads.
- Worker helper `withOrganization(orgId, fn)` in `apps/workers` that sets `app.organization_id` inside a transaction and clears it after, so a job cannot leak context into the next one.

**Additional items from the hosted-project advisors (7 September 2026; each is its own migration + test, none done yet)**
- [x] 5a. `alter default privileges in schema public revoke all on tables from anon, authenticated;` and revoke REFERENCES, TRIGGER and TRUNCATE on every existing public table from both roles. Hosted Supabase grants these three by default even with "automatically expose new tables" off, and TRUNCATE is not stopped by RLS. pgTAP test: no public table grants any of the three to anon or authenticated.
- [x] 5b. `set search_path = ''` on `app.worker_org` and `app.can_access` (advisor: function_search_path_mutable).
- [x] 5c. Revoke execute on `public.rls_auto_enable` from anon and authenticated (Supabase's automatic-RLS function is SECURITY DEFINER and RPC-callable).
- [x] 5d. Scope `tenant_write` to insert, update, delete instead of `for all`, so `tenant_read` is the only permissive SELECT policy (advisor: multiple_permissive_policies on roles, organization_memberships, teams, invitations, events).
- [x] 5e. Wrap `auth.uid()` as `(select auth.uid())` in `user_self` and `user_update_self` (advisor: auth_rls_initplan).
- [x] 5g. Grant execute on `app.current_user_orgs()` to `anon`. Found during live verification: `anon` may call `app.can_access` (0002 grants it) but not `app.current_user_orgs()`, which `can_access` calls and which 0002 restricted to `authenticated` and `service_role`. Under the `anon` role any policy-protected query therefore fails with `42501 permission denied for function current_user_orgs` instead of returning zero rows. Denied either way, but the storage API and PostgREST return an error where they should return nothing. The function is SECURITY DEFINER and returns no rows when `auth.uid()` is null, so the grant is safe. pgTAP test: as `anon`, selecting from every tenant table and from `storage.objects` returns zero rows without error.
- [x] 5f. Index the ten unindexed foreign keys the advisor lists (audit_log.actor_user_id, events.actor_user_id, invitations.accepted_by / invited_by / role_id, organization_memberships.invited_by / role_id, role_permissions.permission_id, teams.lead_user_id, user_team_memberships.user_id). Leave the unused-index warnings until there is data.

**Acceptance — proven by pgTAP, not by API tests**
- [x] A user in Brokerage A selecting from every tenant table as Brokerage B's session returns zero rows. (`supabase/tests/0200_rls_isolation.sql`)
- [x] A user in Brokerage A cannot insert a row carrying Brokerage B's `organization_id`. (0200)
- [x] A user in Brokerage A cannot update a Brokerage B row's `organization_id` to their own. (0200: the row is invisible, so the update affects nothing; re-stamping an own row into B is refused by `with check`)
- [x] A worker connection with **no** `app.organization_id` set reads zero rows from every tenant table. (0200)
- [x] A worker with `app.organization_id` set to A reads A's rows and zero of B's. (0200)
- [x] The suite enumerates tables from `information_schema` and **fails if any table with an `organization_id` column has no RLS policy**. (0200 coverage guard; it also requires RLS on every public table, D-010)

---

## Work item 6 — Storage security

**Build**
- Private bucket `insurance-documents`. Path convention: `organization_id/entity_type/entity_id/document_id/filename`.
- Storage RLS policies keyed on the first path segment matching a membership.
- Signed-URL endpoint on the API that checks permission server-side before issuing a URL, with a short expiry.
- Upload endpoint that derives the path from the session's organization. The client never supplies the organization segment.

**Acceptance**
- [ ] A signed URL request for another brokerage's object returns 403 and writes an audit row.
- [ ] Direct anon-key access to a bucket object returns 403.
- [ ] A signed URL expires and stops working.
- [ ] An upload attempting a path outside the caller's organization is rejected.

---

## Work item 7 — Audit foundation

**Build**
- `audit_log` table per the schema document.
- A database trigger on audited tables writing `record.changed` with before/after payloads.
- An application-level `recordAudit()` used for anything a trigger cannot see: who acted, what, which brokerage, which record, previous state, new state, evidence, approval, automation run, result, timestamp.
- Redaction: document contents and credentials never enter the audit payload or ordinary logs.
- A read API for audit history, permission-filtered.

**Acceptance**
- [ ] Creating, updating and deleting an organization member each produce an audit row with correct before/after.
- [ ] Audit rows are insert-only. An update or delete against `audit_log` fails at the database level for every application role.
- [ ] Audit rows are tenant-isolated under the same RLS tests as work item 5.
- [ ] A seeded credential string does not appear anywhere in `audit_log` or the application logs.

---

## Work item 8 — Event bus

**Build**
- `events` table per the schema document.
- Emission: database triggers emit `record.changed` for audited tables; application code emits semantic events; Supabase Cron emits `schedule.fired`.
- A dispatcher worker that reads unprocessed events and fans out to registered consumers. Phase 1 ships one consumer: an audit echo, purely to prove the path.
- Per-consumer idempotency — a consumer records `processed_at` for its own handling, so a redelivered event does not double-act.
- Dead-letter handling: after N failed attempts, the event is parked and surfaced, not silently dropped.

**Acceptance**
- [ ] Updating an audited row emits exactly one `record.changed` event with a before/after payload.
- [ ] Delivering the same event twice results in one consumer effect, not two.
- [ ] A consumer that throws does not block other consumers or other events.
- [ ] Events are tenant-isolated under the work item 5 tests.
- [ ] A failing event lands in the dead-letter view after its retry budget.

---

## Work item 9 — CI

**Build**
- GitHub Actions: install, typecheck, lint, unit tests, spin up Supabase, apply migrations, run pgTAP, run the "no table without a policy" check, run the migration-immutability check, run the secret-scan.

**Acceptance**
- [ ] A pull request that adds a tenant table without an RLS policy fails CI.
- [ ] A pull request that edits an existing migration file fails CI.
- [ ] The whole pipeline runs in under ten minutes.

---

## Phase 1 exit review

Before Phase 2 starts, confirm:

- [ ] Two brokerages exist in a live staging environment with real user accounts.
- [ ] An attempt to cross the boundary — from the API, from a worker with no context, from storage, from a raw SQL session — fails in all four places.
- [ ] Every table created in this phase appears in `docs/PHASE-1-SCHEMA.md` with the columns actually shipped. If the code drifted from the document, update the document.
- [ ] `docs/DECISIONS.md` records every choice made where the architecture was silent.
- [x] **D-029 answered** — client-policy-year is a thin `policy_periods` table, designed in Phase 2 (approved 2026-09-05). Architecture v3.1 §3A.
- [ ] **Live verification outstanding** — `pnpm verify:live` has not run (D-031: the build container cannot reach the project). Until it runs from a machine with normal egress, the `on_auth_user_created` trigger and the storage policies are **not proven** on the hosted project, only on the local shim. Do not treat work items 4 and 6 as verified until this is ticked.
- [ ] **GitHub → Supabase deployment proven** — the integration has deployed at least one migration on a push to `main` (see D-032) before any future migration relies on it.
- [ ] **D-026 revisited** — denied-attempt audit gap: accept, or change the 0014 functions to return structured refusals so the audit row commits.

---

## Open questions to settle before starting

These need a human answer. Claude Code should ask rather than assume.

1. Supabase region — data residency matters if brokerage clients are Kenyan.
2. GitHub organization and repository name.
3. Staging domain and production domain.
4. Whether staging holds real brokerage data or synthetic only. This changes the secret-handling rules.
5. Password policy and whether 2FA is required for the brokerage administrator role at launch.

---

## Documentation still to land in `docs/` (not blocking)

- [ ] `docs/ui/screen-map-v3.md` — Screen Map v3, the screen inventory the UI Build Spec is written against. To be attached by the operator.
- [ ] The Intent & Skill Map as the UI Build Spec references it (163 skills). `docs/skill-map.md` holds the earlier extraction (~150 skills) plus the economic addendum; reconcile when the current version is attached.
- [x] `docs/ui-build-spec-v1.md` — added 7 September 2026, as delivered.
- [x] `docs/ui/screen-map-v1-catalogue.md` and `docs/ui/ASAP-Space-and-Screen-Map.pdf` — added as delivered; placement provisional until Screen Map v3 arrives.
