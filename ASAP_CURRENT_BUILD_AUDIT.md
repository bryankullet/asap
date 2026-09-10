# ASAP — Current Build Audit

Date: 2026-09-10
Commit audited: `6fcb5a8` on `main`
Author of this audit: Claude Code, read-only pass. Nothing in the product was redesigned, refactored, deleted or modified for it.

## How this audit was produced, and what that limits

Confirmed facts in this document come from one of four sources, and each finding says which:

1. **Read** — the file is in the repository at the path given.
2. **Ran** — the command ran in this container and the output is quoted.
3. **Clicked** — the real React bundle was driven in Chromium against the real API process, and the screenshot is in `docs/audit/screenshots/`.
4. **Hosted** — a query ran against the hosted Supabase project.

Everything else is labelled **Assumption**.

**The honest limitation.** This container has no Supabase service keys and no local Postgres. So the real API binary was booted against a **stub** that speaks the subset of PostgREST and Supabase Auth that the API uses, serving rows copied out of the hosted database. That means:

- The browser path was exercised end to end against real API code and the real bundle, but **row-level security was not exercised in the browser path**. RLS is proven separately by pgTAP against hosted (results in section 8).
- No engine write RPC (`work_item_act` and friends) was simulated, so **write paths were tested only as far as the API's own validation and guard checks**, which is where several findings below land.
- The deployed Render services were unreachable from this container (egress blocked), so nothing here is a statement about the live deployment beyond what the repository and hosted database say.
- Several problems I hit during testing were **bugs in my own stub**, not the product. They are excluded from the defect lists and named in section 8 so nobody re-discovers them as product faults.

**A note on the API key.** An Anthropic API key was pasted into the working session to "speed this up". It was not used, not written to any file, and not sent anywhere. It is also not needed: as section 1 shows, this codebase has **no AI provider integration of any kind**, so there is nothing for a key to enable. Because it appeared in plain text, treat it as compromised and rotate it.

---

## 1. Current architecture

### Frontend

**Confirmed (read).** React 19 + TypeScript (strict) + Vite 7, Tailwind v4 via `@theme`, TanStack Router (flat route tree with pathless layout routes), TanStack Query for all server state, React Hook Form + Zod for forms, `supabase-js` for the reads that must be RLS-scoped.

```
apps/web/src/
├── main.tsx, router.tsx        app boot, flat route tree
├── shell/Shell.tsx             the permanent frame (sidebar, Ask dock, Activity chip)
├── pages/                      one file per route: Today, Work, Record, Files, FileDetail,
│                               Agreements, Members, Automations, AutomationDetail,
│                               SignIn, SignUp, Invite, CreateOrganization, NotFound
├── views/                      composition, not routing: RecordViews, FocusCard,
│                               RecordFooter, ActionPanel, ClaimPanel, EndorsementPanel,
│                               WorkList, TodayList
├── lib/                        api client, guards, supabase client, query keys, formatting
└── *.test.tsx                  vitest + Testing Library, colocated
packages/ui/                    design tokens (styles.css) + primitives
packages/schema/                every boundary shape, in Zod, once
```

`packages/ui/src/styles.css` is the single source for colour, radius and shadow. No other file declares one.

### Backend

**Confirmed (read + ran).** One service: `apps/api`, Hono 4 on Node via `@hono/node-server`. There is no second backend.

Routes (each a file in `apps/api/src/routes/`): `health`, `me`, `organizations`, `invitations`, `members`, `clients`, `client-files`, `agreements`, `work-items`, `today`, `ask`, `runs`, `automations`.

Cross-cutting middleware: `secureHeaders()`, exact-origin CORS derived from `WEB_BASE_URL`, a bearer-token auth middleware that calls a live `auth.getUser()` on every request, and a per-request context resolver that produces organization, role and permissions **server-side** from the session. The frontend cannot supply any of the three.

Two other apps exist in the repository and are **skeletons with no consumers**: `apps/workers` (a Node queue consumer that logs and exits) and `apps/extractor` (a Python service that logs and exits). Confirmed by reading both entry points: neither reads a queue, and nothing enqueues to them.

### Database

**Confirmed (read + hosted).** Supabase Postgres, 30 append-only migrations in `supabase/migrations/`, RLS on every table in `public`.

Tenant tables (all carry `organization_id` and a policy): `clients`, `client_files`, `client_file_items`, `policies`, `policy_periods`, `placements`, `claims`, `claim_events`, `endorsements`, `work_items`, `work_item_steps`, `runs`, `run_steps`, `agreements`, `agreement_versions`, `company_rules`, `audit_log`, `events`, `event_deliveries`, `teams`, `user_team_memberships`, `automations`, `automation_runs`, `documents_placeholder`.

Platform tables: `organizations`, `users`, `memberships`, `invitations`, `api_keys`.

Access control: every tenant policy is `using (app.can_access(organization_id))`, granted `to authenticated, asap_worker`. `anon` evaluates nothing. Writes that the engine performs go through SECURITY DEFINER functions gated by `app.require_api_caller()`, which checks a hashed `x-asap-api-key`.

**Confirmed unused (read):** `teams`, `user_team_memberships` and `event_deliveries` have tables, grants and policies, but no application code reads or writes them. `documents_placeholder` is what its name says.

### Authentication

**Confirmed (ran).** Supabase Auth, email + password. The browser holds a session in `localStorage` via `supabase-js`; every API call sends `Authorization: Bearer <access token>`; the API validates it with a live `auth.getUser()` — not by decoding the JWT locally. `/me` returned 401 with no bearer and 200 with one.

Invitations are token rows in `invitations`, accepted at `/invite/:token`. Invitation and auth links are built from `WEB_BASE_URL`, not localhost (confirmed by reading `apps/api/src/lib/links.ts` and the invitation mail body).

### File and document storage

**Missing.** No Supabase Storage bucket is created by any migration, no upload control exists in the UI, and no API route accepts a file body. The "client file" feature is a **checklist of required items**, not document storage: `client_file_items` records whether an item is present, with no bytes behind it. There is no `documents` table, no chunking, no extraction.

### Email connections

**Partly present.** Outbound transactional mail only, via Resend, and only when configured: `apps/api/src/lib/mailer.ts` falls back to a `LogMailer` that writes the message to the structured log. `/health` in this container reported `"mailer":"disabled"`.

**Missing:** Gmail OAuth, Microsoft 365 OAuth, any mailbox ingestion, any inbound parsing, any prepared-email review surface. There is no "connect email" screen.

### OpenAI or other AI connections

**Missing, entirely.** This is the single largest gap and it is worth stating plainly.

- No `openai`, `@anthropic-ai/*`, or any other model SDK appears in any `package.json` in the workspace (confirmed by reading all of them).
- The only third-party `fetch` in the whole API is `https://api.resend.com/emails`.
- There is no AI gateway, no intent router beyond keyword matching, no prompt file, no model configuration, no evaluation harness wired to anything.
- `component_definitions`, the UI-plan validator and the generative renderer described in the architecture do not exist in code.

So: **no part of the product is AI-powered today.** Nothing is mocked to look AI-powered either, which is the better of the two failure modes — there is no fake confidence anywhere.

### Search and RAG setup

**Confirmed (ran).** `pgvector` is installed by migration 0001. **No table, column or index uses it.** There are no documents, chunks or embeddings tables, so there is no retrieval layer at all.

What "search" actually is: `GET /ask?q=` runs a case-insensitive `ilike` against **`work_items.title` only**. Nothing else is searched — not clients, not policies, not claims, not documents. The sidebar's "Search" item is a link to `/work?view=recent`, not a search surface.

### Automations and background jobs

**Partly present.** `automations` and `automation_runs` tables exist, `/automations` lists them and a detail page shows a run history. The runs themselves are **deterministic scripts in the API** with no model involvement, which matches the rule that the model may not author progress. Run streaming over SSE works, and there is boot-token run recovery (`/health` reported `"no orphaned runs"`).

**Missing:** Supabase Queues are not used, `apps/workers` consumes nothing, there is no scheduler, and no automation can be created or edited from the UI.

### Environment variables required

Names only, no values.

API: `PORT`, `APP_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ASAP_API_KEY`, `WEB_BASE_URL`, `RESEND_API_KEY` (optional), `MAIL_FROM` (optional), `COMMIT_SHA` (optional).

Web (build time): `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`, `VITE_PUBLIC_API_BASE_URL`.

Seed tooling: `SEED_PASSWORD` (optional, 12-char minimum), `APP_ENV` (the password seeder refuses to run when it is `production`, and refuses an unset or unknown value).

`pnpm lint` includes a `secret-scan` step; it reported `ok (296 files)`.

### How the frontend talks to the backend

Two channels, deliberately:

1. **`supabase-js` direct reads** for list and record data, so RLS applies in the user's own security context.
2. **The Hono API** for anything that needs server-resolved role, a guard evaluation, a write, or a run stream.

`packages/schema` defines every shape crossing that boundary once in Zod; the API validates against it and the web app parses against it.

---

## 2. Every current screen

Status words below mean: **Working** (clicked, did what it says), **Partly** (works with a named defect), **Mocked** (renders but nothing behind it), **Broken** (fails), **Missing** (does not exist).

| Screen | Route / file | Purpose | Reached by | Shows | Buttons and what they do | Backend | Status |
|---|---|---|---|---|---|---|---|
| Sign in | `/sign-in` · `pages/SignIn.tsx` | Password sign-in | Default for a signed-out visitor; guards redirect here with `?next=` | Email, password, link to sign up | **Sign in** → Supabase password grant, then to `next` or `/today`. **Create an account** → `/sign-up` | Supabase Auth | Working |
| Sign up | `/sign-up` · `pages/SignUp.tsx` | Create an account | Link from sign-in | Email, password | **Create account** → sign-up then guard sends to create-brokerage | Supabase Auth | Working |
| Accept invitation | `/invite/:token` · `pages/Invite.tsx` | Join a brokerage | Emailed link | The invited brokerage and role, or an error | **Accept** → `POST /invitations/:token/accept` | API | Partly — accept path works; a bad token renders a plain error with no route out (screenshot 27) |
| Create brokerage | `/onboarding` · `pages/CreateOrganization.tsx` | First brokerage | Guard, when you have zero memberships | Name field | **Create brokerage** → `app.create_organization` with a client-generated idempotency key, then navigates to `/today`; disabled while submitting | RPC | Working (this was a double-create defect; fixed at the database in migration 0029, tested) |
| Choose brokerage | `lib/guards.tsx` (`ChooseBrokerage`) | Pick among memberships | Guard, when you have more than one | One button per brokerage | Each → `set_active_organization`, then `/today` | RPC | Working |
| Today | `/today` · `pages/Today.tsx` | The ranked day | Sidebar, and after sign-in | Ranked cards, each with a status word and a "Why is this here?" reason | Card → the record. **Why is this here?** → reveals the reason | `GET /today` | Working (5 cards for Amina, matching `docs/click-through.md`) |
| Work | `/work` · `pages/Work.tsx` | The full queue, four views | Sidebar | Needs you / With others / Done / Recent | The four view tabs; each row → the record | `supabase-js` + `GET /clients?view=` | Working |
| Record page | `/work/$id` · `pages/Record.tsx` | One record, composed by kind | Any card or row | Focus card, then per-kind panels, step list, run history, footer | **Primary action** (per step) → `POST /work-items/:id/act`. **Why here?** → the reason. Panel forms per kind | API + RPC | **Partly — two confirmed defects, below** |
| Policy view | `/work/$id` (policy branch) | A policy and its periods | A policy row | Periods, dates, insurer | Read-only | `supabase-js` fallback | Partly — always logs a `404 GET /work-items/{policyId}` before the fallback succeeds |
| Client files | `/files` · `pages/Files.tsx` | Which client files are incomplete | Sidebar → profile menu | Client, state, missing count | Row → file detail | `GET /clients?view=blocking` | Working |
| Client file detail | `/files/$clientId` · `pages/FileDetail.tsx` | The item checklist | From the list, or from a blocked gate | Each required item and its state | **Mark present** per item. **Clear this file** → disabled until input is typed (correct) | API | Working |
| Agreements | `/agreements` · `pages/Agreements.tsx` | Commission agreements | Profile menu | Agreement rows with status | Row → version history | `supabase-js` | Working |
| Agreement version | `/agreements/$id` | One version's terms | From the list | Rate, clause reference, effective from | Read-only | `supabase-js` | Working |
| Members | `/members` · `pages/Members.tsx` | Who is in the brokerage | Profile menu | Name, role, status | **Invite** → `POST /invitations` (sends via Resend when configured, otherwise logs) | API | Partly — the invitation is created and mailed, but there is no resend, revoke or role-change control |
| Automations | `/automations` · `pages/Automations.tsx` | What runs by itself | Sidebar | Automation rows | Row → detail | `supabase-js` | Partly — read-only; nothing can be created, edited, enabled or disabled |
| Automation detail | `/automations/$id` | Run history | From the list | Runs and their outcomes | Read-only | `supabase-js` | Partly — same |
| Ask dock | `shell/Shell.tsx` | Ask a question | Fixed at the bottom of every signed-in screen | The answer: a work list, or a record it opened | **Ask** → `GET /ask?q=` | API | Partly — see section 4 |
| Activity chip | `shell/Shell.tsx` | AI/automation runs | Top of the shell | A count of recent runs | Opens the run list | `supabase-js` | **Broken — reported `chip count: 0` with three runs present, two of them failures** |
| Profile control | `shell/Shell.tsx` | Brokerage + user, and the rest of the app | Sidebar bottom | Brokerage, user, menu | Menu: Members, Agreements, Client files, brokerage switcher, Sign out | RPC + Auth | Working |
| + New | `shell/Shell.tsx` | Create something | Sidebar | — | **Nothing. It is a non-interactive `<span>`** titled "Creating records arrives with import in a later phase" | none | Mocked (honestly labelled) |
| Search | `shell/Shell.tsx` | — | Sidebar | — | A link to `/work?view=recent` | none | Mocked — it is not search |
| History (record footer) | `views/RecordFooter.tsx` | Prior outcomes | Record page | — | A non-interactive `<span>` naming rule C05 | none | Mocked |
| Activity (record footer) | `views/RecordFooter.tsx` | Jump to the run list | Record page | — | `<a href="#record-activity">` — **the target does not exist in the DOM; `does #record-activity exist? false`** | none | **Broken** |
| Not found | any unmatched path | — | A bad URL | A message and a link home | **Back to Today** | none | Working |

**Screens that do not exist at all:** imports and duplicate resolution, email connection, settings, document upload or viewer, extraction review, quote comparison, TOR, money/premium/commission, reconciliation, reports, team management, prepared-email review, any modal, any drawer, and any generated workspace. `packages/ui/src/components/overlay.tsx` exports Modal, Drawer and Toast; **no screen imports them** (confirmed by grep).

### The two confirmed record-page defects

1. **A claim cannot be registered from the UI.** The "Policy period" select renders with only `Choose…` in it, and `ActionPanel`'s `periodId` state is never put into the mutation payload — even though `actRequestSchema` declares `policyPeriodId` (`packages/schema/src/api/work.ts:96`) and `apps/api/src/engine/apply.ts:154` requires it. Clicked result: `409 Not yet: Confirm the policy period this incident falls in.` The guard is doing its job; the form cannot satisfy it.
2. **The servicing panel renders after the record footer.** Proved by reading DOM order: `H2:Every step`, `H2:What ASAP did`, `FOOTER:Evidence on record / Activity / History`, *then* `H2:Claim`, `H2:Notification clock`, `H2:Documents`, `H2:Settlement — three facts`, `H2:Our call notes`. Cause: `pages/Record.tsx` renders `{servicing}` after `</WorkItemView>` and never passes `aside`.

---

## 3. Complete user flows

Each flow was attempted. "Stops at" is where it actually stopped, not where I expect it would.

| # | Flow | Result | Stops at |
|---|---|---|---|
| 1 | New user signs up and reaches Today | **Works** | Nowhere. Sign up → guard → create brokerage → `/today` with an empty state. A seeded user with one membership has it selected automatically (`routes/me.ts`); with several, the chooser opens; with none, create-brokerage. All three counts are tested. |
| 2 | Adds one client | **Missing** | Immediately. There is no create-client screen, and `+ New` is a dead `<span>`. Clients exist only from the seed. |
| 3 | Imports clients and policies in bulk | **Missing** | Immediately. No import screen, no upload endpoint, no duplicate-resolution UI. |
| 4 | Connects email | **Missing** | Immediately. No screen, no OAuth route, no mailbox tables. |
| 5 | Asks "Renew Acme" | **Partly** | The ask returns a work list of 4 matches on `Acme` — but only because "Acme" appears in `work_items.title`. It is an `ilike` on titles, not renewal intent. "Renew" contributes nothing. |
| 6 | Asks about a claim | **Partly** | `?q=Jane` resolved to `open_record` and opened Jane's record. Correct outcome, keyword luck: a claim question phrased without a matching title word returns nothing. |
| 7 | Compares quotations | **Missing** | Immediately. No quotes table, no insurer-response tracking, no comparison screen. |
| 8 | Prepares placement | **Works, including the gate** | Reaches the end. Approve on a client with an incomplete file returns `409 Not yet: We cannot instruct cover for a client whose file is not complete. The file is not started. Open the client's file at /files/…`, with the principal-officer override form present for Amina. **One deviation from `docs/click-through.md` step 5:** the gate notice appears only after submitting the evidence form, not on pressing Approve. |
| 9 | Opens a policy | **Partly** | Renders correctly, but always after a failed `404 GET /work-items/{policyId}`. Wasted request, logged error, works by fallback. |
| 10 | Creates a servicing request | **Missing (create)** | Seeded servicing records open and their panels work; nothing can create one. |
| 11 | Prepares TOR | **Missing** | Immediately. No TOR table, field, screen or expiry clock, despite TOR being a named concept in the project's own glossary. |
| 12 | Handles an endorsement | **Partly** | A seeded endorsement opens and its panel renders — below the footer (defect 2). Its action path was not exercised end to end because no write RPC could be simulated here. |
| 13 | Reviews money owed | **Missing** | Immediately. No premium, invoice, commission, levy or WHT tables at all. |
| 14 | Reconciles a payment | **Missing** | Immediately. |
| 15 | Uploads and reviews a document | **Missing** | Immediately. No storage, no upload, no viewer, no extraction review. The client-file checklist is the nearest thing and holds no documents. |
| 16 | Reviews a prepared email | **Partly** | A record's draft panel shows a "Request (draft, you send it)" control, correctly `disabled=true` until text is typed. There is no separate prepared-email review surface, and no send. |
| 17 | Records that an email was sent externally | **Partly** | The same draft control is the only place to record it; there is no explicit "I sent this" action anywhere. |
| 18 | Creates and tests an automation | **Missing (create/test)** | Listing and run history work. Nothing can be created, edited, enabled, disabled or test-run from the UI. |
| 19 | Checks AI activity | **Broken** | The Activity chip shows 0 with three runs present, two of which are failures. Run history *is* visible on a record page, so the data exists and the surface that is supposed to raise it does not. This breaks the rule that failures are never hidden. |
| 20 | Manager reviews team work and reports | **Missing** | Immediately. No reports, no team screen. `teams` and `user_team_memberships` exist in the database and no code touches them. |

Score: 3 of 20 complete, 7 partly, 10 not built.

---

## 4. Ask ASAP, end to end

**How a question is submitted.** The Ask dock is fixed at the bottom of every signed-in screen. Submitting issues `GET /ask?q=<text>` with the bearer token.

**What context is included.** Only the organization, resolved server-side from the session. No conversation history, no current screen, no selected record. Each ask is independent.

**How intent is detected.** `apps/api/src/routes/ask.ts` — one `ilike` against `work_items.title`, scoped to the caller's organization. One match returns `open_record`; several return `work_list`; none returns an empty result. That is the whole router.

**How records and documents are retrieved.** Records: the single `ilike`. Documents: **not at all** — there are none.

**How the response or workspace is chosen.** By match count, as above. There is no workspace generation, no UI plan, no component registry.

**Real AI, hard-coded, or mocked?** **None of the three — absent.** It is a real database query with no model behind it. There is no prompt, no gateway, no model dependency. Verified by reading every `package.json` and grepping every outbound `fetch`.

**Which questions work today.** Only ones whose words appear in a work item's title: `Acme` (4 matches, work list), `Jane` (1 match, opened the record). `?q=` empty correctly returns `400 q is required`.

**What happens when the AI is unavailable.** Not applicable — nothing to be unavailable. When the *query* fails, the dock shows `Request failed (database_error)`. **Defect:** that error is not cleared on the next success, so a stale failure sits beside a fresh answer: `Request failed (database_error). | 4 items match "Acme"`.

**What actions AI can prepare.** None.

**What requires human approval.** Every state change goes through a named `ActionVerb` with server-side `GuardId` evaluation and optimistic concurrency. Guards are evaluated in the API, not the browser.

**Can anything happen without approval?** **No, on the evidence available.** Ask is read-only — it contains no write path. Engine writes run only through SECURITY DEFINER functions gated by `app.require_api_caller()` with a hashed key. Confirmed by pgTAP: every public SECURITY DEFINER function is either gated or explicitly allowlisted. *Assumption:* I could not simulate a write RPC here, so this rests on the code and the pgTAP result rather than on a clicked write.

---

## 5. Backend capability map

| Capability | Frontend exists | Backend exists | Connected end-to-end | Mocked | Missing |
|---|---|---|---|---|---|
| Clients | Read only | Read only | Read only | — | Create, edit, merge |
| Policies | Read only | Read only | Partly (404 then fallback) | — | Create, edit |
| Quotes | — | — | — | — | **All** |
| Claims | Yes | Yes | **No — cannot register from the UI** | — | The period field on the form |
| Renewals | Yes | Yes | Yes | — | — |
| Placement | Yes | Yes | **Yes, gate included** | — | — |
| Servicing | Read + panels | Yes | Partly (panel below footer) | — | Create |
| TOR | — | — | — | — | **All** |
| Endorsements | Yes | Yes | Partly (not write-tested) | — | — |
| Money | — | — | — | — | **All** |
| Reconciliation | — | — | — | — | **All** |
| Documents | Checklist only | Checklist only | Checklist only | — | Storage, upload, viewer, extraction |
| Email | Draft control | Resend outbound | Invitations only | `LogMailer` when unconfigured | Mailbox connect, ingest, send, prepared-email review |
| Search | A link to `/work` | `ilike` on titles | Titles only | — | Real search across records |
| RAG | — | `pgvector` installed, unused | — | — | **All** — no documents, chunks or embeddings |
| Work | Yes | Yes | Yes | — | — |
| Activity | Chip + record runs | Runs + SSE | **Chip broken** | — | — |
| Reports | — | — | — | — | **All** |
| Team | — | Tables only | — | — | All code |
| Automations | Read only | Runs + recovery | Read only | — | Create, edit, enable, test |
| Evidence | Source chip | Evidence columns | Partly | — | Tappable citation to page and highlight |
| Audit history | `<span>` only | Full `audit_log`, RESTRICT FK | **No UI** | — | The history surface |

---

## 6. UI consistency audit

| Rule | Followed? | Where it breaks |
|---|---|---|
| Primary nav is only Today, Work, Automations | **Yes** | Members, Agreements and Client files sit behind the profile control, per C01. |
| + New and Search are universal utilities | **No** | Both are present and both are inert. `+ New` is a `<span>`; `Search` is a link to `/work?view=recent`. |
| Ask ASAP available everywhere | **Yes** | Docked on every signed-in screen. |
| Insurance records are not primary navigation | **Yes** | No `Clients / Policies / Claims` menu tree anywhere. |
| Jobs is not a navigation destination | **Yes** | No Jobs entry. |
| AI runs appear under Activity | **No** | The chip reports 0 with three runs present, two failed. Runs are only findable inside a record. |
| Important human work always appears in Work | **Yes** | Everything actionable is in Work and ranked on Today. |
| External messages never shown as sent when only drafts | **Yes** | The control literally reads "Request (draft, you send it)". |
| Minimal, understandable to a new 20-year-old | **Mostly** | Good: business-language headlines, a "Why is this here?" on every card, plain gate wording. Bad: the record page's "Every step" list is long, and the misplaced servicing panels below the footer read as an unrelated second page. |
| Avoids large tables, too many tabs, unnecessary text | **Mostly** | Work has four views, which is at the edge but defensible. No oversized tables. |
| Existing functionality remains accessible | **No** | Audit history has no surface at all; the footer's Activity link is dead; failed runs are unreachable from the shell. |

---

## 7. Technical problems

**Broken buttons and controls (clicked, confirmed):**
1. Record footer **Activity** — `<a href="#record-activity">` with no such element in the DOM.
2. **Activity chip** — reports 0 with three runs present, two failures.
3. Claim **Register** — cannot succeed; the period never reaches the payload.
4. **+ New** — a non-interactive `<span>`.
5. **History** — a non-interactive `<span>`.
6. Sidebar **Search** — not search.

Correctly disabled, *not* defects: "Request (draft, you send it)" and "Clear this file" both require typed input.

**Dead routes.** None found. Every route in the tree renders, and unmatched paths reach a proper Not-found screen with a way back.

**Missing states.** Loading and empty states are present on Today, Work, Files and Agreements. Gaps: the invitation error state has no route out; the Ask dock keeps a stale error next to a new success; the policy branch has no state for its own 404 because it silently falls back.

**Missing permission checks.** None found in the API. Organization, role and permissions are resolved server-side on every request; the frontend supplies none of them. pgTAP confirms RLS on every public table.

**Security problems.** None found. Bearer tokens are validated live rather than decoded; CORS is exact-origin; `secureHeaders()` is on; engine writes are gated by a hashed key; `audit_log` cannot be deleted out from under a brokerage (migration 0030 changed the FK to `RESTRICT`, with a pgTAP test); `secret-scan` reported `ok (296 files)`; no service-role key reaches the browser. *One thing to watch, not a finding:* the `pgvector` extension is installed and unused, which is surface area with no purpose yet.

**Browser-only data.** Only the Supabase session in `localStorage`. No business data lives in the browser.

**Hard-coded demo data.** None in the product. All fixtures are in `supabase/seed.sql` and in test files.

**Backend functions with no UI:** the whole `audit_log`; `events` and `event_deliveries`; `teams` and `user_team_memberships`; run SSE streaming beyond the record page; automation enable/disable.

**UI controls with no backend:** `+ New`, `History`, `Search`, the record footer's `Activity`.

**Duplicate functionality.** Two overlapping ways to reach a record's runs ("What ASAP did" on the page and the footer's Activity link) and only one of them works. `packages/ui/src/components/overlay.tsx` duplicates nothing yet because nothing uses it.

**Inconsistent names or statuses.** The four status layers are consistent across screens, and slot enforcement throws when a status word renders in the wrong slot. The one inconsistency is structural rather than verbal: the record page's section order does not match `docs/ui-build-spec-v1.md` Part 14, which the servicing defect causes.

**Mobile.** 390×844 was driven. The sidebar becomes a bottom bar and Ask stays reachable. Screenshots 30 and 31 show no horizontal overflow. The record page is long on mobile, which the misplaced servicing panels make worse.

**Console, network, build and test errors.** Console: the policy `404` on every policy open. Network: the same. Build: clean. Tests: all passing (section 8).

---

## 8. Evidence

### Route map

`/sign-in` · `/sign-up` · `/invite/:token` · `/onboarding` · `/today` · `/work` · `/work/$id` · `/files` · `/files/$clientId` · `/agreements` · `/agreements/$id` · `/members` · `/automations` · `/automations/$id` · `*` → Not found. Guarded routes are wrapped in a pathless layout route; the guard navigates from an effect (not from a render-time `Navigate`) after that pattern caused a browser out-of-memory crash.

### Frontend component map

Shell → sidebar (Today, Work, Automations, Ask, Search, + New, profile) + Activity chip + Ask dock.
Pages → one per route, listed in section 2.
Views → `RecordViews` (composes by kind from `RECORD_SECTIONS`), `FocusCard`, `RecordFooter`, `ActionPanel`, `ClaimPanel`, `EndorsementPanel`, `WorkList`, `TodayList`.
`packages/ui` → `card` (quiet/attention/green/dark/focus/clickable), `button` (primary/green/ghost/soft/compact/full and more), `chip`, `badge` (status pill with a leading dot), `notice`, `checklist`, `timeline`, `table`, `overlay` (Modal/Drawer/Toast — **unused**), `layout` (Page/PageHead/SectionTitle/EmptyState).

Deliberately not ported from the v4 prototype: `.progress` and `.confidence`. A progress bar across policy years and a confidence percentage are both banned by the v1 catalogue, Part 1. Recorded in D-056.

### Backend service map

One Hono app. `health` · `me` · `organizations` · `invitations` · `members` · `clients` · `client-files` · `agreements` · `work-items` · `today` · `ask` · `runs` · `automations`. Supporting libraries: auth middleware, context resolver, `mapDatabaseError`, structured logger, mailer (Resend or log), links (from `WEB_BASE_URL`), the engine (`apply.ts`, guards, run scripts).

### Database table summary

30 migrations. 24 tenant tables + 5 platform tables, listed in section 1. Every tenant table: `organization_id not null`, RLS enabled, a policy using `app.can_access()`, granted to `authenticated` and `asap_worker` only. No `economic_state` column exists anywhere, correctly.

### API endpoint summary (ran, with the responses)

```
GET /health   → {"status":"ok","version":"0.1.0","commit":"6fcb5a8ae294"}   mailer "disabled", "no orphaned runs"
GET /me       → 401 without a bearer; 200 with one
GET /ask?q=Acme → work_list, 4 matches
GET /ask?q=Jane → open_record
GET /ask?q=     → 400 "q is required"
GET /clients?view=blocking → 200
GET /agreements            → 200
GET /work-items/:id        → 200
POST /work-items/:id/act (claim register) → 409 "Not yet: Confirm the policy period this incident falls in."
POST /work-items/:id/act (placement approve, incomplete file) → 409 "Not yet: We cannot instruct cover for a client
    whose file is not complete. The file is not started. Open the client's file at /files/70000000-…-00000000000a."
GET /work-items/{policyId} → 404 (then the UI falls back to a direct read and renders)
```

### Screenshots

40 PNGs in `docs/audit/screenshots/` (5.0 MB), desktop 1360×900 and mobile 390×844, covering Today, all four Work views, every record kind, the blocked placement gate before and after, the claim period form, client files and a file detail, agreements and a version, members, automations and a detail, the profile menu open, the Ask dock in five states, the Activity chip, sign-in, sign-up, a bad invitation token, the signed-out redirect, Not-found, and two mobile screens.

### Test results (ran)

```
pnpm typecheck   9/9 tasks pass
pnpm lint        9/9 tasks pass · secret-scan: ok (296 files)
pnpm test        schema 59 · db 2 · workers 2 skipped · api 89 · web 40  — all pass
pgTAP (hosted)   ALL PASS · plan=6 · failed=0
                 RLS on every public table; an organization_id policy on every tenant table;
                 no policy applying to anon; every public SECURITY DEFINER function gated or
                 allowlisted; audit_log FK is RESTRICT; every seeded user has an active brokerage.
```

### My harness's own bugs — not product defects

Listed so nobody re-files them: the stub's `ilike` stripped `*` instead of `%`; the agreements fixture lacked `status`; the users fixture lacked `last_seen_at` (the real column is nullable and the schema is `z.string().nullable()`, so the app is correct); `placementSteps` takes `insurer`, not `insurerName`, which produced a spurious "undefined instructed"; a second stub silently failed to bind because the first still held the port and served stale rows; the `agreed_rate` stub returned the wrong shape; and the API's exact-origin CORS correctly rejected `127.0.0.1` while `WEB_BASE_URL` said `localhost`.

### Confirmed facts vs assumptions

**Confirmed by running or clicking:** every status word in section 2, all six broken controls, all ten missing flows, the absence of any AI dependency, the API responses above, the test and pgTAP results, the DOM order proving the servicing defect, and the mobile layout.

**Assumptions, clearly labelled:** that endorsement *write* actions behave like the placement ones (their code path is shared, but no write RPC could be simulated here); that the deployed Render services behave as the repository says (unreachable from this container); that RLS behaves in the browser path as pgTAP proves it behaves in the database (the browser path here ran against a stub with no RLS); and that Resend delivers when configured (only the `LogMailer` fallback was exercised).

---

## 9. Final gap list

### Fully implemented, frontend to backend

Sign in, sign up, accept an invitation. Create a brokerage (idempotent at the database). Active-brokerage selection for zero, one and many memberships. Today, ranked, with a reason on every card. Work and its four views. The renewal flow. The placement flow **including the client-file gate and the principal-officer override**. Client files and the item checklist. Agreements and version history. Member listing and invitation. Multi-tenancy: RLS on every table, server-resolved role and permissions, a hashed-key gate on every engine write, and an audit log that cannot be deleted with its brokerage.

### Partly implemented

Claims — everything but the period field, which makes registration impossible from the UI. Endorsements and servicing — panels render, but below the footer. Policies — render only after a wasted 404. Ask — a title `ilike`, with a stale error that outlives a success. Activity — data exists, the chip reports 0. Automations — read-only. Email — outbound invitations only. Evidence — a source chip, but no tappable citation. Audit history — complete in the database, absent from the UI. `pgvector`, `teams`, `user_team_memberships`, `event_deliveries`, `documents_placeholder`, and the `overlay` primitives — present and unused.

### Missing

Any AI: gateway, intent routing, prompts, evaluation, the component registry, the UI-plan validator, generated workspaces. Documents: storage, upload, viewer, extraction, chunks, embeddings, retrieval — so RAG in full. Create paths for clients, policies, servicing requests and automations. Import and duplicate resolution. Mailbox connection and ingestion, sending, and the prepared-email review surface. Quotes and quote comparison. TOR. Money: premium, invoices, commission, levies, WHT, reconciliation. Reports. Team management. Settings. Real search. Queues and workers — `apps/workers` and `apps/extractor` are logging skeletons with nothing feeding them.

### Highest-priority fixes — not implemented

Ordered by "a user hits this today" first, then by how much later work it unblocks.

1. **Make the claim period reach the payload** and populate the "Policy period" select. A whole insurance flow is unreachable. `views/ActionPanel.tsx`, with `packages/schema/src/api/work.ts:96` and `apps/api/src/engine/apply.ts:154` as the contract.
2. **Move the servicing panels above the record footer.** `pages/Record.tsx` renders `{servicing}` after `</WorkItemView>` and passes no `aside`; Part 14 of the build spec says where they belong.
3. **Fix the Activity chip's count.** Failed runs currently do not surface anywhere in the shell, which breaks the rule that failures are never hidden.
4. **Give `#record-activity` a target, or drop the footer link.** A dead link on every record page.
5. **Clear the Ask error on the next successful ask.** A stale failure reading beside a fresh answer teaches users to distrust the answer.
6. **Stop requesting `/work-items/{policyId}` for a policy.** Route policies to their own read instead of relying on a 404.
7. **Build the audit-history surface.** The data is complete and correct and has no way in. This is the C05 promise.
8. **Show the placement gate on pressing Approve,** not after submitting the evidence form — `docs/click-through.md` step 5 says the former.
9. **Either implement `+ New`, `Search` and `History`, or remove them.** Three inert controls in the permanent shell.
10. **Decide the AI layer explicitly** — gateway, registry, UI-plan validator — since every remaining phase depends on it and none of it exists.
11. **Decide the document layer explicitly** — storage, extraction, chunks, embeddings — since documents, evidence citations and RAG all wait on it.
12. **Either wire or remove the unused surface:** `pgvector`, `teams`, `user_team_memberships`, `event_deliveries`, `documents_placeholder`, and the `overlay` primitives. Unused tables with policies are the kind of thing a later session forgets is unfinished.

Items 1 to 9 are each small and local. Items 10 and 11 are phase decisions, not fixes. Item 12 is cleanup that should follow those decisions, not precede them.
