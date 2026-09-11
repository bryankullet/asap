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

**Superseded in part by D-052 (2026-09-09):** the SQL still writes a random password, but seeding now ends with a documented password set on staging and local through the Auth admin API. Production is still never given one.

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

**Update, 6 September 2026 — probable external cause.** Supabase has an active, unresolved incident (reported 2 September 2026): a stale time cache in their platform API. The operator judges this the likely cause of the branch-list failure ("No branches") rather than repository permissions or integration settings, since the dashboard's branch and migration views are served by that API. Consequence: the causes listed above are not to be re-litigated until the incident is resolved. The operator is restarting the project and retrying both the GitHub integration and the claude.ai Supabase connector authorisation. The acceptance test is unchanged: one push to `main` producing a Supabase check run and 0001–0014 listed on the Migrations page. If it still fails after the incident closes, the list above is the diagnosis order.

## D-033 · 2026-09-07 · Edited committed migration 0013: removed the role-level GUC default

**Decision.** The statement `alter role asap_worker set app.organization_id = ''` was removed from `0013_worker_role.sql`. This is an edit to a committed migration, which the append-only rule normally forbids.

**Why the exception is safe.** 0013 had never applied anywhere except the throwaway local verification database (D-013). On the hosted project it failed on that statement with `42501: permission denied to set parameter "app.organization_id"`: hosted Supabase's `postgres` role is not a superuser and cannot set role-level defaults for custom GUCs. The migration rolled back cleanly, so no environment carries a partial 0013.

**Why the statement was redundant.** `app.worker_org()` reads `current_setting('app.organization_id', true)` — the two-argument form with `missing_ok` — verified on the project before the edit. An unset parameter returns null, which `app.can_access` treats as no access. The role default added nothing.

**Lesson recorded.** The local shim runs as a real superuser and cannot catch hosted privilege differences. Any migration touching roles, GUCs or default privileges must be applied to the disposable project before it is relied on.

## D-034 · 2026-09-07 · One-time rename of the fourteen migration files to the ledger's timestamp versions

**Decision.** Every file in `supabase/migrations/` is renamed from `nnnn_name.sql` to `<version>_nnnn_name.sql`, where `<version>` is the 14-digit version the Supabase migration ledger recorded when the migration was applied to project `abdkpcppmlqnwvxloqsb` through the connector (0001–0012 on 7 September 2026 11:49–13:46 UTC, 0013 at 14:07, 0014 at 14:08). The `nnnn` sequence stays in the name so documents can keep referring to "0013".

**Reason.** The connector's `apply_migration` records a timestamp version and our filename as the name. The CLI and the GitHub integration match on version, so `0001…0014` would have been treated as unapplied and re-run. Renaming makes the repository match the project ledger, and every future environment (local `db reset`, a production project, preview branches) records identical versions from the same files.

**Alternative rejected.** `supabase migration repair` fixes only this project's ledger; a later environment applying the files would still record `0001…0014`, and the two ledgers would diverge for good.

**Rules from here.** New migrations use `supabase migration new <name>` (which produces the timestamp form) or a hand-written timestamp that sorts after the last file. The immutability check treats this rename as the one permitted rewrite; it happened before the GitHub integration was wired up and before any other environment existed.

## D-035 · 2026-09-07 · Anon evaluates no policy; the local shim mirrors hosted default privileges exactly

**Decision.** Every policy on public tables and on the `insurance-documents` bucket is scoped `to authenticated, asap_worker` (0021). `anon` holds no EXECUTE on `app.can_access`, `app.worker_org` or `app.current_user_orgs`. `app.invitation_preview` stays anon-callable because the token is the credential. The RLS test convention is: a policy must evaluate to false for anon, never raise (`supabase/tests/README.md` rule 3).

**Reason.** Live verification found `42501 permission denied for function current_user_orgs` under anon. Granting the function to anon was rejected: nothing anon may do needs tenancy helpers. Scoping policies away from anon means RLS yields zero rows without evaluating any expression, which is both the cheapest and the least leaky outcome.

**Grant layer versus policy layer.** On hosted, anon holds no SELECT on any public table (D-020, 0014, 0015), so anon is refused at the grant layer with `permission denied for table …` before any policy runs. That is correct and the test accepts it. Only tables anon may SELECT (today `storage.objects`) exercise the policy layer, and there the result must be zero rows without error.

**Shim.** `scripts/local-shim.sql` previously granted anon and authenticated ALL on new public tables by default, a superset of hosted that hid a missing grant and made the anon test pass for the wrong reason. It now mirrors the observed hosted defaults exactly (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on Postgres 17; no SELECT/INSERT/UPDATE/DELETE; service_role everything), so 0014's explicit grants are what `authenticated` has locally too.

**Related.** 0015 revokes the API-role default privileges and the three (four on PG17) implicit privileges on every existing table, with a pgTAP test that creates a throwaway table to prove the rule holds for future tables.

## D-036 · 2026-09-07 · Frontend framework: React + Vite + TypeScript PWA, TanStack Query, TanStack Router

**Status.** Decided by the operator on 2026-09-08: React + Vite + TypeScript, TanStack Query for server state, TanStack Router for routing. `apps/web` moves from react-router to TanStack Router in UI Build Spec Phase 1. Original note follows.

**Original status.** Open. The UI Build Spec v1 (Part 13, item 7) makes this the assumption to confirm before the first UI commit; it blocks every UI phase from Phase 1 of that spec onward. Phase 0 of the spec (`packages/schema` contracts) does not depend on it and proceeds.

**Current state of the repository.** `apps/web` is already React 19 + Vite 8 + TypeScript with Tailwind 4 and the Phase 1 (work order) screens, which matches the assumption. If the operator confirms, nothing changes; if not, spec Parts 1, 3 and 11 change and `apps/web` is rebuilt.

## D-037 · 2026-09-08 · UiIntent JSON Schema is generated with Zod 4's native `z.toJSONSchema`

**Decision.** UI Build Spec v1 Part 4.1 says the strict JSON Schema for `UiIntent` is produced "via zod-to-json-schema". The repository is on Zod 4.5, which ships `z.toJSONSchema` natively; the separate `zod-to-json-schema` package targets Zod 3 and is not installed. `packages/schema/src/intent.ts` uses the native generator, and `intent.test.ts` proves `additionalProperties: false` at every object level, every field required, closed enums and `maxItems: 4` — the properties the spec's step 1 validation relies on. No new dependency.

**Also in Phase 0.** The spec references a `ComponentId` type without defining it. Pending spec Part 13 item 6 (whether the §18 registry collapses into the intent), `ComponentId` is a Zod enum mirroring the Architecture v3.1 §18 registry names exactly. When `component_definitions` exists (Phase 4 of the work order) the enum should be derived from or checked against it.

**Not implemented as written.** Part 0's port of `docs/interaction-contract.md` → `docs/ui-contract.md` could not be done: the prototype delivered to the repo is a built bundle with no `docs/` or test sources, so the four tests were written from the spec's descriptions and the contract document is outstanding. Part 6.4's `business_rule_exists('tor_meaning')` and 6.5's "stock available" were guards the spec used but did not list in 5.3; the operator supplied the missing rows (`business_rule_exists(<rule>)`, `stock_available`, `screening_source_configured`) on 2026-09-08 and they are now in the spec and in `GuardId`. `business_rule_exists` is parameterised, so `GuardRef` requires it to be written with its rule name.

## D-038 · 2026-09-08 · Rule names in `business_rule_exists` are free strings until `company_rules` lands

**Decision.** `GuardRef` for `business_rule_exists` carries `rule: string`. When the per-organization `company_rules` table is designed in Phase 2 (D-027), the rule name becomes a Zod enum of known keys (`tor_meaning`, levy rates, and so on) and the free string is removed. Agreed with the operator; recorded so the loosening is not mistaken for a design.

## D-039 · 2026-09-08 · `work_items` and `runs` exist as readable tables before the engine (migration 0022)

**Decision.** UI Build Spec Phase 1 ships Work's four views, `/r/:recordId` and the Activity chip over real Supabase reads with RLS on. Those reads need the two tables spec Part 1.2 names, so 0022 creates `work_items` and `runs` in the Part 5.1 shape with the Part 2.1 vocabularies checked in SQL, the `with_party` rule enforced at the row, and explicit grants (`authenticated` may only SELECT). The work item *engine* (guards, actions, in-transaction run outcomes, the write grants) is Phase 2 and is deliberately absent. `client_id` and `policy_period_id` are nullable uuids without foreign keys until the Phase 2 schema (D-029) exists; a later migration adds the keys. This is not the work order's Phase 2 (import, clients, policies) arriving early; it is the UI spec's read surface.

**Applied.** Hosted ledger version `20260908160320`; six work items and four runs seeded on hosted with the same rows as `supabase/seed.sql`. pgTAP `0300_work_items_and_runs.sql` covers isolation, counts, the grant layer and the row rules (113 tests pass).

## D-040 · 2026-09-08 · Task `done` renders as "Done", not "Completed"

**Decision.** The spec bans "Completed" outside the task layer, which allows it inside. The prototype's checks.mjs (line 23) is stricter: no record render may contain `>Completed<` at all, and its task group (line 16) used "Done". Per the reconciliation rule (adopt the original where it is more specific) the task label is "Done". `BANNED_STRINGS` keeps "Completed" with the task-layer exemption exactly as the spec lists it, so the exemption exists but nothing uses it.

## D-041 · 2026-09-08 · ComponentId diff: §18 registry versus the v1 catalogue

**Finding, no change yet.** Only in Architecture §18: `RelationshipSummary`. Only in the catalogue's shared-components table (27): `AppShell, AskComposer, ContextChip, SpaceHeader, RelatedSpaceLink, ActionMenu, ServiceProgress, BeforeAfterChange, EffectiveDateReview, AllocationEditor, TaxEvidenceCard, EffortEntry, CompletionChecklist, JobProgress, StepOutcome, TriggerConditionEditor, ApprovalRule, TestResult, AutomationRunHistory, EmptyState, LoadingStep, MissingData, ConflictReview, PartialSuccess, StaleData, PermissionNotice, ErrorRecovery`. The v3 additions (X08, K01–K03, G01–G02, T01–T02, N01–N04) could not be diffed: Screen Map v3 is not in the repository and the build spec names those screens without naming their components. **Closed 2026-09-08 by the operator.** Two enums. `ComponentId` = the catalogue table + `RelationshipSummary` + twelve v3-surface components (`PremiumBreakdown` X08, `ClientFileStatus` K01, `DueDiligenceChecklist` K02, `ScreeningMatchReview` K03, `AgreementCard` G01, `RateTable` G02, `CertificateStockTable` T01, `CertificateCard` T02, `UnidentifiedReceiptsTable` N01, `InsurerAccountSummary` N02, `SettlementRunTable` N03, `TaxCertificateTable` N04). `AskComponentId` is the strict subset the model may return: shell, shared-state, AI-and-rules and the twelve v3 components are excluded. `UiIntent.panel` and validation step 2 use `AskComponentId`; a test proves the subset relation.

## D-042 · 2026-09-08 · Engine writes are API-only, enforced in the database by a hashed request key (0023)

**Decision.** `work_items`, `runs`, `run_events` and `drafts` keep SELECT-only grants for `authenticated`. Every write goes through a SECURITY DEFINER function in `public` that first calls `app.require_api_caller()`, which reads the `x-asap-api-key` request header PostgREST exposes and compares its sha256 against `app.api_keys`. The API sends the key (env `API_INTERNAL_KEY`, server-only; since 0025 the API registers the hash itself on boot, D-047); the browser never holds it, so a signed-in browser calling `/rest/v1/rpc/work_item_apply` is refused with `api_only`. Tenancy is still checked inside each function (`app.current_membership`), so the key widens nothing across brokerages.

**Advisor.** Supabase's `authenticated_security_definer_function_executable` warning fires for the eight engine functions. It is intentional: they must be executable by `authenticated` for the API (which acts under the user's session) to reach them, and the gate is inside. Recorded here so the warning is not "fixed" by revoking EXECUTE.

**Functions live in `public`, not `app`.** The 0014 membership functions are in `app`, which is reachable through supabase-js only if `app` is listed under Exposed schemas in the hosted API settings. That setting is not visible from SQL; the operator should confirm it. New engine functions avoid the question by living in `public`.

## D-043 · 2026-09-08 · Guards that became real in Phase 2, and how the rest behave

Evaluated in `apps/api/src/engine/apply.ts` before the write and re-checked by 0023 at execution:

| Guard | Status in Phase 2 |
|---|---|
| `evidence_present` | **Real.** record_send / record_evidence need a non-empty reference; complete needs every step's evidence recorded. Names what is missing. |
| `version_current` | **Real.** The request carries the version the person saw; the API compares and `work_item_apply` / `run_start` compare-and-swap (`version_stale`, SQLSTATE 40001). |
| `no_duplicate_open` | **Real.** `work_item_create` takes an advisory lock and returns the open item with the same kind and title (`reopened: true`). |
| `component_declared` | Vacuous: no premium figures exist on any step until Phase 3, so nothing undeclared can be compared. The compare run says so in its events. |
| `client_file_cleared` | Warns only at renewal step 0 (spec 6.7); would block at placement approval, which is Phase 4. |
| `authority_sufficient`, `agreed_rate_exists`, `certificate_unissued`, `business_rule_exists`, `stock_available`, `screening_source_configured` | Not evaluable yet. They **block with a reason** saying so; a guard never passes by omission. |

**Task status is derived**, never authored: `deriveTask(steps)` maps the current step's actor to needs_you / in_progress / with_party (party required), and all-done to done. The API passes the derivation to the database; the 0022 row rules still hold.

**Next check after a send** defaults to three days (`DEFAULT_NEXT_CHECK_DAYS`). A hypothesis, listed for OPERATOR-VALIDATION; it will become a company rule.

## D-044 · 2026-09-08 · Public wrappers for the membership flows; the `app` schema stays unexposed (0024)

**Decision.** The seven 0014 functions the API calls through `rpc()` (accept_invitation, create_invitation, create_organization, invitation_preview, revoke_invitation, set_active_organization, update_membership) each get a SECURITY INVOKER wrapper in `public` with the same signature and the same grants. The API code is unchanged: `rpc("name")` now resolves in `public`. `app` is not added to Exposed schemas. `app.handle_new_auth_user` loses the PUBLIC execute grant it carried by default; only `supabase_auth_admin` (the role that inserts into `auth.users`) holds it. pgTAP `0302` proves anon can execute `public.invitation_preview` and nothing else in `public` or `app`.

## D-045 · 2026-09-08 · Run recovery on boot (0024)

**Decision.** `runs.boot_token` records the API process that started a run (`<pid>-<uuid>`, new on every boot). On boot, before accepting traffic, the API calls `runs_recover(token)` with the service client: every run still `working` under another token, or with no token, becomes `could_not_finish` through `app.run_end_internal`, the same path as `run_end`, so its step is blocked with a plain reason and its work item is created or moved to needs_you in the same transaction. Audit rows are `actor_type = 'system'`. `runs_recover` is executable by `service_role` only. This is the one admin path that uses the service client; it reads no tenant data on a user's behalf. Recovery failure is logged, not fatal.

## D-046 · 2026-09-08 · Resend replaces Postmark; email and Sentry are optional everywhere

**Decision.** Platform transactional mail (invitations, resets, notices) goes through Resend: `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, set together or not at all. Postmark and D-007's deployed-environment requirement are gone. When either transport is absent the API boots, logs one warning line naming the disabled feature, and behaves as `LogMailer` (invitation links logged, not sent) or without error reporting. Nothing about draft/send changes: client and insurer mail is still drafted and sent by a person (spec Part 7); Resend carries only the informational messages a brokerage explicitly turns on, and invitations.

## D-047 · 2026-09-08 · The API registers its own key on boot (0025)

**Decision.** On boot, before run recovery and before serving, the API hashes `API_INTERNAL_KEY` and calls `api_key_register` with the service client. An active matching row means nothing changes; otherwise every other active row is revoked and the new hash inserted. Registration failure is fatal, because no engine write could succeed. `scripts/set-api-internal-key.sh` is removed. On Render the value is `generateValue: true`, so no person ever sees it. Standing rule: no key value appears in a reply, a file or a log; the logger redacts `API_INTERNAL_KEY` and `RESEND_API_KEY`. Hosted: every previously registered key is revoked; the first boot of the API registers the live one.

## D-048 · 2026-09-09 · Client files, agreements and the placement gate (0026, UI Build Spec Phase 4)

**Tables.** `insurers`, `clients`, `client_file_documents`, `agreements`, `agreement_versions`, `agreement_rates`. `work_items` gains its `client_id` foreign key (promised in 0022) plus `insurer_id`, `class_of_business` and `cover_inception_at`. `clients` is the first business-record table; it exists because Phase 4 of the UI spec is the client file, not because the work order's import phase started. Import (Phase 2 of the work order) will populate it with `source = 'imported'`.

**Every client lands as not_started.** A `before insert` trigger refuses any other value, from any path; pgTAP `0304` proves an imported row cannot be created as cleared or incomplete. Only `client_file_clear()` sets cleared, after a named person types a reason and the file holds what the client's kind needs (an identity document; for a company also a beneficial-ownership declaration). Cleared past `refresh_due_at` reads as refresh_due (`client_file_state()`), which is the derived state, not a stored one.

**Screening (K03) is parked.** No screening source exists (spec Part 13 item 3). The file screen says "Cannot be screened yet" with the reason, and the `screen` action returns the `screening_source_configured` guard as a blocked outcome. No function can record a screen.

**Agreements.** One per insurer, versioned; a new version closes the previous one the day before. A rate proposed by ASAP or a person is unusable until a person confirms it; `agreed_rate()` returns confirmed rates only, for the version effective on the date. G01's headline number is live items whose class has no confirmed rate with the insurer.

**Guards that became real.** `client_file_cleared`: evaluated by the API from the effective file state, re-checked by `work_item_approve()` at execution. Blocked approvals say the gate's sentence and link to K02. `agreed_rate_exists`: real, confirmed rates only; it warns in the placement-prepare run and will gate commission expectations in Phase 3.

**The override.** Only `brokerage_admin` (the principal officer; there is no separate role yet) may override the gate, with a typed reason. The database writes the permanent audit entry `placement.client_file_gate_overridden` and creates a needs_you item owned by the overriding principal, which is how it reaches their Today. Denied approvals are audited by the API under the caller's session (D-026: a raising function cannot keep its own denial row).

**Not on the placement recipe.** `authority_sufficient` is listed by spec Part 6.2 on the approval step; authority limits do not exist yet, and a guard that blocks by omission would make every placement unapprovable, so it is left off the recipe and recorded here. It joins the recipe when authority limits are designed.

**Cover.** Moves to Confirmed only when the insurer's written confirmation is recorded; Confirmed reads as Active cover once `cover_inception_at` passes, by date, computed on read (`effectiveCoverStatus`).

## D-049 · 2026-09-09 · Render supplies service addresses as hosts; ENCRYPTION_KEY is generated

**Corrected 2026-09-09.** `fromService … property: host` provides a service's private-network hostname. That is unreachable from a browser, so it was wrong for all three uses: the static site's `VITE_PUBLIC_API_BASE_URL` (baked into the bundle, called from browsers), the API's `WEB_BASE_URL` (the CORS origin, compared against the browser's public origin) and `API_BASE_URL` (what people receive in links). All three are now `sync: false` dashboard values holding the public URLs. The `*_HOST` fallbacks in the env loaders stay, harmless, for a future private-network consumer. Symptom that found it: the deployed `/today` never left its loading state because every API request went to `https://asap-api`.

**Decision (original).** `render.yaml` uses `fromService … property: host` so neither service needs the other's address typed in. Render hands over a hostname, not a URL, so the env loaders accept `API_BASE_HOST`, `WEB_BASE_HOST` and `VITE_PUBLIC_API_BASE_HOST` and derive `https://<host>` when the `*_URL` twin is absent; a set `*_URL` always wins. `ENCRYPTION_KEY` is `generateValue: true` and the schema now requires at least 32 characters rather than exactly 44 base64 characters, because nothing derives a cipher key from it yet; the first consumer must run it through a KDF. Rotation rules in SECRETS.md are unchanged: back it up the day it is generated.

## D-050 · 2026-09-09 · Ask never creates a client from a name

**Rule.** v1 catalogue Part 1: "Ask for a choice when a name or policy period is ambiguous"; H02: "Renew Acme: ask which". **Decision.** "Renew X" matches existing clients by normalised name (`matchClientName`: case, punctuation, whitespace and trailing legal suffixes ignored; one exact match wins, otherwise plausible contains-matches). One match opens or reuses the item. Several plausible matches return `ambiguous` with the candidates and the person picks. No match returns an intent whose only suggestion is "Create X as a new client"; that action goes through the H05 create path (`POST /clients`), which returns possible duplicates first and creates only on `confirmNew`. A test proves three spellings of a seeded client create zero rows. Matching reads the brokerage's clients under RLS and matches in the API; at import scale this moves to a database query.

## D-051 · 2026-09-09 · Claims and endorsements (0028, UI Build Spec Phase 5a)

**Tables.** `policies`, `policy_periods` (the thin client-policy-year of D-029 option B: id, policy, two dates), `policy_versions` (effective-dated, items as a schedule of covered and uncovered lines), `claims`, `claim_documents`, `claim_notes`, `endorsements`. `work_items.policy_period_id` gains its foreign key.

**Claims (Part 6.6), ten steps.** A claim is created as a draft whatever its source; only `claim_register()`, a person choosing a policy period that contains the incident date, makes it registered — a claim from email stays a draft until then. Two candidate periods → the person chooses (`evidence_present` names the count). Cover on the incident date is a run whose only output is a review sentence, "looks right" or "does not look right", never "is covered"; `CLAIM_BANNED_PHRASES` is tested over the run output and the screen. The notification clock is derived on read from six inputs stored all-or-nothing (`claims_clock_all_or_nothing`, `claim_set_clock`); without both a clause with its page and a verified start event it reads "Clock not started" with the reason, and nothing anywhere asserts a breach. Outstanding documents are named with who holds them. A call note is a `claim_notes` row of kind `call_note`; the response step refuses `evidenceKind: call_note` with the reason and takes only the insurer's email or letter. Settlement offered, client accepted and payment received are three column pairs written by `claim_fact_record()` one at a time, three steps, three rows on screen; there is no merged status and `unknown_fact` refuses one.

**Endorsements (Part 6.3), six steps.** Classify runs from the request's own words; an ambiguous request pauses and asks. Check requirements pauses naming what is missing. The insurer's response is itemised: `endorsement_item_decide()` records one decision per item with the written response's reference, and the response step is blocked while any item is undecided. `endorsement_apply()` creates a new policy version effective on the endorsement date, closes the previous version the day before and keeps it; accepted items are applied, rejected items are written into the new version as `covered: false, status: rejected_by_insurer` with the insurer's note, visible on the policy. Transfer of ownership is applied only when `instruction_from = 'policyholder'` with a reference; a request from anyone else is recorded (the endorsement row, the instruction, the audit) and blocked at requirements with the reason naming who asked.

**Guards.** `evidence_present` is now real for: claim documents (names each outstanding document and its holder), claim matching (a chosen period that contains the incident date), claim response (a call note never satisfies it), endorsement response and apply (every item decided, response reference present), transfer (the policyholder's own instruction, re-checked by the database at apply). `component_declared` on the additional-premium step stays vacuous until money exists. The spec's "wording clause extracted" guard on the clock step is modelled as the two named evidence requirements and the all-or-nothing clock. `authority_sufficient` on endorsement step 3 is omitted for the reason recorded in D-048 and the work list.

**Not built.** Draft claim detection from a mailbox (no mailbox yet): `source = 'email'` is set by whoever captures it. Additional premium (step 6) records an invoice reference only. Closing and reopening a claim beyond the tenth step. TOR, certificates and stock are Phase 5b.

**Applied.** Hosted ledger version `20260909091723` (file renamed to match, per D-034); two policies, two periods and two version-1 schedules seeded on hosted with the same rows as `supabase/seed.sql`. pgTAP `0306_claims_and_endorsements.sql` (26 tests) passes on hosted, run inside a rolled-back transaction with pgTAP installed for its duration.

## D-052 · 2026-09-09 · Staging fixture users get a documented password, set through the Auth admin API

**Decision.** Seeding ends with `pnpm db:seed:passwords` (`scripts/seed-set-passwords.mjs`), which gives the seven fixture users the password recorded in `docs/staging-users.md` by calling the Supabase Auth admin endpoint (`PUT /auth/v1/admin/users/{id}`) with the server-side service key. The script refuses to run when `APP_ENV` is `production`, and refuses when `APP_ENV` is unset or anything other than `staging` or `local`. `SEED_PASSWORD` can replace the documented value; the minimum stays 12 characters (D-005). `scripts/seed-set-passwords.sh` (psql, local only) is removed.

**Reason.** Staging holds synthetic data only (D-003), so a known password there is a convenience, not a credential to anything real, and it lets people sign in without a mailbox. Going through the admin API rather than writing `auth.users.encrypted_password` keeps GoTrue the owner of how a password is stored. The refusal is by environment name rather than by project URL because the name is what deployments already carry (`appEnvSchema`) and the URL of a future production project is not known here.

**Applied.** The hosted project has no service key reachable from this session, so the same password was set on hosted through the SQL connector with `extensions.crypt(..., gen_salt('bf'))`, which is the hash GoTrue verifies. The script is the path from here on.

**`asap_worker` and the `extensions` schema (checked 2026-09-09, no migration).** Running the pgTAP suite on hosted showed `asap_worker` holds no USAGE on `extensions`; 0013 grants it `public` and `app` only. Checked whether anything the worker role runs touches an extension: the worker code executes only `set_config('app.organization_id', …)` and Drizzle queries over public tables; the three helpers its policies evaluate (`app.worker_org`, `app.can_access`, `app.current_user_orgs`) reference no extension; no column default or trigger function on a public table references one; and the single function that does (`app.is_api_caller`, `extensions.digest` for the API-key gate, D-042) is not executable by `asap_worker` and runs only inside the API's SECURITY DEFINER engine functions, as their owner. So the missing grant costs the worker nothing today, and the test-time grant in 0200 stays a test fixture. The day a worker-run function or policy needs pgcrypto or pgvector (document chunks, Phase 3), that is a migration: `grant usage on schema extensions to asap_worker`, with the function names in the migration comment.

## D-053 · 2026-09-09 · Creating a brokerage is idempotent on a client request key (0029); the profile control (C01)

**Decision.** `POST /organizations` requires `request_key`, a uuid the browser generates once per mount of the create form. `app.create_organization` gained a seventh argument: when the same signed-in person repeats a key, the function returns the brokerage it already created for that key and creates nothing; a race between two identical requests is settled by the partial unique index on `(created_by, creation_key)`, the loser returning the winner's row. The key is scoped to the creator, so a key can never return someone else's brokerage. The six-argument form remains and forwards with no key. The form also refuses a second submit while the first is in flight and navigates to `/today` on success.

**Reason.** The first live click-through created two brokerages: the first submit created the row, the browser never saw the response (the CORS origin was the private-network host, D-049 correction), so the person submitted again. Disabling the button is not enough on its own: a lost response, a retry or a reload must also be safe, and only the database can promise that.

**Sidebar (C01).** The loose Members, Agreements, Client files and Sign out links at the bottom of the sidebar are replaced by one profile control showing the brokerage and the person; it opens a small menu with the brokerage switcher and those four entries. The sidebar is exactly Today, Work, Automations, Ask, Search, + New, profile. `ProfileMenu` is pure and covered by `shell.test.tsx`.

**Links from the API.** Checked on the same click-through: invitation links are built from `WEB_BASE_URL` (`acceptUrl` in `routes/invitations.ts`), and the auth links the browser asks Supabase to send (magic link, sign-up confirmation) are built from `window.location.origin`. No API link is built from localhost. Supabase's own Site URL is set in its dashboard.

**Applied.** Hosted ledger version `20260909192143`. pgTAP `0100` (now 25 tests) proves a repeated key returns the same id and creates one row; the API test proves a concurrent double submit is one brokerage.

## D-054 · 2026-09-09 · The audit log survives organization deletion (0030)

**Decision.** `audit_log.organization_id` is `ON DELETE RESTRICT`. Deleting a brokerage is refused while any audit row references it, and since `create_organization` writes two audit rows in the same transaction, every brokerage has them from birth: deletion is impossible until a deliberate offboarding path exists that decides, on its own terms and with its own audit trail, what happens to history. The Drizzle schema mirrors the rule so the drift check agrees.

**Reason.** Screen Map v1 C05 (Audit log and event detail): "never rewrite historical outcomes". Cascading the audit rows away with their brokerage rewrites them to nothing. This surfaced when the test duplicate from the first click-through was deleted by hand (D-053) and its own creation rows cascaded with it; the deletion record had to be filed under the surviving brokerage to outlive the delete. That workaround is exactly what the constraint now makes unnecessary.

**Alternative rejected.** An organization-independent audit table with a soft reference would let rows outlive the brokerage, but it removes the referential guarantee everywhere else (tenancy policies key on `organization_id`) and gives up the stronger property: with RESTRICT, history is not merely preserved, it is a reason the delete cannot happen. Offboarding (architecture: hard deletes are reserved for it) will need its own decision about retention before it can drop the constraint's protection, and that is the right order.

**Applied.** Hosted ledger version `20260909194947`; pgTAP `0307` (5 tests) passes on hosted.

## D-055 · 2026-09-09 · The active brokerage is resolved on sign-in, not left to the browser

**Decision.** `GET /me` sets the active brokerage when the caller has none and exactly one active membership, by calling `set_active_organization` (which still refuses any brokerage the caller is not an active member of). Two or more memberships and none chosen leaves it null and the browser shows a chooser naming each brokerage and the role held in it; zero memberships goes to create-or-join, unchanged. The profile control names the only brokerage rather than saying "Choose a brokerage" when there is exactly one, and hides the switcher entirely in that case. `supabase/seed.sql` sets `active_organization_id` for all seven fixture users, and pgTAP `0100` fails if any seeded user lacks one or points at a brokerage they are not an active member of.

**Reason.** Every seeded user signed in to an empty Today: the seed never set `active_organization_id`, `resolveContext` therefore reported no active organization, and `Today` rendered its empty state telling the person to choose a brokerage from a switcher that offered exactly one. Asking someone to choose between one thing is not a choice, and the server already knows the answer. Doing it in `/me` rather than in the browser keeps §45 rule 5 intact: the browser never supplies an organization id, it only ever asks to switch.

**Seed defects found while proving it.** The Phase 5a section promised "a draft claim from email" and wrote none: there were zero `claims` and zero `endorsements` rows, so two of the five things Today should rank did not exist. The seed now carries a draft claim for Jane Wanjiku (incident 2 September, two outstanding documents) and an endorsement for Acme Motors whose insurer has answered item by item, each with the steps its recipe produces. The renewal's next check was two days in the future, so it never reached "Checks due"; it is now a day overdue. Beta's CIC check was a day out, which drifted into "due" as time passed, and is now thirty days out so it stays where it belongs.

**Applied.** Hosted: all seven users given an active brokerage, the claim, the endorsement and the corrected work items written. Verified on hosted as each of the eight seeded identities under RLS: Amina sees 2 clients, 2 policies, 6 work items, 3 runs, 1 claim, 1 endorsement, 1 client file and 1 agreement and zero Beta rows; David sees 1 client, 2 work items, 1 run and zero Acme rows; Grace sees both. `docs/click-through.md` is the acceptance document, and `today.acceptance.test.tsx` holds Amina's five rows as fixtures.

## D-056 · 2026-09-09 · The v4 prototype's visual design is ported into `packages/ui`; two of its components are not

**Decision.** The prototype's `dist/styles.css` `:root` block is now `packages/ui/src/styles.css`, the single source for every colour, radius, shadow and the 224px sidebar. Nothing else declares a colour. Alongside the palette the file adds the darker text tones the prototype uses on soft backgrounds (`*-ink`), the status dot colour, and the sunken grey, all of which were being approximated with the wrong values before. Figtree and Outfit load from Google Fonts in `apps/web/index.html`, each behind a full system stack, so the app is legible before the webfont lands and if it never does.

**Primitives.** `card` (quiet, attention, green, dark, clickable), `button` (primary, green, ghost, soft, warn, compact, full, link), `chip` and `count`, the status pill with its leading dot, `notice`, `checklist`, `timeline`, `table`, `modal`, `drawer`, `empty state` and `toast` — the prototype's names and behaviour. The most consequential correction: a card is a hairline border and an 18px radius, never a drop shadow at rest. Shadow now means "this floats" — the Ask dock, a modal, a drawer, a toast, and the lift a clickable card takes on hover.

**Status.** The prototype's `running / waiting / review / done` is the old vocabulary and is not carried into the code. The colour treatments are kept and driven from our own enums through the existing slot components: `TaskStatus`, `RunStatus`, `CoverStatus`, `MoneyStatus`, `FileStatus`, `StockStatus`. The Part 2.3 slot enforcement is untouched, so a status word rendered in the wrong place still throws in every build.

**Not ported, deliberately.** `.progress` and `.confidence`, both banned by Screen Map v1 Part 1. A progress bar across policy years draws a client-policy-year as a task that is some percentage finished, which is a number nobody measured; a confidence percentage presents a model's self-reported certainty as evidence, when the rule is that ASAP abstains where it is unsure and every figure it shows is tappable to its source. `packages/ui/src/banned.test.ts` is the guard: it fails if either arrives as a primitive, or if any file in the library or the app grows the ARIA roles such a bar needs.

**Scope.** Styling only. No screen gained a feature, a prop or a data read. The one layout change is Ask, which moves from the sidebar to the docked bar at the foot of the workspace, as the prototype has it and as the spec's "Ask stays reachable" requires. The banned-string test over rendered output and the Today acceptance test were not touched and still pass.

## D-057 · 2026-09-09 · The record page leads with a focus card and is composed by kind (build spec Part 14)

**Decision.** `/r/:recordId` now leads with one focus card stating the next decision in business words, and the full step list becomes supporting context beneath it under the heading "Every step". What sits between them is composed by record kind, from `RECORD_SECTIONS` in `packages/schema/src/recipes/record.ts`, following the prototype's `recipe()`. A section renders only when the kind lists it and there is something to put in it, so a reconciliation never grows a claim's document checklist. The page closes with the record footer: the source chip, Activity and History. The rules are written down as Part 14 of the UI Build Spec, because inferring them per screen is what produced the gap.

**Reason.** The record page rendered every step at equal weight and nothing else, so the one thing a person is being asked to do was buried in a list. The prototype answers this with a focus card and a per-kind recipe, and neither was in the build spec, so neither got built.

**Derived, never authored.** The headline comes from a phrasebook keyed by `kind:stepId`, falling back to the step's own label where there is no phrasing; the sentence of why is the `reason` the engine already wrote; the blocker is the step's own `state` and `reason`, or the first guard it is waiting on. No new data, no new guard, no engine change: the action panel moved inside the focus card, drafts moved out of it into their own section, and that is the whole of it.

**Honest about what is missing.** The prototype's record page also carries insurer terms, outstanding premium lines, a document's source excerpt and a report's bars. Those need Phase 3 money, Phase 3 extraction and Phase 7 reporting, so Part 14 names them as arriving with their phase rather than stubbing a panel. History is C05 and not built, so the footer says so rather than offering a control that goes nowhere.

## D-058 · 2026-09-10 · The two plans are reconciled: each owns a layer, and neither renumbers the other

**Decision.** The repository has carried two phase plans since 8 September — Architecture v3.1 §43 (thirteen phases, a `Discover · Spaces · Jobs · Automations` shell) and UI Build Spec v1 Part 12 (eight phases, a `Today · Work · Automations` shell). They were both live, they disagreed on the shell and on what "Phase 4" and "Phase 5" mean, and nothing recorded which one governs what. Each now owns one layer:

- **Architecture v3.1 is the source of truth for backend architecture, security, the economic rules and dependencies.** Tenancy, RLS, the audit obligations, the economic model's prohibitions and the seventeen non-negotiables in §45 are settled there and nowhere else.
- **Screen Map v3 and `docs/ui-contract.md` are the source of truth for visible navigation, wording and interaction.** Where the architecture's §42 shell and Screen Map v3's three destinations disagree, **v3 wins on what a person sees.** The architecture still wins on everything behind it.
- **UI Build Spec v1 Part 12 remains the delivery checklist**, tracked at the foot of `docs/PHASE-1-WORK-ORDER.md`. It orders the work; **it may not bypass an architecture dependency.** A build-spec phase whose prerequisite sits in an unbuilt architecture phase waits, or ships the part that does not need it, and says which.
- **A new insurance capability is not built as a temporary fixed page when it can be built directly on the Space system.** From the first Renewal Space onward, the question for each new capability is which blocks it needs, not which page it gets.
- **No existing phase is renumbered.** Both numbering schemes stay as they are. When a phase number is written down, it names its plan: "build spec Phase 5b", "architecture Phase 3".

**Reason.** Two live plans meant every session could reasonably pick either, and the file that was meant to arbitrate — `CLAUDE.md` — described the older shell while also declaring the architecture the winner. That is not a drift to be corrected later; it is an ambiguity that produces different products depending on who reads which document first.

**Corrected in this commit.** `CLAUDE.md` now describes the permanent shell as Today · Work · Automations, with + New and Search as utilities, Profile at the bottom, Ask ASAP persistent and never a destination, and Activity as the chip where ASAP's runs appear. Insurance modules remain barred from primary navigation (§45 rule 16) — that rule is unchanged and both plans always agreed on it.

**What did not change.** No phase was renumbered, no work order was rewritten, and the architecture's authority over the backend is untouched.

## D-059 · 2026-09-10 · `UiIntent` and `component_definitions` have separate responsibilities

**Decision.** Build spec Part 13 item 6 asked whether the Architecture §18 component registry collapses into the narrower `UiIntent` of Part 4, and said "only one should survive". Neither survives alone: they answer different questions, and the resolution is to give each one job and forbid it the other's.

**`UiIntent` is the small validated result envelope.** It carries what was asked and what should be shown: the intent, the result type, the relevant records, the Space type, the suggested actions, and **which registered blocks are requested**. It is deliberately small enough to validate in one parse.

**`component_definitions` is the authoritative registry of allowed components and their property schemas.** A component's identity, version, purpose, permitted Space types, property JSON Schema, required permissions, whether it may carry an action and whether it requires evidence live there, in the database, as data — not in a hand-written enum.

**The rules that follow:**
1. `UiIntent` **references registered component IDs**. It must not maintain a competing catalogue of its own. `AskComponentId` therefore stops being a hand-written list and becomes the subset of the registry marked as returnable by Ask.
2. The renderer may render **only** components present in `component_definitions`. A block naming anything else is dropped and the Space shows a state, never a blank.
3. **The server validates every plan before it reaches the browser.** Validation is not a client-side courtesy; a plan that fails any rule never leaves the API.
4. **No model may invent** a component, a business value, a permission, progress, a cover state, a money state or an action. Values are read from the database by id; progress derives from steps; cover and money come from their own columns; actions come from the finite verb list; permissions resolve from the session. This is §45 rules 9, 10 and 12 restated at the plan boundary.

**Reason.** The two contracts were not competing catalogues by accident — one is a message and the other is a schema registry. Collapsing them either bloats the envelope until it cannot be validated cheaply, or reduces the registry to an enum that cannot carry a property schema, a permission or an evidence requirement. Keeping both, with the envelope referencing the registry, is the only arrangement in which "the model cannot name a component that does not exist" is enforceable against data rather than against a constant someone remembered to update.

**Consequence for D-041.** D-041's interim answer — two hand-written enums — is superseded for `ComponentId`. The enum stays only as the compile-time mirror, and a test asserts it matches the registry rather than the reverse.

## D-060 · 2026-09-10 · Today becomes Discover; still three destinations, and Jobs is still not one

**Decision.** The first destination is renamed **Discover** and its canonical route is `/discover`. `/today` redirects to it permanently, so existing links, bookmarks and `?next=` values keep working. The shell is now:

```text
✦ Discover   ▣ Work   ⟳ Automations      + New   ⌕ Search      Profile
```

**This is a rename, not a fourth destination.** Screen Map v3's rule is about the *count* — "There are still three destinations. Nothing below becomes a fourth" — and the count is unchanged. It supersedes the label in Screen Map v3 §1.1, `docs/ui-contract.md`, `CLAUDE.md` and D-058, each of which is updated in the same commit. D-058's arrangement of authority is untouched: Screen Map v3 and the ui-contract still govern visible navigation, and this is them being amended, not overruled.

**Reason.** "Today" names a time; "Discover" names a job — *what matters now?* The surface was already ranked work rather than a diary, and the name was the last thing implying otherwise. Architecture v3.1 §42 has said `Discover` since v3.0, so this moves the visible shell **toward** the controlling document rather than away from it: the architecture wins on everything behind the screen, and here it happens to have been right about the screen too.

**Jobs does not become a destination, and that is not a compromise.** `apps/web/src/shell/nav.ts` lists `Jobs` in `NEVER_NAV` and `shell.test.tsx` asserts it. Screen Map v3: "Runs live in an **Activity** chip beside the Ask composer, never in navigation," and "a run may never be the only place something important lives; a run that pauses or fails creates an item in Work first." The richer run experience the prototype shows as a Jobs destination is therefore built in three places that already exist — the Activity chip, a record's run history, and Work — because a person's queue and ASAP's queue are different things and a fourth nav item would blur them.

**Discover became a real attention surface in the same commit,** not just a renamed page:

- **Ranking is deterministic and server-side.** `apps/api/src/attention/signals.ts` holds a fixed weight table over twelve named signals — `run_failed`, `step_blocked`, `check_overdue`, `cover_uncertain`, `file_blocks_placement`, `period_ending`, `exception_open`, `evidence_conflicting`, `evidence_missing`, `evidence_stale`, `money_unpaid`, `untouched`. Each is computed from a column and carries a `because` naming the row it came from. The score is the sum of its signals and nothing else, so a ranking can be audited against the record, and a test can too.
- **No model authors a score, a reason or a business value.** A model may one day *explain* a ranked item. It may not produce one. This is §45 rules 9 and 10 applied to attention.
- **The cap is twelve.** Discover is a short ranked list, and it says how many it left out.
- **The six evidence conditions are modelled**: Known, Inferred, Conflicting, Missing, Stale, Waiting for verification. They describe *evidence*, so they are a sixth vocabulary with their own slot beside a fact, sharing no word with the four status layers. "Waiting for verification" is written in full precisely so it is never read as the banned bare "Waiting". Conflicting shows both sources and resolves neither; inferred always says what it was derived from; missing and waiting never carry a reference, because that is what makes them missing.
- **Cover requested is not cover confirmed.** A requested cover status produces a `waiting` fact reading "A request is not proof of cover; no insurer confirmation is recorded", and a `cover_uncertain` signal. The prototype's central rule is a computed condition here, not a sentence someone wrote.
- **Every card leads somewhere**: the Work item, the client's file, the policy period, and Ask pre-filled with the item's own words.
- **Partial success is a state.** A context read that fails degrades the answer and names what is missing (`degraded[]`) rather than failing whole or rendering a confident gap.

**Not decided here.** Whether a model ever explains a ranked item, and which model — that is build spec Part 13 item 6, still open. Nothing generative ships until it is.

## D-061 — Ask ASAP: one provider-neutral gateway, OpenAI first, and three checks we own

**2026-09-11.** Ask now answers questions. The decisions that shape it:

**The gateway is provider-neutral by construction.** `packages/schema/src/ai/gateway.ts` defines
messages, tool declarations, requests, responses and failures; nothing above it names a vendor.
OpenAI is the first production adapter, chosen by `AI_DEFAULT_PROVIDER` with the exact model in
`AI_MODEL` — server-side configuration, never a constant in code and never sent to the browser.
Anthropic is a sibling adapter and one config value; adding it changes no router, tool, contract,
evaluation fixture or renderer. A deterministic provider serves the tests and the evaluation set.

**With nothing configured, Ask is honestly unconfigured.** `not_configured` is a designed state
that says a model is not connected. It is not a spinner, not an empty result, and it names no
provider, model or key.

**Three checks run on every reply, and all three are ours rather than the provider's.** The reply
must parse as a `UiIntent`; every record id it names must be one a declared tool returned on that
turn; and the sentence may not assert a status, a percentage or an approval outcome. Failing any
of them abstains with a reason. This is what "do not treat AI output as authoritative" means in
code (§45 rules 8, 9, 10, 12).

**Routing is decided in the browser, deterministically.** A named operation goes to the create
path, a lookup to search, a question to the model. An exact database question is a lookup, not a
model call (§45 rule 7), and making that a model's judgement would add a way to get it wrong
without adding anything.

**The model chooses a record and a view, never blocks or values.** An answer that is a workspace
opens the record on the asked-about view, and the existing server-side plan validator and
component registry build it. There is no second renderer and no second path by which a value
could arrive from model text.

**Conversations are personal within the brokerage** (0032). Colleagues share the work a
conversation produced — that lives in `work_items` — but not the asking. Every policy carries
both `app.can_access` and `created_by = auth.uid()`.

## D-062 — Pinning is a personal marker, not a view

**2026-09-11.** A pin says "I am coming back to this" — one person, one record, one brokerage
(0033). What it deliberately is not:

- **Not a destination.** `Pinned` and `Kept` join `NEVER_NAV`. A Pinned tab would be a list page
  for a thing rather than a surface for work, which is the old product leaking back in. A person
  finds their pins on the record and in the small list beside it, where the marker already lives.
- **Not a Work view.** Work's views are the states work is actually in. A personal marker is not
  one of them.
- **Not a status, and not a thumb on the scale.** Pinning bumps no version, writes no step, and
  writes no audit row, because keeping a marker is not a business action on the brokerage's
  record. Discover's order is computed from signals and is not moved by anyone's marker (D-060).
- **Not shared.** Colleagues share the work a pin points at — that is in `work_items`, where
  everyone in the brokerage sees it — but not what someone chose to keep. Every one of the four
  policies carries both `app.can_access(organization_id)` and `user_id = auth.uid()`, and the
  insert policy additionally refuses a pin naming a brokerage the record is not in.

## D-063 — Documents, connected email and automations

**2026-09-11.** Three increments, and the decisions in each that were not obvious.

**Documents (0034).** The constraints live at the database because the route will not be the only
thing that writes these rows. A region without a page cannot be stored — a citation you cannot
open is not a citation. A field cannot be `accepted` with nobody having accepted it. Extraction
reports one of the six evidence conditions rather than a percentage: a number invites a threshold
nobody agreed. Review is gated on `document:edit` from the 0005 catalogue rather than a new
`review` verb, which would have left every existing role grant silently not covering it.

**Connected email (0035).** The mailbox interface returns a three-way outcome, and the third value
is the whole point: `outcome_unknown` stays unknown. It is not retried automatically and not
rounded to either neighbour, because only a person can check the sent folder and know whether the
client already has the letter. Mapping a timeout onto `failed` and retrying is how a client
receives the same letter twice.

Microsoft's `/sendMail` answers **202 with an empty body** — acceptance without evidence. So that
adapter creates a draft, sends it, and reads the id back, because "sent" has to mean something we
can show a person later. Gmail threads on `threadId`, not the subject, so a reply without it
starts a second conversation in the client's inbox.

**Automations (0036).** They prepare; they never decide. The prepared action is a named verb from
the engine's vocabulary on the record's own next step, and the record's guards apply unchanged —
an automation does not get to do what a person at the same step could not.

Worth stating plainly: **no verb in the engine vocabulary sends anything.** `draft` opens a draft
for a person; `record_send` records that a person sent. Both are nonetheless marked
`sends_externally`, so the 0036 constraint refuses `approval: never` on them — an automation that
silently drafts letters to insurers, or records sends nobody made, is not something a brokerage
should be able to switch on unattended. Whether an automation is outward-facing is read from the
verb, never taken from the request: a browser that could set it false would be a way around §45
rule 13.

Every firing is recorded, including the ones that did nothing, with each condition's result. A
silent automation is worse than none, and "why did nothing happen?" has to have an answer.

## D-064 — The approved interactive demo controls the frontend experience

**2026-09-11.** A deliberate product-direction change by the operator. The approved demo at
`asap-policy-demo.info913882.chatgpt.site` is now the controlling source for the visible product:
shell, navigation, layouts, scenarios, screen behaviour and interaction design.

**The hierarchy of truth for frontend work is now:**

1. Security, tenant isolation, evidence integrity, permissions, approvals and audit — unchanged and
   untouchable.
2. The approved demo, for everything a person sees.
3. Existing frontend documents, decisions and tests.
4. Existing frontend implementation.

An earlier frontend decision is no longer a reason to omit an approved screen. Where one conflicts,
the decision is amended — which is what this entry does.

**Superseded, with the reasoning:**

- **Three destinations (D-058, D-060).** The shell is now Discover · Ask ASAP · Work · Jobs ·
  Automations. The count was never the rule: §45 rule 16 bans *insurance modules* as navigation —
  Clients, Policies, Renewals, Claims, Money — and none of these five is one.
- **Jobs may never be a destination (D-060).** Jobs has left `NEVER_NAV`. It answers a different
  question from Work — what *ASAP* is processing, rather than what a *person* owns — and showing
  both separately is how a broker sees the software working without being misled about what a
  finished job means.
- **Ask ASAP is only a docked composer.** It stays permanently reachable and is now also a full
  destination, which is how the approved demo presents it.
- **The prototype is a loose visual reference.** It is the acceptance specification. The static DOM
  is still never copied: this is React, over shared Zod contracts, authenticated APIs and real
  state. "Do not copy the DOM" never meant "simplify the design".
- **Pinned may not appear in navigation (D-062).** Pinned is now an approved Work *filter*. It is
  still not a destination, and what proves that is its absence from `NAV`.
- **`BANNED_STRINGS` (D-056 lineage).** The list banned Waiting, Completed and Job — the approved
  product's own vocabulary. It now bans only what would mislead: `Space` (called Work on screen),
  `Needs you` (retired), `Success` (an outcome claim), and `Failed` outside the run layer.
- **"Needs you" as a status word.** Gone from every visible surface. The `needs_you` enum stays,
  because it is a database value and renaming it would be a migration that changes nothing a person
  sees. `vocabulary.test.ts` walks every label map so it cannot come back.

**What did not change, and will not:** multi-tenant isolation, RLS, server-side organization and
permission resolution, evidence requirements, human approval for consequential actions, audit
history, no unrestricted model SQL, no model-authored business facts or status, no uncontrolled
external communication, the provider-neutral gateway, private document storage, idempotency,
outcome-unknown handling, the separation of Work, Job and insurance status, and no n8n.

**Demo mode.** `VITE_PUBLIC_DEMO_MODE=on` seeds the approved fictional brokerage, lets Ask answer
from the approved scenarios when no model is configured, and shows the presenter bar. Everything it
touches is labelled as demonstration data, and a simulated send says so rather than implying a
provider delivered it. Production keeps real OAuth, real approval and real provider evidence.

## D-065 — Demo mode is a public application, branched above the authentication guards

**Reported from the deployed site.** Opening `https://asap-web.onrender.com/discover` redirected to
`/sign-in?next=%2Fdiscover`; after signing in it returned to `/discover` and showed "We could not
load your account. Refresh, or sign in again." The demonstration shell never mounted.

Two distinct defects, and they needed separate fixes.

**1. The demonstration was the production application with fixtures inside it.** `VITE_PUBLIC_DEMO_MODE`
changed what the screens *showed*; it did not change what stood in front of them. `RequireSession`
and `RequireMembership` mounted above the shell either way, so a public demo asked strangers for a
Supabase session and then for a brokerage membership neither of which exists.

The boundary is now a build-time constant, `apps/web/src/demo/mode.ts`, and the route tree branches
on it **above both guards** — they are not relaxed, they are not mounted:

```ts
const authed = createRoute({ ..., component: DEMO_MODE ? Outlet : RequireSession });
const member = createRoute({ ..., component: DEMO_MODE ? Outlet : RequireMembership });
```

Production authentication is untouched, and `demo-entry.test.tsx` drives the real route tree in both
modes so it stays that way: every demo destination must render for a visitor with no session, and
`/discover` in production must still land on `/sign-in?next=/discover`.

Three consequences follow, each enforced where it cannot be forgotten:

- **`/me` is never requested in demo mode** (`useMe` is disabled there). A public page must not wait
  on a 401 before it can draw anything.
- **Nothing reaches a service.** `request()` — the single function every API call passes through —
  throws `demo_mode_reaches_nothing` in demo mode. No read, no mutation, no email, no audit row,
  whatever a surface forgets. `AuthProvider` likewise never looks for a session.
- **The demonstration needs no credentials.** With demo mode on, the three production variables
  (`VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`, `VITE_PUBLIC_API_BASE_URL`) default
  to inert `.invalid` placeholders. Requiring them meant a public demo could only be deployed by
  handing it credentials it must not use, and a blank dashboard field failed the build or threw
  before React mounted.

**2. "We could not load your account" was one sentence for five different failures.** It was wrong
for four of them: refreshing does not fix an unreachable service, and signing in again does not
apply a missing migration. The guard now distinguishes, and says who can fix each —

| What happened | What the visitor is told |
|---|---|
| The request never arrived (`api_unreachable`) | The service is not answering this browser: starting up, offline, or reachable only from another address |
| 401 / `invalid_session` | The session is no longer valid; signing in again fixes it |
| 403 / `permission_denied`, `not_a_member` | The session was accepted and the request refused; a brokerage administrator can restore the membership |
| 503 `schema_behind` | The service is running ahead of its database: a migration has not been applied |
| `response_unrecognised` | The page and the service are different builds |
| `profile_missing` | The sign-in exists but its profile record does not |

Supporting changes: a rejected `fetch` is now `api_unreachable` rather than an unhandled `TypeError`
(in a browser this is the same error whether the host is wrong, the service is down, or CORS refused
the response, so the message names all three rather than guessing); a response that fails its Zod
contract is `response_unrecognised` rather than a generic throw; and `mapDatabaseError` maps
Postgres `42P01`, `42703` and `42883` to `schema_behind`. The page still shows a failure class and
never a hostname, a variable or a database message (§45 rule 4); the console gets the whole error,
because whoever administers a deployment has to be able to find out what broke without rebuilding it.

## D-066 — The approved screens read real records

The demonstration proved the design. This connects it to a brokerage's own data: with demo mode
off, Discover, Work, Jobs and Automations are the same screens rendering rows from the database,
through the API, under the caller's session.

**One component per board, two adapters.** The approved demo decides what a card looks like; a card
must not decide where its content comes from. So each board renders a typed view model
(`packages/schema/src/views/boards.ts` — `FocusCardView`, `WorkTileView`, `JobCardView`,
`AutomationCardView`), and two adapters produce it: `apps/web/src/live/adapters.ts` from API rows,
`apps/web/src/demo/adapters.ts` from the fixtures. The difference between the demonstration and the
product is one function, not one component per mode — which is also why the parity budgets did not
move when this landed.

A view model holds the words that appear on screen: names, not ids; a label, not an enum. Resolving
happens in the adapter, once, where it is tested — 16 assertions covering exactly the rules that
matter: a card names a client rather than an id, says what the engine said rather than composing
its own explanation, shows progress only where progress was derived, and never turns a finished job
into a business outcome.

**What the API gained, because a card cannot show an id:**

- `GET /work` now carries the `client` and the `period` for each row, resolved server-side under
  the caller's session exactly as Discover already resolved them. The loader they shared is now
  `apps/api/src/attention/record-context.ts`, and it degrades rather than failing: a read that
  errors adds a line to `degraded` and the board says what it could not see.
- `GET /work` also carries `counts` for every view, computed in the same pass. Five numbers, one
  request, and a count that cannot disagree with the list under it.
- **`GET /runs` is new** — the Jobs board had no list endpoint at all. It groups by what each run is
  waiting on (Running, Waiting externally, Work, Completed), counts every tab in one pass, and
  derives progress from the steps of the work each run is advancing. Progress is `null` where there
  are no steps to derive it from, and the card then shows no bar rather than inventing a number
  nobody measured (§45 rule 10). A finished job stays an output: nothing in the response says a
  policy renewed, a claim was accepted or money arrived.
- `POST /automations`'s request shape moved into `@asap/schema`, so the builder in the browser and
  the handler on the server cannot drift. It still does not carry `sends_externally`: the server
  reads that from the verb, because a browser that could set it false would be a way around §45
  rule 13.

**The sidebar counts read the same queries the boards read**, so the number beside Work and the
list behind it come from one answer.

**Two defects this found**, both in territory the test suites could not reach until the product was
actually run against a database:

- `anon` held EXECUTE on `app.touch_conversation()` — a SECURITY DEFINER trigger function created
  in 0032 without revoking the default PUBLIC grant. Migration **0037** revokes it. What it does is
  small, but a definer function callable by an anonymous caller is a hole regardless: the caller's
  own permissions are not what decides.
- Two assertions in the pgTAP membership suite ran inside a signed-in RLS context while asserting
  facts about the whole seed, so they were counting rows RLS had already hidden. They now reset the
  role first. With both fixed, all **395** isolation assertions pass against a real database.

**How it is verified:** `apps/web/parity/live-wiring.mjs` drives a production-mode build against the
real API over a real, migrated, seeded PostgreSQL, and fails if any screen shows a failure state,
if the presenter bar appears in a live build, or if a fictional fixture name reaches the screen.
`docs/audit/live-wiring/` holds the screenshots and states plainly what that harness does **not**
prove: RLS (proven by `pnpm test:rls`) and Supabase Auth (proven by `scripts/verify-live.sh`).

**Not yet on real records, and still fixture-backed in both modes:** Search, `+ New`, the email
thread and draft, the document viewer and extraction review, and the Work/Job/Automation detail
screens. Those are named in the outstanding list rather than quietly left half-wired.

## D-068 — The first run: a new brokerage, from signing up

The product was built from the middle outwards, so the beginning was the least travelled part of
it. This is the path a brokerage that has never used ASAP actually takes, and what it found.

**Forgetting a password had no path at all.** `/forgot-password` asks for a link and
`/reset-password` chooses the new one. Both hold the same rule, and it is the one that is easy to
break by being helpful: **the answer never depends on whether the address has an account.** "If that
address has an account, a link is on its way" is the same sentence either way, so the form cannot be
used to ask who banks with this brokerage — the same reason sign-in says "that email and password do
not match" rather than naming which half was wrong. The reset screen requires the recovery session
the link creates and says the link has expired when there is none, rather than showing a form that
could not work.

**"Nothing needs attention" and "you have not started" are different facts.** A brand-new brokerage
was being congratulated on being up to date. `GET /attention` now carries `book` — how many
clients, policies and work items exist at all, counted under the caller's session — and Discover
says "Nothing is on file yet" with the first step, instead of "Nothing needs attention". An empty
screen that implies everything is handled, when nothing has been entered, is a lie of omission.

**What the first run proved, against a real database:** a person who has just signed up has a
profile (the 0004 trigger makes it) and no membership, and is offered create-or-join rather than an
empty Discover. Creating the brokerage seeds its nine system roles and makes them its owner. Every
screen then loads with no failure state and nothing fictional on it.
`apps/web/parity/onboarding.mjs` walks exactly that, and fails if any screen is blank, shows a
failure state, or shows a demonstration record.

**Still missing on the first-run path**, and named rather than left to be discovered: adding a
policy has no endpoint at all; adding a client has one but no entry point from `+ New`; and
connecting a mailbox and uploading a document have working APIs behind fixture-only screens.

## D-069 — Evidence arrives without typing: documents and the mailbox

Two surfaces that had working APIs behind fixture-only screens, and one that had no API at all.

**Documents are real.** The screen lists the brokerage's own files and files a new one in three
moves the browser makes itself: hash the bytes, ask the API where it may go, then PUT the bytes
straight to storage. The bytes never pass through the API, and the server allocates the path inside
the brokerage's own prefix — a path the browser chose could name another brokerage's folder. The
same file twice is recognised, not filed twice, and the screen says so.

**The mailbox had provider adapters and no HTTP surface at all** — no connect, no list, no
disconnect. `GET /mailboxes`, `POST /mailboxes/connect` and `DELETE /mailboxes/:id` exist now, and
they hold two rules:

- **A response never carries a token.** The encrypted access and refresh tokens live server-side
  only, and no response shape here has anywhere to put one; a test asserts the serialised body
  contains no token in any shape or key.
- **A deployment without OAuth credentials says so, in words.** "This deployment has no Google
  credentials yet. Whoever administers it can add them" — not a dead button, not a page that
  cannot work, and never the variable names (§45 rule 4).

Disconnecting keeps the row — a mailbox that once fed this brokerage is part of its history — and
clears what could read or send with it.

**Still to do on this path:** the OAuth callback that exchanges the code for tokens and stores them
encrypted. Until it exists, a deployment that *has* credentials can send a person to authorise and
cannot yet finish. That is stated on the screen rather than discovered.

## D-069 — The demonstration is removed; there is one application, and it is the brokerage's own

**2026-09-11.** D-065 built the public demonstration as a second application branched above the
authentication guards. It did what it was for. It is now gone.

Why: the deployed site ran `VITE_PUBLIC_DEMO_MODE=on`, so what a real user opened was the
demonstration — the fictional brokerage, its eight work items, its answers with no model behind
them. The product looked finished and did nothing. There is no way to have both a sales demo and a
working product at one URL without one of them lying about the other.

**What was deleted:** `packages/schema/src/demo/` (the fixtures), `apps/web/src/demo/` (mode, state,
adapters, the presenter bar, the boundary notice), the `NewThing` page, the `VITE_PUBLIC_DEMO_MODE`
variable from `publicEnvSchema` and from `render.yaml`, every `isDemo` branch in every page, and
the visual-parity harnesses that drove the fixture build (`capture.mjs`, `check.mjs`, `diff.mjs`,
`regions.mjs`, `demo-entry.mjs`).

**What was kept:** the approved visual language. `styles/demo.css` is now `styles/shell.css` and is
still the design authority — D-064 stands, and the real screens wear it.

**The guards are unconditional again.** `RequireSession` and `RequireMembership` mount for every
destination, with no branch above them and nothing to turn them off.
`apps/web/src/routing/auth-entry.test.tsx` replaces the demo-entry suite: it drives the real route
tree and fails if any destination becomes reachable without signing in.

**Five screens stopped being fixtures and became real**, which needed four endpoints that did not
exist:

| Screen | Was | Now | Endpoint |
|---|---|---|---|
| Ask ASAP | 32 scripted scenarios | real turns, real citations, abstention shown as abstention | `POST /ask` (existed) |
| Audit history | session events in memory | the brokerage's `audit_log`, denials and failures included | **`GET /audit`** (new) |
| Search | a fixture list | clients, policies and work, by lookup under RLS | **`GET /search`** (new) |
| Email | a fictional thread and a simulated send | the connected mailbox's own threads, read-only | **`GET /email/threads`**, **`GET /email/threads/:id`** (new) |
| Job detail | fixture steps | the engine's own run, through `RunDetail` | `GET /runs/:id` (existed) |
| Document viewer | a drawn page | the filed bytes, and extraction review on real fields | `GET /documents/:id` (existed) |

Search is a lookup, never a vector search: "what is policy P-4471?" is an exact question (§45
rule 7). Email is read-only here — a message leaves ASAP only through an approved draft on the
record it belongs to, with the provider's own message id recorded against it.

**What this costs:** there is no longer a public URL that shows the product working without a
brokerage's data in it. A demonstration now means seeding a real brokerage on a real deployment.
That is the honest version, and it is what a new client actually sees on their first day (D-068).

## D-070 — Phase 2: the book goes in, and Ask answers

**2026-09-11.** Two gaps closed from `docs/PLAN-NEXT.md`, in the order that unblocked the most.

### Ask answers, through either provider

The gateway was designed for two adapters and had one. `apps/api/src/ai/providers/anthropic.ts`
is the sibling, and adding it moved nothing above the gateway — which was the point of §45 rule 3.
Raw HTTP, matching the OpenAI adapter and for the reason already recorded there.

Three things this API demands that the other does not, each now with a test that fails if it
regresses: the key goes in `x-api-key` with a pinned `anthropic-version`; a tool is declared flat
rather than wrapped in a function; and a tool result is a **user** turn carrying `tool_result`
blocks — with every result of one parallel round in a *single* turn, because splitting them teaches
the model to stop asking for tools in parallel and costs a round trip per tool thereafter.

`thinking` is deliberately not sent: on current models it is on by default, the depth is the
model's to choose, and this adapter does not get to assume which model `AI_MODEL` names.

**Still required:** a key on the API service. `AI_DEFAULT_PROVIDER=anthropic`, `AI_MODEL`, and
`ANTHROPIC_API_KEY`. Without them the gateway is absent rather than broken and Ask says so.

### A brokerage's existing book

The rule that shaped all of it: **an import is not a second way in.** It creates clients through
`client_create` and policies through `policy_create` — the same functions `+ New` calls — so the
duplicate check, the membership check, the API-caller gate and the audit row are the same ones.
There is no quieter path that skips them because it is doing a hundred records instead of one.

Two steps, deliberately. A preview stores its decision per row; the commit writes exactly that and
never re-reads the file. Re-reading would mean the file could have been edited, a name could
resolve differently, or a client could have been created in between — and a person would have
approved something other than what happened.

**New tables** (0039, 0040): `client_contacts`, `import_batches`, `import_rows`, and premium and
commission on `policy_periods`. `client_contacts` is a table rather than columns because a
corporate client has several people — the finance contact who receives invoices and the operations
contact who reports claims are routinely different — and one primary is enforced by a partial
unique index rather than remembered in code.

**What is never inferred:**

- **The premium's basis.** A brokerage's "premium" column is either gross or the total payable;
  they differ by the statutory levies and cannot be told apart from the numbers. It is asked once
  per file, and a file with premiums cannot be committed until it is answered.
- **Commission.** Rate and amount are independent and both nullable. Given levies, neither can be
  safely derived from the other, so whichever the file did not give stays missing.
- **An ambiguous date.** 03/04/2026 is April in Nairobi and March elsewhere. It is refused with a
  request for ISO rather than resolved — a policy that expires on the wrong one of those is a
  repudiated claim.

**Three defects found by importing a real book rather than a fixture**, each of which the unit
tests had passed over:

1. **A column called "Commission" holding "12.5%".** The synonym table mapped it to an amount, so
   a 12.5% rate would have been recorded as twelve and a half shillings — silently. A percent sign
   now settles it whatever the heading said; the heading decides only when the value does not.
2. **No premium was recorded at all.** `authenticated` has no update grant on `policy_periods` and
   never should, so the direct update failed on every row while the clients and policies landed.
   Migration 0041 adds `policy_period_record_premium`, gated and audited like every other engine
   write.
3. **Every failure said "This row could not be written."** A Supabase error is a plain object, not
   an `Error`, so `instanceof` discarded every message. What the database refused is the only
   useful thing there, and it now reaches the person who has to fix the file.

**The cap is 2,000 rows**, because the worker tier does not exist yet (Phase 3). The screen states
it; a larger book is split. This is the one place where the honest answer today is a limit rather
than a queue.

**Verified against a real database, not only a stand-in:** a six-row book with two deliberately
broken rows imported to three clients, three contacts, four policies and four periods, with
12.5% stored as `0.1250`, individuals told from companies, insurers created by name once, the two
bad rows excluded with their reasons, an audit row naming what the import did, and the same file
refused on a second attempt.

## D-071 — One layout for every screen, and a book in whatever form it is in

**2026-09-11.**

### Every screen sits in the same frame

Eight screens — Search, the audit history, Email, the client file, client files, Members and both
agreement screens — were laid out as bare flex columns inside `.product-view`, which supplies
neither padding nor a scroll container. Their content sat flush against the sidebar and ran off the
right-hand edge.

`apps/web/src/shell/Page.tsx` is now the frame for every destination: the 58px topbar, the gutters,
the scroll. The rule that actually stops the overflow is `min-width: 0` on the body — the shell's
main column is `1fr`, which resolves to `minmax(auto, 1fr)`, so a child wider than the column grows
the column rather than scrolling inside it, and the sidebar and every top-right control move with
it.

Two other defects in the same family:

- **`.evidence-list` was used on Ask and the import screen and defined nowhere**, so the evidence
  panel rendered as unstyled text running off both edges of its card. It exists now, along with
  `.audit-list`, `.thread-list`, `.search-box` and `.page-table` — the idioms those screens were
  reaching for with Tailwind utilities.
- **Ask's workspace could not shrink.** Its columns are `minmax(450px, 1fr) minmax(410px, 47%)`, an
  860px floor, so below that it pushed the whole shell sideways. It stacks under 900px now: mobile
  is a first-class layout (§37), not a squeeze.

**Not done, and worth naming:** `Files`, `Members`, `Agreements` and `AgreementVersion` are framed
but their interiors still use the Phase-1 `@asap/ui` components, whose tokens differ from the
approved language. They now *sit* in the product; they do not yet *read* as part of it.

### A book arrives in whatever form the brokerage has it

CSV only was the wrong constraint: a book is a spreadsheet far more often, and sometimes a PDF
printed out of the system it is leaving.

| It arrives as | What happens |
|---|---|
| `.csv` / `.tsv` | As before. |
| `.xlsx` / `.xlsm` / `.xls` | The first sheet that has a table on it, **named on the screen** rather than assumed. |
| `.pdf` with a text layer | The printed table, read from where the words sit. |
| `.pdf` that is a scan | Refused in words, and pointed at Documents — reading a scan is extraction, not import. |
| Anything else | Refused in words, and pointed at Documents. |

The browser now sends bytes, not text, so every kind of file reaches the same validation and the
browser is never the thing that decided what a cell meant.

**The PDF reader works from geometry, and has to.** A PDF has no columns — it has glyphs at
coordinates, and the text layer a reader produces collapses the gaps between them to single spaces.
Splitting *that* turns "Malindi Salt Ltd" into three columns and puts every later value one field
to the left, silently. So runs are grouped into lines by their y, the first line with three or more
runs is the header, its x positions define the columns, and every later run joins the column whose
heading starts nearest to its left. A line reaching fewer than half the columns is a footer or a
total, and is skipped.

### The model maps headings — and only headings

The synonym table cannot cover "Sum Ins.", "U/W" or "Cover From", and a brokerage should not have
to rename its columns to get its own book in. So where a heading is unrecognised, the configured
model is asked what it means.

**It is given the column names and nothing else.** It never sees a value, never chooses one and
never produces one. Its answer is checked against the enum before it is used, it cannot claim a
meaning the synonyms already took, it cannot map two headings to one meaning, and what it decided
is shown on the preview for a person to correct before anything is written. A heading it gets wrong
is visible and reversible; a value it invented would be neither (§45 rules 8 and 9).

With no model configured it falls back to the synonyms. An import does not fail for want of a
model, and a model that is slow, unreachable or unhelpful cannot stop a brokerage importing its
book.

### Dependencies, chosen on their advisories

`read-excel-file` (0 advisories, 20 packages) and `unpdf` (0 advisories, 2 packages). The obvious
choice for spreadsheets, `xlsx`, carries two **high**-severity advisories with no fix available —
prototype pollution and ReDoS — which is not acceptable for parsing files a brokerage uploads.

## D-072 — Phase 3: the worker tier wakes, and documents get read

**2026-09-11.** Three things that were written and never ran.

### The worker schedules; the API is the engine

`apps/workers` logged `no consumers registered yet` from Phase 1 until now. It runs the event
dispatcher: it claims events nobody has handled, asks the API to run the consumers, and records
what each one did.

The split is deliberate. Workers read tenant data as `asap_worker` under RLS and hold no service
key — their own environment schema says so and refuses one — while what must happen when an event
lands is engine work that already exists, tested, in the API. Implementing it in both places would
be the same rules behind two roles, which is how they drift. So `POST /internal/events/:id/dispatch`
exists: no session, a shared secret only the API and the worker hold, not mounted at all on a
deployment without one, and **the organization comes from the event row, never from the caller.**

**Idempotency is a constraint, not a convention.** `event_deliveries` has `(event_id, consumer)` as
its primary key, so a consumer that already ran for an event cannot run again and a retry cannot
rewrite the first answer. That is what makes the loop safe to crash and restart, and it is tested
against a real database — a stand-in that accepted every insert would pass while the real thing let
a consumer run twice.

A failed consumer leaves the event unprocessed with `last_error` set; after five attempts it stops
being served, still unprocessed and still carrying its error. An event that quietly became
"processed" after failing is what §45 rule 15 forbids.

### Two things running it for real turned up

1. **Nothing ever learned an upload finished.** The browser PUTs bytes straight to storage; the API
   never sees the transfer. So the file sat in the bucket with nothing waiting on it, and "ASAP
   reads it next" — which the upload screen says — was untrue. `POST /documents/:id/filed` is that
   signal: it checks the object is really in the bucket rather than taking the browser's word,
   queues the document, and emits `document.received`.
2. **The dispatcher saw nothing at all.** `events` is a tenant table whose policy scopes every read
   to one organization, and claiming spans tenants — so against a real database it read zero rows,
   silently, and would have looked busy forever. The wrong fixes were a service key for the worker
   or a relaxed policy. Migration 0042 is the narrow one: `app.claim_pending_events`, granted to
   `asap_worker` alone, returning that an event exists, whose it is, and how often it has been
   tried — **never its payload**, which is the brokerage's own data the worker does not need.
   `supabase/tests/0316` proves `authenticated` and `anon` cannot call it.

### Documents are read, and every value is proposed

`apps/extractor` was a placeholder with a queue consumer that did nothing. It now serves
`POST /extract` with PyMuPDF: pages with their text and dimensions, and the values a schedule
labels, each with the rectangle it was read from.

**Nothing it returns is known.** A labelled value is `known`, a document that says the same thing
twice and differently yields `conflicting` **with both readings kept**, and a field the document
never gave is proposed as `missing` rather than left out — so the review screen shows the absence
instead of leaving a person to notice it. Picking a winner between two policy numbers would hide
the exact thing a person needs to see. Every field is written `state = 'proposed'`; a person
accepts or corrects each one (§45 rule 8).

Documents never leave our own infrastructure (§45 rule 2): PyMuPDF reads the bytes in that process
and nothing there calls out. A document already read is left alone, so a redelivered event cannot
replace a person's accepted values with fresh guesses.

### What is still not true

- **`renewal.approaching` and `check.overdue` cannot fire.** They are time-based and need a
  scheduled sweep, which does not exist. `payment.received` cannot fire either: there is no money
  model to observe (D-070 defers it).
- **The full upload → extraction path is proven in layers, not end to end.** The Python service
  against a real PDF, the consumer against a stand-in, the dispatcher against real Postgres, and
  the worker against the real API — but not all four at once, because the local stand-in has no
  storage download.
- `pnpm test` does not run the Python tests; `pnpm test:extractor` does.
