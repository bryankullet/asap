# Decisions

Choices made where the architecture was silent, or where the work order asked for a human answer. One entry per decision, with a one-line reason. Append; do not rewrite history — supersede with a new entry.

Format: `D-nnn · date · title` → decision → reason → revisit trigger.

---

## D-001 · 2026-09-05 · Supabase region: ap-south-1 (Mumbai)

**Decision.** Staging and production Supabase projects are created in `ap-south-1`.

**Reason.** Cape Town is not offered for new Supabase projects. Mumbai is the lowest-latency option from Nairobi.

**Revisit.** This is a data-residency decision. Revisit if a brokerage raises residency as a requirement, or if an African region becomes available. Migration path: Supabase project transfer plus storage bucket copy; plan a maintenance window.

## D-002 · 2026-09-05 · Domains are placeholders

**Decision.** `asap.local` for local, `staging.asap.example` and `app.asap.example` as placeholders. Every place a real domain must go is marked `REAL-DOMAIN` in `.env.example` and findable with `grep -rn REAL-DOMAIN .`

**Reason.** Domains are not decided. Placeholders in the `.example` TLD cannot resolve, so a forgotten placeholder fails visibly rather than pointing somewhere real.

**Revisit.** When domains are bought. Also update `supabase/config.toml` `site_url` and `additional_redirect_urls` for staging and production, and the OAuth redirect URIs registered with Google and Microsoft (Phase 2).

## D-003 · 2026-09-05 · Staging holds synthetic data only

**Decision.** No real brokerage data ever touches staging. `supabase/seed.sql` is the only data staging receives.

**Reason.** Keeps staging under the developer-readable secret rules in `docs/SECRETS.md` instead of production rules, and removes staging as an exfiltration target.

**Enforcement.** Staging is reset from migrations plus seed only. No import screens (Phase 2) may be pointed at staging with real files. Any exception is a decision to be recorded here first.

## D-004 · 2026-09-05 · GitHub repository: bryankullet/asap

**Decision.** Single monorepo at `bryankullet/asap`. Default branch `main`.

## D-005 · 2026-09-05 · Password policy: minimum 12 characters; 2FA not yet required

**Decision.** `minimum_password_length = 12` in `supabase/config.toml` (mirrored by `PASSWORD_MIN_LENGTH` in the server env schema, which refuses a value below 12). No character-class requirements. Magic link remains available. TOTP MFA enrolment is enabled but not enforced for any role at launch.

**Reason.** Length is the requirement that measurably resists guessing; composition rules mostly produce predictable substitutions. Enforcing 2FA for `brokerage_admin` is deferred until the invite flow (work item 4) exists to onboard admins through it.

**Revisit.** Before the Phase 1 exit review: decide whether `brokerage_admin` must enrol TOTP. Supabase supports enforcing MFA via an RLS check on `auth.jwt()->>'aal'`.

## D-006 · 2026-09-05 · Worker role created NOLOGIN; password set per environment by script

**Decision.** Migration 0013 creates `asap_worker` with `nologin` and no password, idempotently. Each environment then runs `pnpm db:worker-password`, which executes `alter role asap_worker with login password ...` reading `WORKER_DB_PASSWORD` from the environment.

**Reason.** The schema document used a psql variable (`:'worker_password'`), which the Supabase CLI does not substitute. Putting a password literal in a migration would commit a secret. Roles are cluster-wide and survive `supabase db reset`, so `create role` must also be guarded to be re-runnable.

**Consequence.** Rotation is the same script with a new value, then a redeploy of `WORKER_DATABASE_URL`. Drain workers first (see `docs/SECRETS.md`).

## D-007 · 2026-09-05 · Sentry and Postmark required only when APP_ENV is staging or production

**Decision.** `SENTRY_DSN`, `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` are optional under `APP_ENV=local` and required otherwise, enforced in the Zod schema.

**Reason.** The work order lists both as Phase 1 requirements, and `.env.example` warns that requiring unused values teaches people to paste dummies. Requiring them exactly where they are used satisfies both.

## D-008 · 2026-09-05 · Seed users get an unrecoverable random password

**Decision.** `supabase/seed.sql` creates the seven fixture users with a random bcrypt password nobody knows. Local developers sign in by magic link (Inbucket) or run `scripts/seed-set-passwords.sh`, which refuses to run unless `APP_ENV=local`.

**Reason.** The seed also runs on staging (D-003). A known password in git would be a real credential to a real environment.

## D-009 · 2026-09-05 · Permission catalogue in migration 0005; role → permission matrix in the seed, provisional

**Decision.** The 144 `permissions` rows (18 object types × 8 verbs) are inserted by migration 0005, because production needs them and seeds do not run there. The nine roles per organization and their permission grants are created by `seed.sql` for the fixture, and will be created by the create-brokerage flow (work item 4) for real organizations. The matrix in the seed is **provisional**: admin gets everything, manager everything but delete, read-only gets view, operational roles get view plus create/edit/ai_execute on business objects, finance additionally approve/export on money objects. Nobody but admin and manager gets `send_external`.

**Reason.** A per-role permission matrix is a business decision about how a brokerage works. Encoding a guess in a migration would make it hard to change; the seed is easy to change and only feeds test data.

**Revisit.** Work item 4 needs the real default matrix. Ask the brokerage which roles may send externally before that ships. Move the matrix to a single source (a SQL function or a TypeScript constant) at that point, so the seed and the create-brokerage flow cannot drift.

## D-010 · 2026-09-05 · RLS on every public table, including those without organization_id

**Decision.** `role_permissions` and `user_team_memberships` have no `organization_id` column; they are protected through their parent (`roles`, `teams`). Migration 0011 enables RLS on them and on `permissions`. The drift check fails if any public table has RLS disabled.

**Reason.** The schema document's RLS list omitted `role_permissions`. Supabase exposes the whole `public` schema over PostgREST, so any table without RLS is readable with the anon key.

**Consequence.** The `rls_coverage` pgTAP test (work item 5) should check every public table, not only those carrying `organization_id`.

## D-011 · 2026-09-05 · Workers may read users of the organization they are working for

**Decision.** The `user_self` policy on `users` gains a third clause: rows for members of `app.worker_org()`.

**Reason.** Without it a worker could never resolve an actor's name for a notification or an audit row. It is scoped by the same context as every other tenant table.

## D-012 · 2026-09-05 · Secret scan matches credential shapes, not credential names

**Decision.** `scripts/secret-scan.mjs` fails on values shaped like keys, JWTs, private keys and database URLs with real passwords. It does not fail on the word `service_role` in documentation; it does fail on `service_role` assigned an `eyJ…` value.

**Reason.** The work order's literal grep for `service_role` would flag `docs/SECRETS.md`, `docs/PHASE-1-SCHEMA.md` and `CLAUDE.md`, all of which must be able to name the key in order to forbid it.

**Revisit.** Work item 9 may add gitleaks alongside; this script stays as the fast local check.

## D-013 · 2026-09-05 · Database verification without Docker

**Decision.** `scripts/db-verify-local.sh` applies migrations and seed to a plain PostgreSQL 16 using `scripts/local-shim.sql`, a minimal stand-in for the Supabase `auth` and `storage` schemas. `supabase db reset` remains the canonical path in CI and on any machine with Docker.

**Reason.** The development container used for Phase 1 has no Docker. Verifying the SQL against a real server is far better than not verifying it.

**Limits.** The shim is not Supabase: it does not run GoTrue, so auth behaviour (confirmation, magic links, password rules) is only checked in CI and locally under the Supabase CLI.

## D-014 · 2026-09-05 · CI checks ship as scripts; the workflow is work item 9

**Decision.** Drift check, migration-immutability check, secret scan, bundle check and the pgTAP runner exist as root scripts now. `.github/workflows` arrives with work item 9.

## D-015 · 2026-09-05 · Migration 0002 defers SQL function body validation

**Decision.** `set check_function_bodies = off;` at the top of migration 0002.

**Reason.** `app.current_user_orgs()` and `app.has_permission()` are `language sql` and reference tables created in 0005 and 0006. PostgreSQL validates SQL function bodies at creation, so the schema document's migration order cannot apply otherwise. Bodies are exercised on every reset by the seed and by the RLS suite.

## D-016 · 2026-09-05 · Server and worker env schemas live behind subpath exports

**Decision.** `@asap/schema` root exports only the browser-safe public env schema and contracts. `loadServerEnv` is at `@asap/schema/env/server`, `loadWorkerEnv` at `@asap/schema/env/worker`.

**Reason.** The first web build bundled every server variable *name* through the root export, and `scripts/check-bundle.mjs` correctly failed it. Names are not secrets, but a bundle that carries the server schema is one refactor away from carrying a value.

## D-017 · 2026-09-05 · Toolchain pins

**Decision.** TypeScript `~5.9` (not 7.x, the new native compiler), Zod 4, Tailwind 4 with the Vite plugin, Vite 8, Vitest 5, React 19, Hono 4, Drizzle 0.45, pnpm 10, Node 22.

**Reason.** TypeScript 7 changes tooling assumptions (`tsc` binary, some flags) that ESLint and Vite plugins have not all caught up with. Everything else is current stable.

## D-018 · 2026-09-05 · Web bundle check is a build step, not a lint step

**Decision.** `apps/web` `build` runs `tsc`, `vite build`, then `scripts/check-bundle.mjs`. A failing check fails the build.

**Reason.** The rule is about the artefact, so it is tested on the artefact.

## D-019 · 2026-09-05 · One hosted Supabase project for now, treated as disposable

**Decision.** A single hosted project ("Asap", `ap-south-1`) serves as the shared non-production environment. It is reset freely and never holds real brokerage data (D-003). Production gets its own project, created fresh, when needed. The production slots in `.env.example` stay empty until then.

**Reason.** One project is enough while the schema is moving daily. Creating production late means it is born from a migration history that has already been exercised end to end.

## D-020 · 2026-09-05 · "Automatically expose new tables" is OFF on the hosted project

**Decision.** Recorded as set at project creation. Consequence: new tables in `public` receive no Data API grants for `anon`, `authenticated` or `service_role`. Every table the user path needs is granted explicitly in a migration (first: 0014). `anon` gets nothing on tenant tables. `supabase/config.toml` sets `auto_expose_new_tables = false` so local matches hosted. Supabase makes this the default for all projects from 30 October 2026.

**Reason.** An allowlist. A tenant table nobody thought to grant is unreachable rather than readable with the anon key. It also makes the earlier "RLS on every table" rule (D-010) a second line of defence instead of the only one.

**Consequence.** A new table needs three things in its migration: `grant`, `enable row level security`, policies. The drift check's RLS assertion covers the second; a grants assertion belongs in the work item 5 suite.

## D-021 · 2026-09-05 · "Enable automatic RLS" is ON on the hosted project — no conflict with 0011

**Decision.** Recorded as set at project creation. Left on. Migration 0011 keeps its explicit `enable row level security` statements.

**Reason.** The setting installs a DDL event trigger that runs `alter table … enable row level security` on every new `public` table at `ddl_command_end`. `alter table … enable row level security` on a table that already has it is a no-op, so 0011's explicit statements neither fail nor change anything. Tables therefore carry RLS from the moment 0003–0010 create them (deny-all until 0011 adds policies), which is strictly safer. The local CLI has no such trigger, so the explicit statements are what keep local and hosted identical, and the drift check asserts RLS on every table in both.

**Watch-out.** Some implementations of this trigger also apply `force row level security`. That would bind the table owner (`postgres`) to RLS too, and our `security definer` helpers (`app.current_user_orgs`, the 0014 flows) run as that owner. It is harmless only if `postgres` holds `bypassrls`, which it does on hosted Supabase. The live verification script checks both facts (`pg_event_trigger`, `pg_roles.rolbypassrls`, `pg_class.relforcerowsecurity`) so this is confirmed rather than assumed.

## D-022 · 2026-09-05 · send_external matrix

**Decision.** `send_external` is granted to `brokerage_admin`, `manager`, `account_executive`, `placement_officer`, `renewals_officer`, `claims_officer` and `finance_officer`. Not to `policy_administrator` or `read_only`.

**Reason.** `policy_administrator` does internal record-keeping after the insurer issues; they do not negotiate. `finance_officer` needs it for debtor follow-up and statements. This permission means "this role talks to clients or insurers at all". The approval engine (work item 6) decides what actually goes out unsupervised.

**Where it lives.** `app.seed_default_roles(org)` in migration 0014 — the single source for the nine roles and their permissions, used by both `app.create_organization` and `seed.sql`. Supersedes the provisional seed-only matrix in D-009.

## D-023 · 2026-09-05 · Active organization is a server-side column, switched only through a verified function

**Decision.** `users.active_organization_id` (0014) is what the API resolves as the active brokerage on every request. The browser cannot write the column — `authenticated` holds column-level `update` on profile fields only — and switches through `app.set_active_organization(org)`, which refuses any organization the caller is not an active member of. The API additionally re-checks membership status on every request, so a removed membership blocks reads immediately (work item 4 acceptance).

**Reason.** §45: the frontend never supplies an organization ID, role or permission. A switch request names an organization, but it is a request to change server state, validated server-side; the value every subsequent request uses comes from the database.

**Alternative rejected.** Stamping the organization into the JWT via a custom access token hook. Faster per request, but a removed member keeps access until the token expires.

## D-024 · 2026-09-05 · Membership flows are security-definer functions, not API-side writes

**Decision.** Creating a brokerage, inviting, revoking, accepting and changing a membership are `app.*` functions (0014) called through `supabase.rpc()` under the user's session. Each checks the caller's permission, writes its own audit row (including `result = 'denied'`), and emits a `user.action` event.

**Reason.** Atomicity and one place to audit. A membership plus its audit row plus its event either all exist or none do; and a denied attempt is recorded even when the caller could not have written the audit row directly. Tokens never enter the database: the API generates the invitation token and passes only its SHA-256 hash.

## D-025 · 2026-09-05 · Postgres 17 for the local stack

**Decision.** `supabase/config.toml` `[db] major_version = 17`, matching the hosted project.

**Reason.** Local and hosted must run the same major version, or `db reset` proves nothing about production behaviour.

## D-026 · 2026-09-05 · Known limitation: denied attempts are audited by the API, not inside the database function

**Decision.** The 0014 security-definer functions raise on a permission failure. A row inserted into `audit_log` inside the same function is rolled back with the exception, so it cannot persist. Denied attempts are therefore written by the API (`recordAudit`, `result = 'denied'`) after the failed call.

**Limitation.** If the API crashes between the failed database call and the audit write, the denial goes unlogged. The work order says failed access attempts are exactly what the audit trail is for, so this is a gap, accepted for now because the window is a few milliseconds inside one request and every denial still surfaces as a 403 in the structured request log.

**Revisit at the Phase 1 exit review.** Options: (a) the function records the denial in a subtransaction-safe way by returning a structured refusal instead of raising, so the audit insert commits and the API maps the refusal to 403; (b) a `pg_background`/queue-based audit sink; (c) accept the gap and document it in `docs/SECRETS.md` incident guidance. Option (a) is the likely answer and changes the function contract, so it is a deliberate migration, not a patch.

## D-027 · 2026-09-05 · Kenyan legal and market values are per-organization configuration with a source, never constants

**Decision.** The 30-day commission payment deadline, the 14-day policy-document rule, the 5% withholding tax, commission caps by class, the 90-day claims reference and licensing amounts live in `company_rules` (Phase 2) with `rule_class = 'regulatory'`, `value`, `source`, `effective_from`, `verified_at`. ASAP ships the report's sourced values as unverified proposals shown during onboarding. No code, SQL, detector or fixture may embed the number.

**Reason.** Laws change, and the Economic State Machine report says to confirm each value before commercial use. A number in code is a number nobody re-checks.

**Consequence.** Every clock and calculation that depends on such a value renders "unconfirmed" until the brokerage verifies it. Evaluation fixtures must pass under different configured values (`docs/evaluation/SCENARIOS.md`).

## D-028 · 2026-09-05 · The eight economic states and the S/M codes are internal and never appear in the UI

**Decision.** The report's eight irreducible states, the S0–S13 operational states and the M0–M8 money states are a management summary and a reasoning model. They are not stored as a column or enum, and they never appear in UI copy, tooltips, alt text or broker-visible debug output. Spaces use plain brokerage language from a per-recipe phrasebook ("Cover cannot safely start yet. Premium receipt has not been matched to this policy.").

**Reason.** The product principle: the employee should not have to understand an economic state machine. The economic position is a vector computed from facts (Architecture §3A); a single stored state would be both wrong and tempting to edit.

**Enforcement.** A UI-plan validator rule (Phase 4) rejects any narration or prop containing the code patterns; the phrasebook is the only source of dimension copy.

## D-029 · 2026-09-05 · Client-policy-year representation — option B, `policy_periods`

**Status.** **Approved by the operator, 5 September 2026.** Reasoning accepted: commission, claims and renewal need a per-year anchor, and retrofitting foreign keys across every business table later is the migration most worth avoiding. Designed in Phase 2 with `policies`, not now.

**Recommendation.** Option B: a thin first-class `policy_periods` table — one row per client-policy-year (`policy_id`, `sequence`, `inception_at`, `expiry_at`, `predecessor_period_id`, `origin`, factual `outcome`, `deleted_at`). Commission, claims, endorsements, documents, premium items and renewal cycles reference the period. The economic position is projected over it, never stored on it.

**Why not A (policies + dates).** A renewal either creates a new policy row, losing the continuing client-policy identity that loss ratio and retention need, or extends the same row, losing the period as the anchor commission, claims and documents attach to. Date-range joins break on backdated endorsements, mid-term TOR, short-period covers and split instalments.

**Why not C (a view).** Every downstream table would still need to know which period a claim or commission belongs to; a view would reconstruct at read time a fact that should be recorded at write time.

**Cost.** One thin table and one foreign key on each Phase 2+ business table that would otherwise reference `policies`. Retrofitting later is a data migration across every business table, which is why the answer is needed now. Full reasoning: `docs/research/ESM-INTEGRATION-AUDIT.md` §G.

## D-030 · 2026-09-05 · Architecture becomes v3.1; filename carries the version

**Decision.** `docs/ASAP-Architecture-v3.0.md` is renamed `docs/ASAP-Architecture-v3.1.md` with the economic operating model integrated (§0, §3A, §3B, §8A, §8B, §22, §23, §24A, §25–§28, §32, §39, §43). All repository references are updated. There is no v3.0 file in the tree; git history holds it.

**Reason.** The repo convention already puts the version in the filename, and CLAUDE.md names the file as the controlling reference. Two files would both look authoritative. One renamed file with a "Changes from 3.0" section is the cleanest single truth.

## D-031 · 2026-09-05 · The build container cannot reach the hosted Supabase project

**Finding.** From the Claude Code container, HTTPS to `abdkpcppmlqnwvxloqsb.supabase.co` is refused by the egress proxy with 403 (policy denial, the same as `supabase.com`), and TCP to `aws-0-ap-south-1.pooler.supabase.com` on 5432 and 6543 times out (no raw outbound TCP). DNS resolves correctly. This is a **network restriction of the environment**, not a wrong connection string. `pnpm verify:live` therefore has not run; it runs from any machine or CI runner with normal egress.

**Note on the connection string.** The supplied `DATABASE_URL` carries an unencoded `@` inside the password. libpq and node-postgres require it percent-encoded (`%40`); the verify script's worker-URL builder already encodes the worker password. Use the encoded form in `.env.local`.

**Consequence.** Live verification of the auth trigger, storage isolation, the automatic-RLS event trigger facts and the hosted worker login is pending until run outside this container (or from GitHub Actions in work item 9, with the credentials as repository secrets).

## D-032 · 2026-09-05 · GitHub → Supabase deployment has not run; diagnosis and acceptance test

**Observation.** `main` was fast-forwarded to `5d64ecb` and then `500912f`, both carrying `supabase/migrations/0001…0014`. The project shows "No migrations" and "No branches". Nothing was pushed manually; the integration must prove itself before any migration depends on it.

**Ruled out from the repository side.**
- Migration file names: the CLI's pattern is `^([0-9]+)_(.*)\.sql$` (`apps/cli-go/pkg/migration/file.go` in `supabase/cli`), so `0001_extensions.sql` is valid; no timestamp requirement.
- Directory layout: `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql` at the repository root, which the integration expects with **Working directory = `.`**.
- `config.toml` needs nothing extra for production deploys; only migrations, functions and buckets declared there are deployed. Auth, API and seed settings are ignored by design.

**Likely causes, in order (from the integration docs, `github-integration.mdx`).**
1. The GitHub connection was authorised at the account level but the integration was never **enabled on this project**: Project Settings → Integrations → GitHub Integration → choose `bryankullet/asap` → Working directory `.` → **Enable integration**. An account-level authorisation alone deploys nothing.
2. **Deploy to production** is off, or the production branch is not `main`. It is a per-project option on the same page.
3. The Supabase GitHub App was not granted access to the repository: GitHub → Settings → Applications → Installed GitHub Apps → Supabase → Repository access includes `bryankullet/asap`.
4. Working directory set to `supabase` rather than `.`, so the runner looks for `supabase/supabase/migrations`.
5. The integration only reacts to pushes made **after** it is enabled. Migrations already on `main` at enablement time are picked up by the next push to `main`, not retroactively.

**Acceptance test.** After the settings above are correct, one push to `main` (a documentation commit is enough) must produce a "Supabase" check run on the commit and a run under the project's Branches → View logs, and the Migrations page must list 0001–0014. Until then, no future migration relies on the integration, and `pnpm db:push`-style manual pushes stay forbidden for this project.
