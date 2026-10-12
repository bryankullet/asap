# Intelligent UI & Living Interface — implementation map (D-156)

Tracks the "Intelligent UI Engine & Living Brokerage Interface" brief (12 Oct 2026) against the
code. Each item is marked **built**, **partial** or **not built**. Nothing is marked built unless
it is in the code and covered by a test that was run.

Branch: `claude/living-interface`. Base: `main` at the adaptive shell (D-155, PR #17).

---

## 1. What already existed, and stays

| Area | Where | Status under D-156 |
|---|---|---|
| Adaptive shell: Home, Work, Automations, Activity, Search, New, conversations, Spaces, split, drawer | `apps/web/src/asap/shell/` (D-155) | Kept. Living surfaces open inside it as a Space (`/s/living?workItemId=`) |
| Approved interface logic + Space renderers | `asap/logic.js`, `asap/views/space-views.js` (D-115) | Kept. Restyled with the new tokens (M1) |
| Live / demo engines | `asap/live.js`, `asap/demo.js` | Kept. Live mode adds `living()`; demo mode has none and opens the renewal steps |
| Space plan contract + registry | `component_definitions` (0031), `apps/api/src/spaces/` (D-059) | Kept and reused. Living blocks register in the same table (0079) with `allowed_spaces = {living}` |
| Business authority: runs, quotation, placement, issuance, cover check, approvals, audit | `apps/api/src/workflows`, `routes/opportunities.ts`, `placement/*` | Unchanged. The Living surface only reads them, through their own loaders |
| RLS, permissions, tenancy | migrations, `context.ts` | Unchanged. The surface is read under the viewer's own session |

**Superseded presentation decisions** (recorded in D-156): CLAUDE.md's "a card at rest is a
hairline border and an 18px radius, never a drop shadow" and the 18/12/99 radius set. Cards now
carry the `--shadow-1` resting elevation and the radius scale below. Status colours and their
meanings are unchanged.

---

## 2. Architecture

```
authorized records (viewer's session, RLS)
  └─ living/facts.ts         loads one renewal: work item, client, period, run (loadWorkflowDetail),
                              quotation (loadOpportunity), revisions, placement (placement.load),
                              issuance (loadIssuance, read-only), audit (only with audit:view)
  └─ living/renewal.ts       pure, deterministic composition: stage, progress opportunities,
                              obligations, changes, consequences, cover, evidence, timeline
  └─ living/validate.ts      registry + stored JSON Schema + Zod, allowed actions, required
                              evidence, banned derived keys; blocks the viewer may not see removed
  └─ GET /living/:workItemId  → LivingSurface (packages/schema/src/living.ts)
       └─ web: asap/living/LivingSurface.tsx renders registered blocks (asap/living/blocks.tsx)
```

- **Contract**: `packages/schema/src/living.ts`. One strict Zod schema per block; the surface is
  versioned (`version: 1`), fingerprinted, and every block has a stable id, a component version and
  a content hash.
- **Registry**: migration `0079_living_blocks.sql` seeds 11 components. `test/living-registry.test.ts`
  fails if a stored JSON Schema drifts from Zod.
- **No model in the path.** Composition is deterministic. `ai.available` only tells the browser
  whether model-assisted parts (Ask) can run.
- **Actions never write.** A block can only *open* a governed place (`renewal`, `quote`, `document`,
  `workitem`, `client`, `policy`) or *ask*. Approval, sending, recording and applying happen where
  they already happen, under their existing guards.
- **Values come from records.** A premium is the stored amount; cover is the placement or issuance
  cover reading, verbatim; a consequence is `confirmed` (from records), `potential` (from a
  relationship) or `missing` (a fact is absent).

### Registered Living components

| Component | Purpose | Requires evidence |
|---|---|---|
| ContextHeader | Record, client, status, owner, key facts | no |
| RenewalJourney | Eight stages, done / now / next, from records | no |
| ProgressOpportunity | What moves the work forward, why, who holds it, what blocks it, whether it needs approval | no |
| ObligationTracker | Who holds the next step and since when (outside party, colleague, ASAP) | no |
| ChangeComparison | Earlier and revised values side by side, and what the revision affects | yes |
| ConsequencePanel | Confirmed / potential / unknown consequences | no |
| CoverageEffectiveState | Expiring period, days left, renewed cover as the server reads it | no |
| QuoteComparison | Insurer answers as named facts, never ranked | yes |
| PlacementProgress | Instruction → approval → sent → confirmation → issuance and check | no |
| EvidenceInspector | Every source behind the surface; documents open | no |
| Timeline | Recent changes on this work (audit, with permission) | no |

### Stage derivation (renewal)

`stopped` if the run is in exception (and no placement exists) · `verified` if the issuance was
applied · `issuing` once an issuance request exists · `placing` once a placement exists ·
`deciding` at hand-over with quotes · `comparing` at the compare step or with a quote ·
`awaiting_terms` while terms are open or with an insurer · `preparing` at pack, communications or
approval · otherwise `attention`.

---

## 3. Visual system (M1)

`packages/ui/src/styles.css` remains the single source. Figtree for body text, Outfit for headings.

- Radius scale: surface 28 · panel 24 · card 22 · nested 18 · control 15 · input 14 · compact 12 ·
  chip 10 · tight 8 · pill 999.
- Elevation: `--shadow-1` (cards at rest) · `--shadow-2` (raised, command box) · `--shadow-3` ·
  `--shadow-4` (floating: palette, sheets).
- Wash `#f4f6f3`. Pill buttons and tabs, hover lift on cards, visible focus rings, reduced motion
  honoured.

Applied to the shell (`shell/shell.css`), the Space renderers (`views/space-views.js`) and the
Living surface (`living/living.css`).

---

## 4. Milestones

| Milestone | Status | Notes |
|---|---|---|
| M0 Audit & compatibility | **built** | This document; D-156 |
| M1 Visual foundation | **built** | Tokens, radius and elevation scales, Figtree, shell + Spaces + Living restyled |
| M2 Contracts & renderer | **built** | Surface spec, registry, validator, registered React renderers, loading/error states, compatibility with existing Spaces |
| M3 Context & progress intelligence | **built** for renewals | Viewer-authorized facts, progress opportunities, obligations, evidence. A general semantic graph over every entity is **not built** |
| M4 Intelligent Home | **built** | Attention, ASAP's running work, waiting parties and Recent (D-155); **What changed since you last looked** from semantic events, linked to the work, refreshed every minute and on focus (D-159); portfolio requests open the portfolio (D-158) |
| M5 Living Renewal Journey | **built** to the limits of existing capabilities | One workspace from attention through quotation, comparison, revision, decision, placement, issuance and verified cover. Since D-157 the governed actions run **in place** (§7). Stage 9 (continuing relationship) is **not built** |
| M6 Ask ASAP directing the interface | **built** for the renewal portfolio (D-158) | A request in words refines a typed query — window, grouping, filters, insurer comparison — said back as removable chips; unclear words are said, ambiguous insurers ask; Home opens the portfolio for portfolio requests. Deterministic interpreter only; a model-assisted reading is **not built** (needs an evaluation run). Refinement of other surfaces is **not built** |
| M7 Reactive composition & continuity | **built** | 20 s polling and refresh on focus; unchanged fingerprint → no re-render; blocks keyed by stable id and reconciled in place; Updated/New marks; pin, collapse and selections on the server (D-157/159); open forms keep their command and typed text through updates; deep links, refresh, Back/Forward |
| M8 Insurance-native intelligence | **partial** | Time & cover, obligation, change/contradiction (revisions, including after instruction) are built for renewals. Communication-to-execution, handoff, portfolio consequence and decision memory are **not built** |
| M9 Exploration & multi-context | **partial** | Client decisions explored before they are made, up to three side by side, from records, in the address (D-160; `living-actions.e2e.mjs` checks figures, no write, Back). Portfolio rows open their workspace (D-158). Saved, versioned proposals beyond the address are **not built** |
| M10 Hardening | **partial** | e2e in a real browser at 1440/1360/900/390, tenant isolation, permission filtering. Visual regression baselines, an accessibility audit and performance measurement are **not built** |
| Secondary workspaces (claims, endorsements, reconciliation, investigations, portfolio) | **not built** | The contract's `purpose` is an enum, so a second purpose is additive |
| UI Lab | **built** (dev only) | `apps/web/e2e/lab.html`: the composer's own output at every stage. Never bundled |

## 5. Scenarios

| Scenario | Status | Where it is tested |
|---|---|---|
| A Find meaningful work | **built** | `shell.e2e.mjs` living-renewal-from-work: a Work row opens the Living workspace |
| B Restore interrupted work | **built** | `living-actions.e2e.mjs`: the insurer in focus and the open sources survive an update, leaving for Home and returning, and a refresh |
| C Insurer response arrives | **built** | `living-actions.e2e.mjs`: an answer recorded through the quotation workflow while the broker types; the surface reconciles in place (no remount), marks changes and keeps the unsent text |
| D Quotation revision | **built** | Earlier/revised side by side and flagged after instruction (`living-surface.test.ts`, UI Lab "comparing" and "placing") |
| E Missing evidence | **built** for renewals | Missing period, missing premium and missing renewed cover are stated, not filled (`living-renewal` e2e) |
| F Natural-language refinement | **built** | `living-portfolio.e2e.mjs`: Home request → portfolio; "group by insurer", "only premium increases" (recorded figures exactly), Back/Forward undo and redo, an unclear request changes nothing, chip removal, "compare CIC and Jubilee", refresh keeps the view, a row opens its workspace |
| G Approval requirement | **built** | The bundle is shown in full and approved in place through the existing endpoint with its frozen hash; a role that cannot approve is offered nothing and refused if it posts (connected) |
| H Cross-tenant isolation | **built** | Connected test (404 for the other brokerage) and `living-never-leaks` in the browser |
| I Role-specific view | **built** | Blocks needing a permission are removed before sending (unit); audit history only with `audit:view` (connected) |
| J AI outage | **built** | Composition needs no model; the surface renders with `ai.available: false` |
| K Workflow interruption | **built** | Exception → stopped stage, the run's message and what is needed (UI Lab "stopped") |
| L Coverage verification | **built** | A request is never cover (`living-surface.test.ts`; e2e "Not confirmed") |
| M Mobile | **built** | 390 px e2e and UI Lab; the surface scrolls and never runs past the screen |
| N Returning from history | **built** | The address is the surface (D-155); `/s/living?workItemId=` reloads to the same surface |
| O Event burst | **partial** | Two inbound revisions in a row reconcile without remount or losing typed text, and an open form never changes command (browser + unit). Not load-tested at volume |

## 7. Governed actions in the workspace (D-157)

A block may carry a `command` action from a closed set. The browser maps each command to the
endpoint that already owns it (`apps/web/src/asap/living/commands.ts`); the surface can name a
command and its target, never a path. Each endpoint re-checks permission, frozen payloads and
state, and audits — nothing new decides an outcome.

| Command | Existing endpoint | Offered when |
|---|---|---|
| `workflow_approval.decide` (approve / return with reason) | `POST /workflow-approvals/:id/decide` with the frozen `bundleSha256` | the run waits for approval and the viewer may approve; the bundle is shown in full (`ApprovalBundle`, 0081) |
| `quotation.record_delivery` | `POST /opportunities/:id/actions` `record_delivery` | an insurer request is approved and not delivered, and the viewer may edit the quotation |
| `quotation.record_response` | `POST /opportunities/:id/actions` `record_response` | the request was delivered and no answer is on file; the source is required |
| `run.follow_up_now`, `run.move_follow_up`, `run.escalate`, `run.pause`, `run.resume` | `POST /workflows/runs/:id/…` | the run's own intervention list says available, and the viewer holds `policy:edit` |
| `placement.approve_request`, `placement.record_submission` | `POST /placements/:id/actions` | the placement's own permissions allow it; the request text is shown in full before approval |
| `issuance.approve_request`, `issuance.record_submission` | `POST /placements/:id/issuance/actions` | the issuance's own permissions allow it |

The validator rejects any command whose fixed payload or inputs differ from that command's (a
tampered `action`, an extra field). Inputs are never pre-filled with chosen values. Submissions
carry an idempotency key per intent. A result is the endpoint's own answer — done, already done, or
refused with its reason — and a receipt at the top of the surface outlives a block that leaves.

Tested: unit (composer and validator), web (command form: required inputs, owning path, refusal
shown, no false success), connected on real Postgres (approve through the surface's command; a
reader is offered nothing and refused if they post anyway; idempotent re-approval), and in a real
browser (`living-actions.e2e.mjs`: approve, record delivery and escalate in place).

## 8. Personal arrangement and unreadable sources (D-157)

- Pinned and collapsed blocks, selections and "last seen" live in `surface_preferences` (0080),
  scoped by RLS to brokerage, person and surface — never browser storage. Demo mode and the UI Lab
  keep them for the visit only.
- Every source read by `living/facts.ts` records a gap (`restricted` or `failed`) instead of
  becoming null. The composer never presents a gap as an absent period, placement or cover, and
  the surface names the gaps in a notice.

## 9. The renewal portfolio (D-158)

`POST /living/portfolio` with `{ query, text }`. `living/interpret.ts` turns the text into a new
query on top of the current one; `living/portfolio.ts` reads renewals for the window under the
viewer's session (policy periods, renewal Work items, quotations, placements, confirmed premiums),
filters, groups and totals them, and composes `ContextHeader`, `QueryInterpretation` and
`PortfolioGroups`. The browser keeps the query in the address and reuses the answer once for the
arrival at the refined address.

Understood today: windows (a month, next/this month, next N days, this/next quarter, Qn, end of
year), grouping (insurer, class, owner, client, month, status), premium change (increase, decrease,
changed, none yet), status (needs me, waiting on others, not started, done), "mine", an insurer or
class by the brokerage's own names, "compare A and B", "clear filters".

## 6. Known limitations

- Only renewals have a Living surface. Other work keeps its existing Space.
- Polling, not push. A 20 s interval is enough for insurer and colleague events, and it avoids a
  second realtime channel next to the existing one.
- The renewal steps (`/s/renewal?runId=`) remain the place where approval, sending and recording
  happen. The Living surface links to them; it does not duplicate them.
- Demo mode has no server, so it has no Living surface and opens the renewal steps instead.
