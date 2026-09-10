# ASAP — Space foundation report

Date: 2026-09-10
Branch: `claude/awaiting-files-md15v3`
Head: `a35d295`
Five commits, `297fbb7`..`a35d295`. 62 files, +4,566 / −93.

**What was asked and what was done.** Introduce the preferred UI gradually, starting now: reconcile the plans, resolve the generated-UI contract, fix the six confirmed defects, move Today's and Work's intelligence to the backend, build the component registry and its validator, and build the first Renewal Space behind a flag. All of that is done. Nothing beyond it was started: no TOR, no certificates, no money, no documents, no AI, no RAG, no Gmail. The work-item engine, the action verbs, the guards, RLS, permissions, the audit security and every existing migration are untouched.

**What is honest about "works".** The Renewal Space was clicked through in Chromium against the **real** Hono API and the **real** React bundle, with the plan built by the real recipes and checked by the real validator against the seeded registry. Supabase itself was a stub serving rows copied from hosted, because this container holds no service key — so Postgres, RLS and Supabase Auth are not exercised in the browser path. They are proven separately, on hosted, with SQL: migration 0031 applied, the registry's RLS asserted, and every seeded identity's visibility re-checked. Both sets of evidence are below.

---

## 1. Decisions recorded

### D-058 — the two plans are reconciled; each owns a layer

Two phase plans had been live since 8 September and disagreed on the shell and on what "Phase 4" and "Phase 5" mean. Now:

- **Architecture v3.1** is the source of truth for backend architecture, security, the economic rules and dependencies.
- **Screen Map v3 and `docs/ui-contract.md`** are the source of truth for visible navigation, wording and interaction. Where §42's shell and v3's three destinations disagree, v3 wins on what a person sees; the architecture wins on everything behind it.
- **UI Build Spec Part 12** remains the delivery checklist and **may not bypass an architecture dependency**. A phase whose prerequisite sits in an unbuilt architecture phase waits, or ships the part that does not need it and says which.
- **A new insurance capability is not built as a temporary fixed page when the Space system can carry it.** Recorded against Phase 5b in the work order.
- **No phase is renumbered.** When a number is written down it names its plan.

`CLAUDE.md` was corrected: the permanent shell is Today · Work · Automations, then + New, Search, Profile, with Ask ASAP persistent and never a destination and Activity as the chip where runs appear. Insurance modules remain barred from primary navigation.

### D-059 — `UiIntent` and `component_definitions` have separate responsibilities

Build spec Part 13 item 6 asked which of the two contracts survives. Neither survives alone; each gets one job:

- **`UiIntent` is the small validated result envelope** — intent, result type, relevant records, Space type, suggested actions, and which registered blocks are requested.
- **`component_definitions` is the authoritative registry** — identity, version, purpose, permitted Space types, property JSON Schema, required permissions, whether a block may carry an action, whether it must cite evidence.
- `UiIntent` **references** registered component ids and keeps no competing catalogue.
- The renderer may render **only** registered components.
- **The server validates every plan before it reaches the browser.**
- **No model may invent** a component, a business value, a permission, progress, a cover state, a money state or an action.

D-041's interim two-enum answer is superseded for `ComponentId`: the enum stays as the compile-time mirror and a test asserts it matches the registry.

---

## 2. Defects fixed

Six, each with a regression test, in their own commit (`5f6e403`) ahead of the Space work.

| # | Defect | Fix | Test |
|---|---|---|---|
| 1 | A claim could not be registered: the policy-period select was empty and `periodId` never reached the payload, so every attempt returned `409 Not yet: Confirm the policy period this incident falls in.` | `Record.tsx` passes `claim.candidatePeriods`; `ActionPanel` sends `policyPeriodId` (and `evidenceKind`, dropped the same way). One candidate is preselected; none says so instead of offering an empty select. | payload asserted field by field, plus the no-candidate case |
| 2 | Claims, servicing and endorsement panels rendered **after** the record footer. | They go through `aside`, which the Part 14 recipe places above the footer. | DOM order asserted: servicing before `Every step`, both before `FOOTER` |
| 3 | The Activity chip read 0 with two failed runs present — `could_not_finish` and `stopped` were excluded entirely. | Both are always counted, however long ago they ended; the dot turns red when something needs a person. | the exact three hosted rows that produced 0, plus the live/this-session cases |
| 4 | The record footer's Activity control was an anchor to `#record-activity`, and no element carried that id. | The run history carries the id and is focusable; the control scrolls and moves focus. | the target must exist whenever the control is shown, and neither when there are no runs |
| 5 | A stale Ask error sat beside a later success: `Request failed (database_error). | 4 items match "Acme"`. | every mutation is reset when a new question is submitted. | fail then succeed; the old message must be gone |
| 6 | Opening a policy always logged `404 GET /work-items/{policyId}` before the fallback. | Links that know the id is a policy say so and the page reads the policy directly; a pasted URL carries no hint and still falls back. | the probe must not happen with the hint, and must happen without it |

Verified in the browser as well as in tests: screenshot `07-claim-unchanged-flag-on.png` shows the claim's DOM order as `Choose the policy period this falls in → Claim → Notification clock → Documents → Settlement — three facts → Our call notes → Every step → What ASAP did → FOOTER`, and Today's chip reads **Activity 2** where it read 0.

---

## 3. Endpoints added

### `GET /attention` — Today

Replaces the ranking that lived in `views/TodayView.tsx`. It resolves the organization and permissions from the session, reads under the caller's RLS, and returns:

- the two sections in the order `docs/click-through.md` states — Needs you, then Checks due;
- a 1-based rank inside each section;
- the plain-English reason each item appears, from the engine's own `reason`;
- the step waiting on a person or a party;
- the run that could not finish, attached to the item it left needing a person;
- failed runs with no work item of their own, which would otherwise be reachable nowhere;
- `visible` and `returned` per section against a stated cap of 25;
- `generatedAt` — **the server's clock**. A check being due is a fact about now, not about the visitor's device, which is what the browser was deciding before.

**Ranking is section, then recency — deliberately no invented importance score.** §27's weighted score has detectors behind it and is architecture Phase 4. Ranking by anything we made up here would be exactly the kind of authored number D-059 forbids.

### `GET /work?view=&limit=` — Work's four views

The browser was selecting up to 100 rows through `supabase-js` and deciding among them, so the backend could not rank, cap, summarise or permission-filter a list — the four things Architecture §42 requires of every list endpoint. Now it does, with the same four view definitions and the same status rules.

### `GET /spaces/:recordId?view=` — a validated Space plan

Composes a renewal from the shared recipes, validates it, and returns the plan plus the registry versions it was checked against. Every other record kind answers 404, so the existing page stays the only renderer for it.

---

## 4. Registry components added

Migration `0031_component_definitions`. Nine components, and nothing else — only what the first Renewal Space uses.

| Component | Purpose | Action? | Evidence? |
|---|---|---|---|
| `RenewalReadiness` | The focus block: next decision, why, one action | yes | no |
| `ClientHeader` | The client, with the human-work status | no | no |
| `PolicyCard` | The period of cover, cover status on its own line | no | **yes** |
| `InsurerResponseTracker` | Who has answered and who has not | no | **yes** |
| `TermComparison` | Terms side by side as named facts | no | **yes** |
| `DraftEmail` | A message prepared for a person to send | yes | no |
| `SourceEvidence` | Evidence beside an important fact | no | **yes** |
| `ActivityFeed` | What ASAP did, and what a person recorded | no | no |
| `Checklist` | The steps as supporting context | no | no |

The table is platform configuration, not tenant data — every brokerage renders from the same registry, so there is no `organization_id`. RLS is still on, with **one SELECT policy** for `authenticated` and `asap_worker`, none for `anon`, and **no insert, update or delete policy or privilege for any application role**: a component arrives by migration, reviewed, never through the API and never from a model. Rows are versioned, because a block stores the version it rendered with.

`apps/api/test/component-registry.test.ts` reads the migration file and asserts the stored JSON Schema equals `z.toJSONSchema` of the Zod shape the code builds plans with, so the two cannot drift.

---

## 5. Validator rules

`apps/api/src/spaces/validate.ts`. Every plan passes this before it reaches the browser. A plan that fails any rule is **discarded, not repaired**; the route answers 422 and logs the reasons. One test drives each rule with a plan that breaks it.

| Rule | Rejects |
|---|---|
| shape | anything that is not a `SpacePlan` — including markup |
| block_limit | more blocks than the limit (8) — a rejection, never a truncation |
| unknown_component | a component not in the registry, or at a version it does not hold |
| deprecated_component | a component the registry has retired |
| component_not_allowed_here | a component not permitted in that Space type |
| invalid_props | properties that fail the **stored** JSON Schema: a missing key, a wrong type, an unlisted extra key, a value outside a closed enum |
| record_unreadable | a record that does not resolve for this caller — one failure, revealing nothing about it |
| record_mismatch | a plan naming a different record from the one that was read |
| action_not_allowed | an action on a block the registry does not let carry one |
| unknown_step / action_not_on_step | an action on a step that does not exist, or that the step does not offer |
| action_unblocked | an action the record says is blocked but the plan offers as available — a plan may repeat a guard, never soften it |
| permission_missing | a block the caller lacks the permission for, before it is sent |
| evidence_missing | a block that must cite a source and cites none |
| derived_fact_in_plan | `progress`, `percent`, `completion`, `confidence`, `score`, or a cover or money status carried as a plan fact — **at any depth** |

The JSON Schema check is a purpose-built subset checker (`spaces/jsonschema.ts`), not a dependency: the schemas are ours, generated from Zod, so the subset is known and closed. Anything it does not understand is a rejection, never a pass.

---

## 6. The Renewal Space

Behind `VITE_PUBLIC_RENEWAL_SPACE`, default `off`, added to `render.yaml`.

- **Same route.** `/r/:recordId`. Renewals render as a Space; every other kind renders exactly as before.
- **Same backend.** The current data, the shared recipes, the finite action verbs and the server-evaluated guards. No new verb, no new guard, no new write path: a block's action calls the same `POST /work-items/:id/actions` the record page calls.
- **Titled as itself**, never as its recipe.
- **Only what the intent needs.** The summary view carries six blocks; the blocker view carries four. A block with nothing to put in it does not render.
- **A follow-up changes the blocks, not the location.** Clicked and confirmed: the URL is unchanged.

Views, as composed by the real API:

| View | Blocks |
|---|---|
| summary | RenewalReadiness → ClientHeader → PolicyCard → InsurerResponseTracker → DraftEmail → ActivityFeed |
| blocker | RenewalReadiness → ClientHeader → InsurerResponseTracker → Checklist |
| comparison | RenewalReadiness → ClientHeader → TermComparison → InsurerResponseTracker → SourceEvidence |
| policy | ClientHeader → PolicyCard → SourceEvidence → Checklist |
| timeline | ClientHeader → Checklist → ActivityFeed |
| documents | ClientHeader → SourceEvidence → Checklist |

The four follow-ups the task named all work: **"Renew Acme"** opens the record and the blocker is the focus block; **"Compare the terms"** swaps to comparison blocks; **"Why did APA increase the premium?"** routes to the comparison with its evidence; **"Show me the current policy"** swaps to the policy blocks and keeps Acme's context.

**No model is connected.** Plans are built deterministically from the recipes and marked `source: "recipe"`. The registry and the validator are now in place, which was D-059's gate for the generative half; the other half — which model powers Ask — is still open and nothing generative ships until it is decided.

**Three honest limits of this first Space:**

1. **An action that needs typed evidence cannot be completed from a block.** Clicking "Record terms received" takes a person to the blocker view rather than acting; no evidence form exists in a block yet. Confirmed by clicking: no POST was made. Actions needing nothing typed (`prepare`, `draft`, `complete`) do act.
2. **The term comparison compares only what is recorded** — one row, "Terms on file", per insurer. Premium, excess and cover differences are figures nobody has recorded: there is no quotes table and no money components. The block says so in its own note rather than filling a table with invented values.
3. **A block the server sends and the build cannot render is skipped and said out loud**, not guessed at. Tested with `PremiumBreakdown`.

---

## 7. Screenshots

Fourteen, in `docs/audit/space/`, at 1360×900 and 390×844, listed in `ASAP_UI_REFERENCE_COMPARISON.md` §3. The Renewal Space is `03`–`06`; the rollback is `10`; the reference prototype is `20`–`21`.

---

## 8. Test results

```
pnpm turbo typecheck lint test    21/21 tasks pass
  api      140 tests   (was 89 — +51: attention 24, validator 17, space plan 21 across files)
  web       60 tests   (was 40 — +20: six defect regressions, the Space renderer)
  schema    59 tests
  db         2 tests
  lint      secret-scan: ok
```

**Hosted, by SQL, after applying migration 0031:**

```
component_definitions        rls_enabled=true  policies=1  cmd=SELECT
                             for authenticated+asap_worker=true   for anon=false
                             authenticated: select=true insert=false update=false delete=false
                             anon: select=false
                             seeded=9   schemas not closed=0
```

**Hosted multi-user visibility, as each seeded identity under RLS** (`registry` = rows of the registry they can read; the rest are work items):

| Identity | Brokerage | registry | Acme renewal | Beta rows |
|---|---|---|---|---|
| admin@acme-brokers.test | Acme | 9 | 1 | 0 |
| ae@acme-brokers.test | Acme | 9 | 1 | 0 |
| finance@acme-brokers.test | Acme | 9 | 1 | 0 |
| admin@beta-risk.test | Beta | 9 | 0 | 2 |
| ae@beta-risk.test | Beta | 9 | 0 | 2 |
| finance@beta-risk.test | Beta | 9 | 0 | 2 |
| shared@consultant.test | both | 9 | 1 | 2 |
| two accounts with no seeded brokerage | — | 9 | 0 | 0 |

Every signed-in user reads the whole registry, which is correct — it is platform configuration. No user reads another brokerage's work. Grace, who belongs to both, reads both.

**Renewal click-through, against the real API** (`GET /spaces/…`): 401 without a bearer; 200 with; a claim's id answers 404; all six views compose and validate; the tracker carries `Jubilee → not_on_file` and `APA → on_file` with `APA terms, email 8 September` as the citation; the draft carries `sentAt: null` and `sentEvidence: null`; no `moneyStatus`, `progress`, `confidence` or `percent` appears anywhere in the plan; `PolicyCard.coverStatus` is `active` — its own column, the one exemption.

**Banned words:** none of *Waiting*, *Failed*, *Success*, *Space* or *Job* renders anywhere on the Space. Checked against the rendered page text, not the source.

**Rollback:** with the flag off, the renewal renders the old record page (`Every step`, `What ASAP did`), **no `/spaces` request is made at all**, and Today still comes through `/attention` with the same five cards. Screenshot `10`.

---

## 9. Rollback instructions

**To turn the Renewal Space off** — the whole of it, in one step:

1. In the Render dashboard, set `VITE_PUBLIC_RENEWAL_SPACE` to `off` on the **asap-web** static site (it is already `off` in `render.yaml`, so a fresh deploy is off unless the dashboard says otherwise).
2. Redeploy the static site. No API redeploy, no migration, no data change.

Every renewal then renders the existing record page, exactly as it did before this branch. Verified by clicking, not assumed.

**What does not roll back with the flag, and why that is safe:**

- **`GET /attention` and `GET /work`.** Today and Work use them whether the flag is on or off. They are additive endpoints returning the same items the browser was choosing, and 24 tests pin them against the click-through document. To roll *these* back you would revert `42eb460`.
- **Migration 0031.** Migrations are append-only. The table is read-only to the application and unused when the flag is off, so leaving it costs nothing. Removing it would need a new migration.
- **The six defect fixes** (`5f6e403`) are independent of the Space and should not be rolled back.

**If a plan ever fails validation in production**, the route answers 422, the Space shows "This page could not be composed", the record itself is unchanged, and the failing rules are in the API log. That is a recipe defect to fix, not a reason to turn the flag off — though the flag is there if you want the old page immediately.

---

## 10. Remaining differences from the reference prototype

Eighteen, each with its reason, in `ASAP_UI_REFERENCE_COMPARISON.md` §2. The ones that cost a person something, shortest first:

1. **Today has no page heading** at all — no greeting, no `h1`.
2. **No action on a Today card.** The prototype's "Continue" / "Review" lets a person act from Today; `/attention` returns the step but not its actions.
3. **No context chip on the Ask dock.** Ask carries context and never says so.
4. **The reason is hidden behind "Why here?"** where the prototype shows it by default.
5. **No owner or next-check line** on a card.
6. **Five separate cards** on Today where the prototype uses one card with hairline rows.
7. **No back link, Pin or ⋯** on a record.
8. **The focus eyebrow is uppercase** and **the primary button is green** where the reference is sentence case and navy.
9. **Supporting panels stack** where the reference uses two columns at desktop width.

And one defect found while comparing, **not fixed** because it is outside the six this task named: **every screen overflows horizontally by 11px at 390px** — measured, `scrollWidth` 401 against a 390 viewport, caused by the profile control in the mobile bar. It is pre-existing (identical with the flag off, and present on Today and on a claim), and it corrects the earlier audit, which reported no overflow on the strength of screenshots rather than measurement.

---

## 11. Recommendation for the next build step

**Migrate the placement Space next, and take three small things with it.** In order:

1. **Fix the 11px mobile overflow.** It is on every screen, it is one control, and it is the cheapest quality win available.
2. **Add the step's actions to `GET /attention`,** then put a primary action on each Today card. This closes the largest behavioural gap against the reference and needs no new table.
3. **Add an evidence form inside a block,** so an action that needs a typed reference can be completed in a Space rather than sending a person back to the record page. This is the one thing that makes the Space a complete replacement rather than a better summary; it is also the prerequisite for migrating any other kind.
4. **Then migrate placement.** It is the second-most-complete workflow, it already has a real gate with a real override, and it needs `PolicyCard`, `ClientHeader`, `SourceEvidence`, `Checklist` and `ActivityFeed` — all seeded — plus one new component for the gate. Migrating it proves the pattern generalises beyond the kind it was designed around, which one Space cannot.
5. **Build Phase 5b (TOR, certificates, stock) directly as Spaces**, per D-058, rather than as fixed pages that would then need migrating.

**Do not start** the AI layer until Part 13 item 6's second half is decided — which model powers Ask. The registry and the validator now stand between a model and the renderer, which was the precondition; the model choice is a separate decision and nothing generative should ship before it is written down.

**Also still outstanding and unrelated to the UI:** placement authority by sum insured and class (`authority_sufficient` is still a stub, so any member who can approve at all can approve any sum insured). The work order marks it **must land before production**, and it has nothing to do with Spaces.
