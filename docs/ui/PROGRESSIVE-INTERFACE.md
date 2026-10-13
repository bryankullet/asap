# The Progressive Living Brokerage Interface — Phase 2 and the Phase 3 foundation

Status date: 13 Oct 2026 · branch `claude/web-next` · decision D-172.
**Not merged, not deployed, migration 0092 not applied to the hosted database.** The current
application (`apps/web`) is unchanged and remains the production frontend.

> ASAP does not send the user looking for the right interface. ASAP builds the right interface around
> what the user wants to do.

## 1. What exists

| Part | Where | What it is |
|---|---|---|
| Contract | `packages/schema/src/experience-v2.ts` | `ASAPExperienceSpec`: intent, authorized context, a bounded layout grammar, 20 registered components, a closed set of governed actions, continuity state, revisions, and a validator |
| Experience sessions | `supabase/migrations/…0092_experience_sessions.sql` | One person's working context in one brokerage, with RLS; interface state and record references only |
| Server pipeline | `apps/api/src/experience/`, `apps/api/src/routes/experiences.ts` | Intent reading (rules, then the gateway), record resolution under the session, three composers, validation, sessions |
| New frontend | `apps/web-next/` | A new React app: Home, the experience host, the generic layout renderer, the component registry, the closed action dispatcher, continuity |

`apps/web-next` imports nothing from `apps/web`: no LivingSurface renderer, no Space renderer, no
fixed regions. It shares `@asap/schema` (contracts) and `@asap/ui/styles.css` (the design tokens).

## 2. The pipeline

```
words on Home (or a record on screen)
  → intent reading: deterministic rules; the AI gateway only when no rule matches (schema-checked,
    words only — it never names a record, a value or an action)
  → experience session (per person and brokerage, RLS)
  → record resolution under the viewer's session (clients, policies, periods, renewal work)
  → composition: the smallest useful interface for the intention and the records' state
  → validation: contract shape, depth ≤ 6, ≤ 60 nodes, ≤ 24 components, every slot placed once,
    registered components and versions, props against each component's contract, actions known and
    allowed for the component carrying them, mutations carrying confirmation, every record reference
    among those the composer loaded under the session
  → React renders registered components inside the layout tree
  → interactions: interface actions in the browser; exploration recomposes; business mutations go
    through the endpoint that already owns them (closed map), which checks permission again
  → the result is reported as an event; the server re-reads what it names and recomposes
```

One path serves every intention. There is no separate pipeline for Home, renewals or exploration.

## 3. The contract (experience-v2)

- **Intent**: kind, the person's words, what was understood, resolution (resolved, ambiguous,
  needs input, unsupported), who read it (rules or model), what is missing, interface progress
  (never an insurance workflow status), and when direction changed.
- **Context**: primary and related record references (`{type, id, label}`), informational
  permissions, constraints, unresolved questions, and parts that could not be read.
- **Layout grammar**: `stack`, `grid`, `split`, `flow`, `table`, `tabs`, `overlay`, `dock`, `focus`,
  plus `slot` leaves naming instances. Each node has a stable id, a priority and a narrow-screen rule
  (keep, collapse, hide secondary). No style values exist in the grammar.
- **Components** (by interaction purpose):
  - understanding: Clarification, RecordChoice, ContextSummary, Answer;
  - exploring: FilterBar, RecordTable, RecordDetail;
  - working: ProgressiveForm, DocumentViewer;
  - deciding: Comparison, GovernedAction, ApprovalReview, Confirmation;
  - progress: Milestones, NextSteps, Obligations, Consequences, Timeline;
  - evidence: SourceList, ChangeList.
- **Actions**, in four classes:
  - interface: `ui.select`, `ui.reveal`, `ui.dismiss`;
  - explore: `experience.refine`, `experience.start`, `document.open`;
  - mutate: `client.create`, `renewal.start`, `approval.decide`.

  A component may carry only the kinds its contract lists.
- **Continuity**: drafts, selections, revealed and dismissed nodes, and the unsent Ask text, versioned
  (`uiVersion`) with conflict-safe saves.
- **Revisions**: every composition has a revision. An older one never replaces a newer one. Requests
  are sequenced in the browser and out-of-order responses are dropped. Changed instances are marked
  "Updated" without moving focus. A pending action the new composition no longer offers is explained.

## 4. The three experiences

| Intention | Structure | Existing services used |
|---|---|---|
| "Add a new client" | `flow` around a progressive form: name and kind first, contact only when asked for; duplicate review; then a confirmation read from the saved record | `POST /clients` (permission check, duplicate review with 409, idempotent on the exact name, contact saved in the same request) |
| "Show me motor policies expiring this month" | `table` primitive: filter chips (each removable) and a selectable record table; a selected row opens its detail beside the table | Portfolio loader `loadPortfolio` and interpreter `interpret` (D-158); policy periods read under the session. "Motor" names every motor class of the brokerage's own |
| "Help me renew Acme's motor fleet" | Resolution (clarify or choose only when more than one fits) → `split` of current cover and a confirmed start → `dock` working context: summary, stage, approval (when one waits), next steps, quotes and revisions when the stage calls for them, who holds it, what it means, evidence | `resolveClient`, `loadPolicySpace`, `POST /workflows/renewals` (opens the Work, links the period, starts the run), `loadRenewalLivingFacts`, `renewalStage`, `progressOpportunities`, `obligations`, `changes`, `consequences`, `pendingApprovals`, `evidenceOf`, `renewalAnswer`, `interpretWorkspace` (rules, then the gateway); `POST /workflow-approvals/:id/decide` with the bundle hash |

Ask inside an experience changes the work area:
- in exploration it refines the filters;
- in a renewal it recomposes around a focus: compare quotes (split with evidence), compare
  revisions, what blocks it, evidence, obligations, consequences, history, "only what needs my
  approval", go back, show everything;
- a different intention ("add a new client") opens its own experience, and Back returns.

Refusals (deciding cover, choosing for the client, acting from words) are said, never acted on.

## 5. Security boundaries

- The browser holds the anon key and the session only. Organization, role and permissions are
  resolved by the API from the session on every request (§45 rules 4 and 5).
  `apps/web-next/scripts/check-bundle.mjs` checks the built artefact.
- Experience sessions are RLS-scoped to (brokerage, person). There is no delete grant and no anon
  access. Covered by pgTAP 0356.
- Every record an experience names is re-read under the session before use: a subject to start from,
  a chosen record, an action's result. A record of another brokerage is not found (404).
- The model returns a schema-checked reading: an intention and words the person typed. Words it
  returns that the person did not type are dropped. When the model is unavailable, deterministic
  reading continues. Every model-assisted reading writes an audit row
  (`experience.interpreted_by_model`, §45 rule 15).
- No markup, style or code comes from a composition. The browser validates each instance's props
  against its contract again before rendering, and an unregistered or invalid instance renders as an
  error state.
- Actions use a closed map. `ActionDispatcher` maps each kind to one fixed endpoint;
  `services/asap-api.ts` exports named functions only, with no generic request.
- Hiding is never the security. A read-only member sees why an action is unavailable, and the
  endpoint refuses independently (tested at API level and in the browser run).

## 6. API integration points (new)

| Route | Purpose |
|---|---|
| `GET /experiences` | The person's resumable work in the active brokerage |
| `POST /experiences` | Start from words, or from a record (`subject`) |
| `GET /experiences/:id` | Recompose from the session (fresh records) with the stored interface state |
| `POST /experiences/:id/ask` | Refine, change direction, or open another experience (`redirect`) |
| `POST /experiences/:id/events` | `action_result` (re-read and adopt), `select`, `deselect` |
| `PUT /experiences/:id/state` | Save interface state against `baseVersion`; 409 returns the stored state |
| `POST /experiences/:id/archive` | Archive (never delete) |

## 7. Verification

| Check | Result | Kind |
|---|---|---|
| Contract tests (`packages/schema`) | 15 passed: valid compositions; unregistered components and versions; props outside contract; unknown primitives; depth bound; placement; action allowlists; closed action set; confirmation on mutations; class consistency; unauthorized references, including nested ones | supporting |
| pgTAP 0356 | 9 passed (full suite 1,274 passed) | supporting |
| API intent tests | 20 passed: rules, refusals, model only when no rule matches, model words limited to the person's, no-model operation, malformed model output, explore refinements | supporting |
| Connected (`experiences.test.ts`) | 20 passed on real Postgres, PostgREST and RLS: the three structures, the governed saves, refresh, tenant isolation, foreign references refused, read-only member refused by the endpoint, model use audited, stale UI writes refused, every composition re-validated | supporting |
| Web-next unit tests | 24 passed: registry completeness; three structures from one renderer; unregistered and invalid props refused at render; reasons shown for unavailable actions; confirmation before protected actions; drafts surviving recomposition; "Updated" without focus moves; responsive collapse; reconciliation; out-of-order responses; continuity merge on conflict | supporting |
| Headless browser run (`pnpm test:e2e:next`) | 26 of 26 steps at 1440 and 390 px: Home; the three intentions and their different layouts; progressive form and draft surviving refresh; duplicate review; saved record; table selection and detail; refining; Back and Forward; renewal start with confirmation; focus and go back; switching intention while keeping work; read-only refusal by the API; tenant isolation by address | **supporting, headless — not main-browser acceptance** |
| Full workspace gate | typecheck, lint, build (both bundle checks), unit (api 957, web 194, web-next 24, schema 133, workers 25, db 3), eval 47, connected 271 of 272 (1 skipped) across 31 files, connected perf 24, pgTAP 1,274, and all 14 existing `apps/web` e2e suites — all passed. One earlier connected run timed out under load in three extractor-backed files; they passed alone and in the full rerun. The `@asap/db` table list now includes `experience_sessions` | supporting |
| Main visible browser | **BLOCKED** — this cloud session has no visible browser | M7 |
| Live AI calls | **not run** — no provider key in this session; the model path is tested with the deterministic provider | — |

Defects found and fixed during this work:
- a composer created components it did not place (caught by the validator);
- "what is blocking this renewal?" was misread as a list request;
- the client kind is `corporate`, not `company`;
- the duplicate-review 409 was treated as a failure;
- a disclosure key the contract rejected made draft saves fail;
- table rows were not selectable (a missing select action);
- false "no longer offered" notices after a person's own successful step;
- renewal start through the policy route did not link the period or start the run (switched to the
  workflow route);
- "motor" was not understood (class words now resolve against the brokerage's own classes);
- "go back" after a single focus did not return to the whole renewal.

## 8. Milestone status

| Milestone | Status |
|---|---|
| 1 Application foundation (`apps/web-next`, auth, API client, tokens, Home, host, build and test config) | **Completed** — runs independently of `apps/web` (port 5174) |
| 2 Progressive contract | **Completed** |
| 3 Generic composition renderer | **Completed** — all nine primitives, responsive rules, error and loading states, reconciliation, keyboard order (tabs with arrow keys, rows with Enter and Space) |
| 4 Intent understanding | **Completed** for the three intentions plus clarification, refusal and unsupported. Model path tested with the deterministic provider; **no live model calls made** |
| 5 First three experiences | **Completed** over real APIs. A renewal's later stages (placement, issuance) are shown from records when they exist; their governed actions beyond approval are not yet offered in this interface |
| 6 Continuity | **Completed**: server sessions, drafts, selections, disclosures, Ask text, refresh, Back and Forward, re-entry, brokerage switch returns Home (sessions are per brokerage), records re-authorized on every composition |
| 7 Main-browser demonstration | **BLOCKED** — no visible browser in this environment; the headless run is supporting evidence only |

Not implemented in this phase (stated, not simulated):
- attachments in the Home composer;
- governed placement and issuance actions in the new interface;
- live push (updates arrive by polling every 30 s and on focus);
- deployment configuration for `apps/web-next`.

## 9. Ready for Phase 4 and 5 without redesign

- **New intentions:** add a rule in `experience/intent.ts`, a composer returning `Composed`, and a
  kind in `IntentKind` and the 0092 check (a new migration). The pipeline, validation, sessions and
  renderer are unchanged.
- **New components:** add an entry to `EXPERIENCE_COMPONENTS` with its prop contract and allowed
  actions, and a view in `ComponentRegistry`. The build fails if either side is missing.
- **New governed actions:** add a payload to `actionPayloadSchema` and one case to `ActionDispatcher`
  mapping it to the endpoint that owns it. The endpoint keeps its permission checks and audit.
- **Model-assisted composition:** the model may later propose layouts. They must pass
  `validateExperienceSpec` with the authorized-reference set like any composition, and need an
  evaluation run (§45 rule 11).
- **Live updates:** replace polling with server-sent events behind the same reconciliation.

## 10. Running it

- `pnpm dev:next` runs it in development on port 5174. It needs the public variables:
  - `VITE_PUBLIC_SUPABASE_URL`;
  - `VITE_PUBLIC_SUPABASE_ANON_KEY`;
  - `VITE_PUBLIC_API_BASE_URL`, an API with migration 0092 applied;
  - `VITE_PUBLIC_APP_ENV`.
- It does not point at production by default. The API's CORS origin must include its address.
- `pnpm test:e2e:next` runs the supporting headless run against a disposable database (see
  `scripts/test-e2e.sh`).
