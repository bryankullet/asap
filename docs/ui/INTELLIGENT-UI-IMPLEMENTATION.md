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
| M4 Intelligent Home | **partial** | Home (D-155) already shows attention, ASAP's running work, waiting parties and Recent; renewal attention and running renewals now open the Living workspace. A "relevant changes since you were last here" section is **not built** |
| M5 Living Renewal Journey | **built** to the limits of existing capabilities | One workspace from attention through quotation, comparison, revision, decision, placement, issuance and verified cover. Actions open the governed Spaces where the work is done. Stage 9 (continuing relationship) is **not built** |
| M6 Ask ASAP directing the interface | **partial** | "Ask about this" opens the existing drawer scoped to the renewal's work item. Intent-to-surface refinement (group, filter, compose) is **not built** |
| M7 Reactive composition & continuity | **built** | 20 s polling and refresh on focus; unchanged fingerprint → no re-render; blocks keyed by stable id and reconciled in place; Updated/New marks; per-person pin and collapse; deep links, refresh, Back/Forward |
| M8 Insurance-native intelligence | **partial** | Time & cover, obligation, change/contradiction (revisions, including after instruction) are built for renewals. Communication-to-execution, handoff, portfolio consequence and decision memory are **not built** |
| M9 Exploration & multi-context | **not built** | |
| M10 Hardening | **partial** | e2e in a real browser at 1440/1360/900/390, tenant isolation, permission filtering. Visual regression baselines, an accessibility audit and performance measurement are **not built** |
| Secondary workspaces (claims, endorsements, reconciliation, investigations, portfolio) | **not built** | The contract's `purpose` is an enum, so a second purpose is additive |
| UI Lab | **built** (dev only) | `apps/web/e2e/lab.html`: the composer's own output at every stage. Never bundled |

## 5. Scenarios

| Scenario | Status | Where it is tested |
|---|---|---|
| A Find meaningful work | **built** | `shell.e2e.mjs` living-renewal-from-work: a Work row opens the Living workspace |
| B Restore interrupted work | **partial** | Collapsed blocks survive a refresh (`living-collapse-persists`, `LivingSurface.test.tsx`). Restoring a selection inside the comparison is not built |
| C Insurer response arrives | **partial** | Reconciles in place without remount (`LivingSurface.test.tsx`); not driven by a real inbound response in e2e |
| D Quotation revision | **built** | Earlier/revised side by side and flagged after instruction (`living-surface.test.ts`, UI Lab "comparing" and "placing") |
| E Missing evidence | **built** for renewals | Missing period, missing premium and missing renewed cover are stated, not filled (`living-renewal` e2e) |
| F Natural-language refinement | **not built** | |
| G Approval requirement | **built** (by delegation) | The surface marks what needs approval and opens the governed Space; it has no write path. An already-approved request is not marked as an approval |
| H Cross-tenant isolation | **built** | Connected test (404 for the other brokerage) and `living-never-leaks` in the browser |
| I Role-specific view | **built** | Blocks needing a permission are removed before sending (unit); audit history only with `audit:view` (connected) |
| J AI outage | **built** | Composition needs no model; the surface renders with `ai.available: false` |
| K Workflow interruption | **built** | Exception → stopped stage, the run's message and what is needed (UI Lab "stopped") |
| L Coverage verification | **built** | A request is never cover (`living-surface.test.ts`; e2e "Not confirmed") |
| M Mobile | **built** | 390 px e2e and UI Lab; the surface scrolls and never runs past the screen |
| N Returning from history | **built** | The address is the surface (D-155); `/s/living?workItemId=` reloads to the same surface |
| O Event burst | **partial** | An unchanged fingerprint is ignored and blocks never remount; not load-tested |

## 6. Known limitations

- Only renewals have a Living surface. Other work keeps its existing Space.
- Polling, not push. A 20 s interval is enough for insurer and colleague events, and it avoids a
  second realtime channel next to the existing one.
- The renewal steps (`/s/renewal?runId=`) remain the place where approval, sending and recording
  happen. The Living surface links to them; it does not duplicate them.
- Demo mode has no server, so it has no Living surface and opens the renewal steps instead.
