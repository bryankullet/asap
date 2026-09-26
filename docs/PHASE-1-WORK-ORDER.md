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

- [x] `docs/ui/screen-map-v3.md` — Screen Map v3, the override layer above the v1 catalogue. Landed 2026-09-08.
- [ ] The Intent & Skill Map as the UI Build Spec references it (163 skills). `docs/skill-map.md` holds the earlier extraction (~150 skills) plus the economic addendum; reconcile when the current version is attached.
- [x] `docs/ui-build-spec-v1.md` — added 7 September 2026, as delivered.
- [x] `docs/ui/screen-map-v1-catalogue.md` and `docs/ui/ASAP-Space-and-Screen-Map.pdf` — added as delivered; placement provisional until Screen Map v3 arrives.

## UI Build Spec v1 progress (docs/ui-build-spec-v1.md Part 12)

- [x] Phase 0 — `packages/schema` contracts and ported tests (branch `claude/ui-phase0`).
- [x] Phase 1 — shell, Work's four views, `/r/:recordId`, Activity chip, Ask that only searches; real reads through RLS over seeded `work_items` and `runs` (0022, D-039). Branch `claude/ui-phase1`.
- [x] Phase 2 — work item engine (0023, D-042, D-043), renewal end to end (Part 6.7), draft/send (Part 7), runs with SSE and the Activity chip (Part 8). Runs and draft tests un-skipped. Branch `claude/ui-phase2`.
- [ ] Phase 3 — money: X08, invoicing, receipts, N01, reconciliation with the comparison guard. Blocked on spec Part 13 items 1 and 2.
- [x] Phase 4 — client files K01–K02 (K03 parked), agreements G01–G02, the placement gate at X01 with the audited principal-officer override; `client_file_cleared` and `agreed_rate_exists` real (0026, D-048). Branch `claude/ui-phase4`.
- [x] Phase 5a — claims (Part 6.6, ten steps, three separate settlement facts) and endorsements (Part 6.3, per-item decisions, effective-dated policy versions, transfer needs the policyholder's own instruction) (0028, D-051). Branch `claude/ui-phase5a`.
- [ ] Phase 5b — TOR, certificates and stock (6.4, 6.5, T01–T02). **Build these directly as Spaces** (D-058): a new insurance capability is no longer built as a fixed page when the Space system can carry it.
- [x] **The Space foundation** (out of Part 12's numbering, because it is the substrate the rest sits on). D-058 reconciles the two phase plans and each one's authority; D-059 settles Part 13 item 6 — `UiIntent` is the result envelope, `component_definitions` is the registry. Migration 0031 adds the registry (nine components, RLS read-only, no write path); `apps/api/src/spaces/validate.ts` is the ten-rule plan validator; `GET /spaces/:recordId` composes a renewal from the shared recipes; `GET /attention` and `GET /work` take Today's ranking and Work's lists off the browser. The first Renewal Space renders behind `VITE_PUBLIC_RENEWAL_SPACE`, default off, with the existing record page as the rollback. Reported in `ASAP_SPACE_FOUNDATION_REPORT.md`.
- [ ] Part 13 item 6's second half — **which model powers Ask** — is still open, and no model is connected. Nothing generative ships until it is decided; plans are built by our own recipes until then.
- [x] **Audit log survives organization deletion; must land before production.** `audit_log.organization_id` is ON DELETE RESTRICT since 0030 (was CASCADE from 0009): a brokerage with audit rows cannot be deleted, and every brokerage has them from creation. Screen Map v1 C05: "never rewrite historical outcomes". pgTAP `0307` proves it (D-054). Found when a test duplicate was deleted by hand and its creation rows went with it.
- [ ] **Placement authority by sum insured and class — `authority_sufficient` becomes real; must land before production.** Screen Map v3 Part 9 lists "placement authority scaled by sum insured" among what is still not in the plan. Until it lands, the placement approve step carries `client_file_cleared` and `version_current` only (D-048), so any member who can approve at all can approve any sum insured.
- [ ] Not in Phase 1 by design: personal pins, realtime invalidation, `?panel=` panels (URL reserved), the mobile bottom bar is present but untested on device.

## 4A completion checklist — what is still owed

These are deferred, not passed. Nothing in 4A is complete until each is done or has been reported
as blocked with the reason.

| Check | State | Why |
|---|---|---|
| Onboarding visual capture at 1360×900 / 1440×900 / 390×844 | **PASSED** | 27 captures via `scripts/visual/capture-onboarding.mjs` against the parity harness. No empty screens, no horizontal overflow, no console errors. |
| Import and Document visual comparison at 1360×900 / 1440×900 / 390×844 | **BLOCKED** | Needs harness states for the ingestion Spaces; the onboarding capture shows the pattern to follow. |
| Communication and Gmail visual comparison (the eleven states) | **BLOCKED** | Same. A live Gmail screenshot is not possible here and must not be claimed. |
| `pnpm test:rls` (pgTAP) | **BLOCKED** | No local Postgres in the build container; `DATABASE_URL` is unset. Suites `0318`, `0319` and `0320` are written and committed, unrun. Run with `DATABASE_URL=postgres://… pnpm test:rls`. |
| Worker database suite (10 tests) | **BLOCKED** | `apps/workers/test/dispatcher.test.ts` (8) and `withOrganization.test.ts` (2) are gated on `WORKER_DATABASE_URL`. Nothing was deleted or disabled. Run with `WORKER_DATABASE_URL=postgres://asap_worker:…@localhost:54322/postgres pnpm --filter @asap/workers test`. |
| Migrations 0044, 0045 and 0046 applied to hosted Supabase | **NOT DONE, deliberately** | Additive and reviewed, but a hosted application needs its own production-safety review. |

Before 4A is called finished: run the captures through the authenticated harness, run the RLS and
pgTAP suites wherever a Postgres exists, and report anything still unavailable as blocked rather
than passed.


## Gmail: deferred to final deployment (decided 2026-09-25)

**Do not configure Google Cloud, do not add Google credentials to Render, and do not run a live
Gmail OAuth flow during feature work.** A real Gmail account is connected and tested only after the
complete product is built. A later session picking up this work order must not read "Gmail is not
configured" as a gap to close early — it is the intended state.

What stays true while it is deferred:

- The Gmail implementation built in 4A-3 (D-081) stays. It is not removed, weakened or replaced.
- Every surface shows Gmail honestly as **not configured** wherever credentials are absent, and
  never as a connection that worked.
- **Skip** keeps working throughout onboarding, and stays a recorded decision rather than navigation.
- The scripted Gmail tests stay green. They exercise the real code against a scripted provider and
  are the reason this can be deferred without the implementation rotting.

The sequence at final deployment, in this order:

1. Create and verify a manual `pg_dump` — this project is on the free plan and has **no backups**.
2. Apply the reviewed migrations 0044, 0045, 0046, 0047 in their exact repository order.
3. Merge and deploy the completed product.
4. Configure Google Cloud and Render (see the 4A-3 report for the exact redirect URI, scopes and
   variable names).
5. Connect a real Gmail account.
6. Test controlled sync, attachments, record linking, reconnect and disconnect.
7. Run the full lifecycle acceptance test.

Until step 4, migrations 0044–0047 stay unapplied on hosted Supabase.

## Increment 4B — the placement lifecycle

| Stage | State |
|---|---|
| 4B-1 Client Space | Tested |
| 4B-2 Opportunity and Quote Space | Tested — data foundation awaiting review |
| 4B-3 Quote Comparison Space | Accepted |
| 4B-3A Reproducibility, recommendation rules, extraction | Accepted |
| 4B-4 Placement and approval flow | Accepted as foundation |
| 4B-4A Ask actions, Work clarity, cover match, client acceptance | Tested — awaiting review |
| 4B-5 Policy issuance handoff | Not started |

Updated after every commit.

### Gaps named by 4B-3, and what 4B-3A did about them

**Quotation terms are not extracted from documents. — Closed in 4B-3A.** The extractor now reads
them, one row per occurrence, with the page and rectangle each was read from; a proposal becomes a
term only when a person accepts or corrects it. The two defects below were the reason the original
finding was recorded, and both are fixed. What follows is the original finding, kept because it is
the measurement the fix was built against.

**Original finding.** The extractor
(`apps/extractor/src/asap_extractor/extract.py`) knows eight labelled fields, all of them from a
policy schedule: policy number, insured name, insurer name, class of business, period start,
period end, sum insured, premium. It has no notion of an excess, a limit as a distinct term, an
exclusion, a condition, a subjectivity, or a validity date, and nothing joins an extracted field
to an `insurer_response`. Every term compared in 4B-3 is therefore one a person recorded.

Measured rather than assumed. Running the real extractor over a quotation-style PDF carrying an
own-damage excess, a theft excess, a third-party limit, an exclusion, a condition and a validity
sentence returned: `class_of_business`, `premium`, `sum_insured` and a confused `insured_name` —
**no term of any kind**. Two further defects surfaced in that run, both pre-existing and outside
4B-3's scope:

- `sum_insured` matches the label "limit" / "limit of liability", so a third-party limit on a
  quotation would be read as the sum insured;
- "Policyholders compensation fund" matches the `insured_name` label "policyholders", producing a
  spurious conflicting reading of the insured's name; and "Period from: … Period to: …" on one
  line puts both dates into `period_start`.

Closing this needed a quotation-shaped label set, terms returned as a list rather than one value
per key, and a route from a reviewed extraction to `quote_terms`. All three are now in place.

### What 4B-5 inherits from 4B-4 and 4B-4A

- **The handoff is Work, not a policy.** When cover is confirmed and the cover check finds no
  unaccepted material difference, the placement's lifecycle Work becomes *issue policy from
  confirmed cover* — once, keyed on the placement. `prepare_issuance` finds that same item. No
  `policies` row is written anywhere in 4B-4 or 4B-4A.
- **Readiness is a structured gate** (`readiness.state` + `reasons[]`): submitted, confirmed,
  confirmation evidence, effective date, a current cover check, no unaccepted material difference,
  a current instruction, not cancelled, permission. 4B-5 must re-evaluate it, never trust it.
- **The premium condition is recorded, not checked.** `readiness.deferredChecks` says so in words.
  Whether premium must be paid before issuance is a per-brokerage company rule that arrives with
  Money (4D, `money.check_payment_condition`). Nothing hard-codes it.
- **Closed in 4B-4A:** `placement.verify_cover_match` (field by field, stored with both input
  ids, stale when either moves) and the client's acceptance of changed terms (accept all creates a
  new instruction revision and basis version; reject and partial never change what was agreed).

### Scheduled gaps left open by 4B-4A

Opening a placement derives its state and brings its Work into line immediately, and every blocked
attempt creates or updates Work in the same request. What does **not** yet happen without a person
opening something:

- **Confirmation overdue has no timer.** Work shows "With Jubilee since 8 Sep — cover confirmation
  requested" from the moment of submission; nothing raises it after N days. `task_next_check` is
  carried through the engine function but nothing sets it yet.
- **Quote expiry after instruction** raises Work only when the placement is next opened or acted
  on (it becomes *review what changed in the quotation*). No sweep notices it in between.
- **`quote.track_validity` has no scheduled sweep** (unchanged from 4B-3A).
- **Prepared actions expire lazily.** A prepared action past its 24-hour window is refused and
  marked expired when someone tries to confirm it; nothing sweeps unconfirmed ones.

All four belong with the scheduled-jobs stage.

### Still unsupported after 4B-3A

- **No OCR.** An image-only quotation is reported as needing a person, in those words, on the
  review screen and through Ask. It is not read, and nothing claims it was.
- **Re-reading a document is not wired up.** The pipeline handles a re-read correctly and refuses
  to touch a proposal a person has decided, but no route or job triggers one; the review action
  says so rather than appearing to start something.
- **`quote.track_validity` has no scheduled sweep.** A comparison derives and shows valid,
  expiring soon, expired or not stated at the moment it is read, and an expired quote makes the
  comparison unpresentable immediately. Nothing runs on a timer to notice an expiry between
  readings; that belongs with the scheduled-jobs stage.
- **Ask prepares, it does not confirm.** The model can read a quotation's proposals and explain
  why no recommendation was made. For placements (4B-4A) it can now *prepare* the eight placement
  actions; each waits on the placement for a person to confirm, and runs through the same
  validated action the screen uses. Accepting, correcting or rejecting a reading is a person's
  action through the validated route.


## Test baseline (verified at 381e439, 2026-09-25)

Counted by running each package's own test command separately and reading the line it printed.
An earlier report stated 976, which was an arithmetic error on my part: the per-package figures it
listed sum to 989, not 976.

| Package | Passed | Skipped | File total |
|---|---|---|---|
| `@asap/api` | 447 | 0 | 447 |
| `@asap/web` | 410 | 0 | 410 |
| `@asap/schema` | 106 | 0 | 106 |
| `@asap/workers` | 23 | 10 | 33 |
| `@asap/db` | 3 | 0 | 3 |
| **Total** | **989** | **10** | **999** |

`@asap/ui` has no test task.

**The 10 are additional to the 23, not part of them.** `apps/workers/test/dispatcher.test.ts` (8)
and `withOrganization.test.ts` (2) are wrapped in `const describeDb = url ? describe : describe.skip`
and need a real Postgres. Without one the worker package reports `23 passed | 10 skipped (33)`;
with one it reports `33 passed (33)`. So the honest headline is:

- **without a database: 989 passing, 10 skipped, 999 declared**
- **with a disposable database: 999 passing, 0 skipped**

Both were observed at `381e439`. Nothing has been deleted, disabled, renamed out of discovery or
omitted: `git diff 234538f..HEAD -- apps/workers/` is empty, and the two `describe.skip` bindings
above are the only conditional skips in the repository.

To run the database-backed ten:

```
WORKER_DATABASE_URL=postgres://asap_worker:<password>@127.0.0.1:5433/<db> \
OWNER_DATABASE_URL=postgres://postgres@127.0.0.1:5433/<db> \
pnpm --filter @asap/workers test
```

Both variables are required — the dispatcher writes its fixtures on an owner connection, because
events are written by the API and the worker only ever reads that one exists.
