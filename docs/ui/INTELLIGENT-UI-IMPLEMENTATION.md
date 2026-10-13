# Intelligent UI & Living Interface — implementation map

Tracks the "Intelligent UI Engine & Living Brokerage Interface" brief (12 Oct 2026) against the
code. Each item is marked **built**, **partial** or **not built**. Nothing is marked built unless
it is in the code and covered by a test that was run. Decisions: D-156 to D-169.

Branch: `claude/living-interface`. Base: `main` at the adaptive shell (D-155, PR #17). Not merged,
not deployed. **The hosted database is at 0078; migrations 0079–0091 are not applied** (release
audit and plan: `docs/release/RELEASE-0079-0091.md`).

## Status at final acceptance (D-169)

**Verified** (by tests that were run; section 9 has the numbers):
- Every milestone in section 4 is built, except reconciliation workspaces (no records to compose from).
- Migrations 0079–0091 apply in order onto a populated 0078 database without changing any existing
  row; RLS, isolation, registry versions and the 0085 authorization hold on the upgraded data; the
  0078-era API runs on the 0091 schema; the rollback is rehearsed and restores schema and data exactly.
  Rehearsed on Postgres 16 with the shim and again on the hosted build, Supabase Postgres 17.6 (D-170).
- The authenticated shell and every Living surface pass axe-core (no serious or critical findings),
  keyboard focus and reduced-motion checks at 1440 and 390 px.
- The model-path evaluation set exists and its routing is proved offline (every model case bypasses
  the rules).

**Not verified — needs a configured AI gateway:** the model-assisted reading itself. No provider key
is available in the development environment, so `pnpm eval:workspace:live` has **not** been run and
the model path has **not** passed. The deterministic rules (100% on their evaluation set) work
without it; with no gateway, unmatched requests are told the workspace cannot bring that forward.

**Known limitations:** section 6.

**Deployment requires:** owner approval; the sequence in `docs/release/RELEASE-0079-0091.md` §3
(database first, then API, then web); for model-assisted reading, `AI_DEFAULT_PROVIDER`, `AI_MODEL`
and the provider key on the API, and a live evaluation run before enabling it.

---

## 1. What already existed, and stays

| Area | Where | Status |
|---|---|---|
| Adaptive shell: Home, Work, Automations, Activity, Search, New, conversations, Spaces, split, drawer | `apps/web/src/asap/shell/` (D-155) | Kept. Living surfaces open inside it as Spaces (`/s/living?workItemId=`, `/s/portfolio?q=`) |
| Approved interface logic and Space renderers | `asap/logic.js`, `asap/views/space-views.js` (D-115) | Kept, restyled with the new tokens |
| Live and demo engines | `asap/live.js`, `asap/demo.js` | Kept. Live mode adds `living`, `portfolio`, `homeChanges`, `surfacePrefs`. Demo mode has none: a renewal opens its steps, other work its Work-item page, the portfolio says "not connected" |
| Space plan contract and registry | `component_definitions` (0031), `apps/api/src/spaces/` (D-059) | Kept and reused. Living blocks register in the same table with `allowed_spaces = {living}` |
| Business authority: runs, quotation, placement, issuance, claims, endorsements, approvals, audit | `apps/api/src/workflows`, `routes/*`, `placement/*`, `servicing.ts` | Unchanged. Living surfaces read through the owning loaders and act only through the owning endpoints |
| RLS, permissions, tenancy | migrations, `context.ts` | Unchanged. Surfaces are read under the viewer's own session |

**Superseded presentation decisions:**
- D-156 replaced CLAUDE.md's "a card at rest is a hairline border, never a drop shadow" and the old radius set.
- D-163 darkened `--color-ink-muted` to `#5f6861` and `--color-ink-faint` to `#636c64` so muted text reaches 4.5:1 on every Living background.

---

## 2. Architecture

```
authorized records (viewer's session, RLS)
  └─ living/facts.ts · living/servicing.ts · living/portfolio.ts
        load through the owning loaders; every unreadable source is a recorded gap (D-157)
  └─ living/renewal.ts · servicing.ts · portfolio.ts · explore.ts · commands.ts
        pure, deterministic composition — no model in the path
  └─ living/validate.ts
        registry row at that version · stored JSON Schema · Zod source · allowed spaces ·
        closed command set with exact payloads · required evidence · banned derived keys ·
        blocks the viewer may not see removed before sending
  └─ GET /living/:workItemId[?explore=&focus=&target=&fq=&fsrc=]   renewal | claim | endorsement
     POST /living/:workItemId/interpret {text}   a request in words → a typed focus (D-165)
     POST /living/:workItemId/proposals          save what is explored as proposal vN (D-167)
     GET  /living/client/:clientId               a client investigation (D-167)
     POST /living/investigate {text}             which client a request names; never a guess
     POST /living/portfolio {query, text}  the renewal portfolio, refined in words
     GET /home/changes                     what changed since you last looked
     GET|PUT /surface-preferences/:key     personal arrangement (0080)
       └─ web: asap/living/{LivingSurface,blocks,panes,commands,prefs}.tsx
```

- **Contract:** `packages/schema/src/living.ts`. Every block has one strict schema. The surface is versioned and fingerprinted. Each block carries a stable id, a component version and a content hash. Purposes are renewal, portfolio, claim and endorsement.
- **Values come from records.** Premiums are the stored amounts. Cover is the server's cover reading, verbatim. Consequences are typed as confirmed, potential or missing. No model writes a value, a status or an approval.
- **Actions:**
  - `open` a governed place, or `ask`.
  - `command`, from a closed set that the browser maps to the endpoint that already owns it (D-157, §7). The surface can never name a path.

### Registered Living components (0079, 0081–0084, 0086, 0088–0091)

| Component | Purpose |
|---|---|
| ContextHeader | The record, client, status, owner and key facts |
| RenewalJourney | Nine renewal stages through the continuing relationship, derived from the records (v2, 0089) |
| WorkJourney | Any run's own steps (claims, policy changes) |
| ProgressOpportunity | What moves the work forward, why, who holds it, what blocks it |
| ObligationTracker | Who holds the next step and since when |
| ChangeComparison | Earlier and revised values side by side, and what the revision affects (needs evidence) |
| ConsequencePanel | Confirmed, potential and unknown consequences |
| CoverageEffectiveState | The expiring period and renewed cover as the server reads it |
| QuoteComparison | Insurer answers as named facts, never ranked (needs evidence) |
| PlacementProgress | Instruction → approval → sent → confirmation → issuance |
| ApprovalBundle | Exactly what will leave the brokerage, in full, with approve and return commands |
| ExplorationPanel | "If the client chose …", hypothetical, from records |
| WorkChecklist | Documents, item decisions, and separately recorded facts |
| QueryInterpretation | The portfolio view in words, each part removable |
| PortfolioGroups | Renewals selected by the query, grouped and totalled |
| EvidenceInspector | The sources behind the surface |
| FocusPanel | The answer to a request asked inside the workspace, from records, with abstention (0086, D-165) |
| ArrivedMail | Email filed to this work and not dealt with; ASAP's reading labelled; the governed step it proposes (0088, D-166) |
| HandoverNote | Responsibility moving between colleagues: done, open, watch, acknowledged (0087–0088, D-166) |
| RelatedWork | Other open work on the same client or policy, and why it bears on this work (D-166) |
| ResponsePatterns | Insurer response times from the brokerage's own records, an estimate with basis and sample (D-166) |
| DecisionTrail | The client's last round for the same cover: answers, declines, instruction, with evidence (D-166) |
| ProposalVersions | Saved, numbered, hypothetical proposals: insurers, revisions since, never the instruction (0090, D-167) |
| Timeline | Recent changes, notes, this cover in earlier years |

---

## 3. Visual system

`packages/ui/src/styles.css` remains the single source: Figtree body, Outfit headings, the
radius scale (surface 28 … pill 999) and the elevation scale (`--shadow-1` … `--shadow-4`).
Exploration is drawn dashed in purple, never framed in a status colour. Focus rings are visible on
every control, and reduced motion is honoured.

---

## 4. Milestones

| Milestone | Status | Notes |
|---|---|---|
| M0 Audit and compatibility | **built** | This document; D-156 to D-163 |
| M1 Visual foundation | **built** | Tokens, radius and elevation, Figtree, the shell, Spaces and Living restyled; contrast fixed (D-163) |
| M2 Contracts and renderer | **built** | Surface spec, registry, validator, registered renderers, loading, error, unavailable and empty states |
| M3 Context and progress | **built** for renewals, claims and policy changes | A general semantic graph over every entity is **not built** |
| M4 Intelligent Home | **built** | Attention, ASAP's running work, waiting parties, Recent; *What changed since you last looked* from semantic events (D-159); portfolio requests open the portfolio |
| M5 Living Renewal Journey | **built** | Attention → terms → comparison and revision → exploration → decision → placement → issuance → verified cover → continuing relationship (stage nine, D-167), with governed actions in place |
| M6 Ask ASAP directing the interface | **built** | The renewal portfolio is refined in words (D-158). Renewal, claim and policy-change workspaces recompose around a request asked inside them — revisions, quotes, blockers, evidence, obligations, consequences, messages, history, next steps, exploration (D-165). Rules first; the model through the gateway only when no rule matches, schema-checked and bounded to the record's names; evaluated (`workspace-requests.json`). The portfolio interpreter remains deterministic only |
| M7 Reactive composition and continuity | **built** | Polling and refresh on focus; in-place reconciliation by stable id; Updated and New marks; pin, collapse and selections kept on the server; open forms keep their command and typed text; deep links, refresh, Back and Forward |
| M8 Insurance-native intelligence | **built** | Time and cover, obligation, change and contradiction, communication and decision memory (D-162), portfolio consequence (D-158), colleague activity (D-159); arrived email with proposed governed steps, structured handovers with acknowledgement, related work across a client's records, measured response patterns, and the last round's decisions with evidence (D-166). Behavioural interface learning is **not built** by design: patterns come only from recorded outcomes |
| M9 Exploration and multi-context | **built** | Client decisions explored before they are made, from records, kept in the address (D-160); saved, versioned, hypothetical proposals (D-167); client investigations across every record on file (D-167); portfolio rows open their workspace |
| M10 Hardening | **built** | axe-core with zero serious or critical violations on every Living surface and across the whole authenticated shell, keyboard focus visibly drawn, reduced motion honoured (D-168); visual regression baselines at 1440 and 390 px; render and composition timing; burst and volume tests (D-168); security tests (tenant, role, tampered commands, direct database calls, unguarded routes, markup as text) |
| Secondary workspaces | **built** except reconciliation | Claims and policy changes (D-161), the renewal portfolio (D-158) and client investigations (D-167). **Commission reconciliation is not built**: ASAP records no commission statements, receipts or premium payments to compose from, and the surface will not be built on fabricated records |
| UI Lab | **built** (development only) | `apps/web/e2e/lab.html`, the composer's own output at every stage; never bundled |

## 5. Scenarios

| Scenario | Status | Where it is tested |
|---|---|---|
| A Find meaningful work | **built** | `shell.e2e.mjs`: a Work row opens the Living workspace; Home's changes open their work (`living-actions`) |
| B Restore interrupted work | **built** | `living-actions`: the insurer in focus and the open sources survive an update, a trip to Home and back, and a refresh |
| C Insurer response arrives | **built** | `living-actions`: a colleague records the answer while the broker types; the surface reconciles in place and keeps the text |
| D Quotation revision | **built** | Earlier and revised shown side by side, and flagged when after the instruction (unit, `living-actions`) |
| E Missing evidence | **built** | Missing period, premium and cover are stated; unreadable sources are named, never shown as missing (D-157) |
| F Natural-language refinement | **built** | portfolio: `living-portfolio.e2e.mjs`; inside a workspace: `living-servicing.e2e.mjs` (ask, refusal, refresh, whole workspace again), connected `living-focus.test.ts` |
| G Approval requirement | **built** | The bundle is shown in full and approved in place with its frozen hash; a role that may not approve is offered nothing and refused (connected) |
| H Cross-tenant isolation | **built** | Connected tests for workspace, portfolio, Home changes, preferences and claims; browser `living-never-leaks` |
| I Role-specific view | **built** | Blocks removed before sending; audit history only with `audit:view`; commands only for roles that may use them |
| J AI outage | **built** | Composition needs no model; surfaces render with `ai.available: false` |
| K Workflow interruption | **built** | Exception → stopped, the message and what is needed; resume in place when the run allows |
| L Coverage verification | **built** | A request is never cover; no sentence decides cover on a claim (tested) |
| M Mobile | **built** | 390 px in every Living browser suite, with no overflow and reachable scroll regions |
| N Returning from history | **built** | Workspace, exploration and portfolio views are all in the address |
| O Event burst | **built** | Successive inbound answers reconcile without remount or lost text (browser); concurrent saves and handovers stay consistent, email bursts stay within block limits, concurrent reads compose identically, a 150-policy / 250-item client composes under 1.5 s (connected, D-168) |

## 6. Known limitations

- Polling, not push: every 20 s for workspaces, every 60 s for Home, and on focus.
- The portfolio's plain-language refinement is deterministic only; the workspace focus may use the model, but only when no rule matches.
- Claim and endorsement mutations now require `claim:edit` / `policy:edit` in the database and the API (0085, D-164); the earlier membership-only gap is closed.
- Demo mode has no server-composed surfaces.
- Commission and premium reconciliation workspaces are not built: ASAP records no commission statements, receipts or payments to compose from (D-167).
- The model-assisted workspace reading is evaluated offline by its rules; its live evaluation (`WORKSPACE_EVAL_LIVE=1`) needs a configured gateway and has not been run here.
- Interface "learning" is limited to outcomes measured from records (response patterns) and each person's own arrangement; nothing re-orders itself from behaviour.
- From the visual review (D-169): the Work tabs, the "Opening…" header, the orphaned status dot, the recorded-status/next-step wording and the UI Lab fixtures were corrected in D-170. Left as approved: the nine-stage strip scrolls sideways on a phone with no visible cue; the recorded workflow status still changes only when a worker advances the run (the header now says when answers have been recorded since).
- Visual baselines were generated in this environment. A different font rasteriser will need `UPDATE_BASELINES=1` after review.

## 7. Governed actions in the workspace (D-157, D-161)

| Command | Existing endpoint | Offered when |
|---|---|---|
| `workflow_approval.decide` | `POST /workflow-approvals/:id/decide` with the frozen hash | the run waits for approval and the viewer may approve; the bundle is shown in full |
| `quotation.record_delivery`, `quotation.record_response` | `POST /opportunities/:id/actions` | the quotation says the request is at that point and the viewer may edit it |
| `run.follow_up_now`, `move_follow_up`, `escalate`, `pause`, `resume` | `POST /workflows/runs/:id/…` | the run's own intervention list says it is available and the viewer holds `policy:edit` |
| `placement.approve_request`, `placement.record_submission` | `POST /placements/:id/actions` | the placement's own permissions allow it |
| `issuance.approve_request`, `issuance.record_submission` | `POST /placements/:id/issuance/actions` | the issuance's own permissions allow it |
| `claim.receive_document` | `POST /claims/:id/actions` | a document is outstanding and the viewer can act |
| `endorsement.decide_item` | `POST /endorsements/:id/actions` | an item waits for the insurer's written decision and the viewer can act |
| `quotation.confirm_reading` | `POST /opportunities/:id/actions` (`record_response` with `fromProposalId`) | an arrived email was read into a proposal and the viewer may record answers |
| `work.hand_over` | `POST /work-items/:id/hand-over` | the viewer holds `job:edit` and the work is not done |
| `work.acknowledge_handover` | `POST /work-handovers/:id/acknowledge` | the work was handed to the viewer and not yet acknowledged |
| `proposal.save` | `POST /living/:id/proposals` | something is being explored on an open renewal and the viewer holds `job:edit` |

How commands behave:
- **Validation:** the validator holds each command's fixed payload and inputs exactly.
- **Inputs** are never pre-filled with chosen values.
- **Submissions** carry an idempotency key.
- **Results** are the endpoint's own answer. A receipt outlives the block.
- **Open forms** are tied to their command, never to their position.

## 8. Portfolio, Home, exploration

- **Portfolio (D-158):** a typed query, refined by `living/interpret.ts` on top of the current view. It understands windows, grouping, premium change, status, "mine", insurers and classes by the brokerage's own names, "compare A and B" and "clear filters". The renewal premium is read one stated way.
- **Home (D-159):** semantic events since the start of this visit, from colleagues, insurers and ASAP. The viewer's own actions are left out and no figures are shown.
- **Exploration (D-160):** up to three alternatives, from records, labelled hypothetical, kept in the address. It disappears once the client has instructed.

## 9. Verification (full gate on the final stabilization code, D-170)

| Check | Result |
|---|---|
| Typecheck, lint, secret scan | clean |
| Unit | api 937 (3 skipped: live-model runs) · web 194 · schema 118 · workers 25 (10 skipped) · db 3 |
| Build | 6/6 packages; only `VITE_PUBLIC_*` reaches the browser |
| Evaluations, offline | 47 passed (3 skipped: live-model runs). Rules read 100% of their set; every model-path case is proved to bypass the rules |
| Evaluations, live model | **not run** — no provider key in the development environment |
| Connected (real Postgres, PostgREST, RLS) | 251 passed, 1 skipped (the timing test, which runs in the next row) |
| Connected timing, isolated | 24 passed — renewal composition p95 about 0.2 s, portfolio about 0.1 s, a 150-policy client under 1.5 s |
| pgTAP RLS | 1,261 passed |
| Migration release rehearsal | Postgres 16 and Supabase Postgres 17.6: see `docs/release/RELEASE-0079-0091.md` §2, §2a |
| Browser | shell 36/36 · shell-a11y 36/36 · journey 32/32 · supervision 28/28 · onboarding 14/14 · acceptance 8/8 · staging-findings 7/7 · living-lab 36/36 · living-actions 11/11 · living-portfolio 10/10 · living-servicing 10/10 · living-quality 18/18 · first-document 23/23 · quote-comparison 19/19 |
| Visual acceptance | 78 screenshots, 1440 and 390 px (`apps/web/e2e/visual-acceptance.e2e.mjs`) |
