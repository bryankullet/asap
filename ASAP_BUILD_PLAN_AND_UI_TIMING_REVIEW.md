# ASAP — Build Plan and UI Timing Review

Date: 2026-09-10
Commit reviewed: `8a66f0f` on `claude/awaiting-files-md15v3` (product code identical to `main` at `6fcb5a8`)
Nothing was edited, redesigned, refactored or deleted to produce this. No code changes were made.

**Read this with `ASAP_CURRENT_BUILD_AUDIT.md`**, which covers what works when you click it. This document covers a different question: what the written plan says, where the code sits inside that plan, and when the preferred UI should be introduced.

**Three corrections to yesterday's audit, found while reading the migrations properly.** They matter here because they change the timing answer:

1. **Automations has no backend at all.** The audit said `automations` and `automation_runs` tables exist and the list works. They do not exist. `apps/web/src/pages/Automations.tsx` is 24 lines and renders an honest empty state; `AutomationDetail` renders "No automation with that id". No migration, no API route, no schema.
2. **A private storage bucket does exist.** Migration `0012_storage.sql` creates the `insurance-documents` bucket with three RLS policies keyed on the organization folder, and `STORAGE_BUCKET` is in the server env schema. No code reads or writes it — but the foundation is there, which shortens the document phase.
3. **There is no `GET /today` endpoint.** Today is assembled in the browser. This is the most important coupling finding in the whole review and section 3 returns to it.

Two smaller ones: Members *does* have role-change and invitation-revoke controls (`pages/Members.tsx`, `POST /organizations/current/invitations/:id/revoke`), and clients *can* be created — from Ask and from the Files page, with a duplicate-confirm step (`POST /clients`, D-050). The audit understated both.

---

# 1. Original build plan

## 1.1 Every planning document in the repository

Confirmed by `find docs -type f` plus the two root markdown files. There are **no TODO lists in the source code** — the only `TODO` strings in the tree are inside the vendored Python virtualenv at `apps/extractor/.venv/`.

| Document | Lines | What it is |
|---|---|---|
| `docs/ASAP-Architecture-v3.1.md` | 3,837 | The controlling technical architecture. 48 numbered sections. §43 is the phase plan. |
| `docs/ui/screen-map-v1-catalogue.md` | 2,375 | Detailed entry per screen: fields, evidence rules, components. |
| `docs/research/economic-state-machine.md` | 2,343 | Extracted text of the economic research PDF. |
| `docs/PHASE-1-SCHEMA.md` | 625 | The Phase 1 table-by-table schema. |
| `docs/ui-build-spec-v1.md` | 593 | **How the interface actually gets built on this stack.** Part 12 is the build order the code follows. |
| `docs/DECISIONS.md` | 464 | 57 numbered decisions, D-001 to D-057, each dated with a reason. |
| `docs/ui/screen-map-v3.md` | 333 | The current screen map. 60 surfaces, three destinations. Overrides the v1 catalogue. |
| `docs/research/ESM-INTEGRATION-AUDIT.md` | 229 | How the economic model was folded into v3.1. |
| `docs/skill-map.md` | 223 | The Intent & Skill Map, ~150 skills extracted, plus the economic addendum. |
| `docs/PHASE-1-WORK-ORDER.md` | 214 | Nine Phase 1 work items **plus, at the end, the live UI Build Spec progress checklist.** |
| `docs/click-through.md` | 146 | The acceptance document for a deploy: what each seeded user should see. |
| `docs/SECRETS.md` | 139 | Secret handling. Names, not values. |
| `docs/evaluation/SCENARIOS.md` | 96 | Ten economic stress tests as evaluation fixtures. |
| `docs/research/OPERATOR-VALIDATION.md` | 65 | Which numbers are hypotheses and must be configurable. |
| `docs/ui-contract.md` | 48 | The one-page checklist a reviewer holds a screen against. |
| `docs/staging-users.md` | 38 | The staging fixtures. |
| `CLAUDE.md` | root | Working instructions, and its own summary of the stack, the rules and the phases. |
| `docs/ui/prototype/dist/` | — | A built demo. Reference only, never imported. |

Git history is consistent with the plan: 47 commits, each naming the phase or the decision it implements (`feat: UI Build Spec Phase 4 — client files (K01–K02), agreements (G01–G02), the placement gate`), and one branch per phase (`claude/ui-phase0`, `ui-phase1`, `ui-phase2`, `ui-phase4`, `ui-phase5a`, `wi5-rls`).

## 1.2 The full planned product, as written

An AI operating system for a Kenyan insurance brokerage. Each brokerage gets a private workspace over its own clients, policies, documents and email. The employee talks to it; the system generates task-based workspaces and prepares actions for a person to approve. Explicitly not a chatbot on top of insurance software, and explicitly not a menu-driven CRM — §45 rule 16 forbids rebuilding a `Work / Clients / Policies / Renewals / Claims / Money` menu tree.

Underneath the conversation the system tracks one economic unit — a client, a policy, a period of cover — through the states that turn work into cover, commission, cash and a retained client. Economic position is computed from facts and evidence, never stored as a status; the only written record is a verified transition with its evidence.

## 1.3 There are two phase plans, and they are different

This is the single most important planning fact in the repository, and it is not a mistake — it is two layers written at different times for different purposes. But they collide, including on phase numbers.

### Plan A — Architecture v3.1 §43. Thirteen phases.

| Phase | Delivers | Frontend | Backend |
|---|---|---|---|
| 1 Secure brokerage workspace | Organizations, auth, memberships, roles, RLS with worker context, storage security, audit foundation, environment separation, event bus | Plain forms | All of it |
| 2 Records and email | Clients, contacts, insurers, policies, policy documents, imports, duplicate detection, mailboxes, threads, emails, attachments, entity links | Import screens, duplicate resolution, mailbox connection | Schema + ingestion |
| 3 Document intelligence | Private storage and versions, ingestion queue on TS workers, extraction on the Python service, classification, table extraction with page positions, contextual chunking, embeddings, `document_chunks`, hybrid search, `search_documents`, **extraction review interface (required)**, retrieval evaluation harness | Document viewer with page highlights | The whole document stack |
| 4 Experience layer skeleton | `spaces`, `space_blocks`, `jobs`, `job_steps`, `attention_items`, **component registry and UI-plan validator**, realtime channels, streaming protocol, Economic State Service skeleton, `economic_transitions` | The permanent shell, the renderer, system states | The generative substrate |
| 5 Ask ASAP | Model-agnostic gateway, context service, intent router, skill registry, streaming conversation, database tools, agentic retrieval, enforced citations with page highlight, evidence resolution API, routing evaluation set | Conversation surface, citation → page → highlight, read-only Spaces | The AI |
| 6 Work, approvals, controlled actions | Work items, tasks, deadlines, waiting states, exceptions, draft communications, approval requests, tool executor, idempotency, external sending, audit verification | Approval surface with frozen payloads | The action layer |
| 7 Renewals slice | Skills, Renewal and Quote Comparison Spaces, `RenewalReadiness`/`TermComparison`/`InsurerResponseTracker`, renewal Job with external waits, detectors, the 30/60-day automations | Per-slice components | Per-slice skills |
| 8 Claims slice | `claim.*` skills, Claim Space and timeline, missing-document tracking, insurer follow-up, claim-from-email automation | | |
| 9 Quote, placement, underwriting slice | `opportunity.*`, `quote.*`, `placement.*`, `underwriting.*`, insurer response tracking, recorded client decisions | | |
| 10 Servicing slice | `service.*`, `tor.*`, `endorsement.*`, `certificate.*`, Service Request Space, endorsement through to policy update | | |
| 11 Money slice | `money.*`, `commission.*`, Money and Reconciliation Spaces, payment matching, statement reconciliation, debtor follow-up, the M0–M8 chain, `wht_certificates` | | |
| 12 Analysis and management | `analysis.*`, `team.*`, Report/Investigation/Team Spaces, saved and scheduled reports, workload and approval views, `effort_records` | | |
| 13 Full proactivity | Pattern and anomaly detection, portfolio risk, premium leakage, suggested automations, detector tuning | | |

Ordering rule, quoted: *"A slice is not complete until its skills, Space, Job, detectors, automations and evidence paths all work. Half-slices across many lifecycles produce a demo. One complete slice produces a product a brokerage can use on Monday."*

Plan A's shell (§42) is: **Discover · Spaces · Jobs · Automations**, then + New, Search, Profile.

### Plan B — UI Build Spec v1 Part 12. Eight phases.

| Phase | Ships | Previewable |
|---|---|---|
| 0 | `packages/schema` — status, Amount, UiIntent, guards. Ported tests, all failing. | No. This is the contract. |
| 1 | Shell: three destinations, Work's four views, record routes, Ask that only searches. Real Supabase reads, RLS on. | Yes |
| 2 | Work item engine + one workflow end to end: renewal. Draft/send. Runs and the chip. | Yes |
| 3 | Money: X08 components, invoicing, receipts, N01. Reconciliation with the comparison guard. | Yes |
| 4 | Compliance (K01–K03) and the placement gate. Agreements (G01–G02). | Yes |
| 5 | Claims, servicing, TOR, certificates and stock. | Yes |
| 6 | Money out (N02–N04), closure, exceptions. | Yes |
| 7 | Automations, import, investigation and team screens. | Feature complete against v3 |

Plan B's shell (Screen Map v3 §1.1) is: **Today · Work · Automations**, then + New, Search, Profile, with Ask persistent and runs in an Activity chip. Screen Map v3 states it directly: *"The shell does not change. There are still three destinations. Nothing below becomes a fourth."*

## 1.4 Where the plans disagree

Six disagreements, all confirmed by reading both documents.

1. **The shell.** Plan A: Discover · Spaces · Jobs · Automations. Plan B: Today · Work · Automations, with Jobs demoted to an Activity chip and Discover folded into Today. These are different products at the navigation level. **CLAUDE.md repeats Plan A's shell** ("Discover · Ask ASAP · Spaces · Jobs · Automations · Search · + New") while also stating that the architecture wins over the UI documents — so the file that is meant to arbitrate points at the older answer.
2. **Phase numbers collide.** "Phase 4" means the experience-layer skeleton in Plan A and compliance plus agreements in Plan B. "Phase 5" means Ask ASAP in Plan A and claims plus servicing in Plan B. Commit messages and the work-order checklist use Plan B's numbering; the architecture uses Plan A's. This is a live source of confusion in the history and it will get worse.
3. **When Ask becomes AI.** Plan A gives Ask its own phase with a gateway, an intent router and a skill registry. Plan B ships "Ask that only searches" in Phase 1 and leaves the model-backed version blocked on an open decision. The code implements Plan B, exactly.
4. **The generative UI contract.** Plan A specifies `component_definitions` plus a seven-step validator over a registry of ~60 named components (§18). Plan B specifies a narrower `UiIntent` with an `AskComponentId` enum. **Build spec Part 13 item 6 flags this explicitly as unresolved:** *"whether the component registry in Architecture v3.1 collapses into the narrower `UiIntent` in Part 4. These are two different contracts and only one should survive."* It is still open. D-041 was closed by choosing two enums as an interim.
5. **Where the money phase sits.** Plan A puts money at Phase 11, late. Plan B puts it at Phase 3, early, with a hard warning: *"Do not build phase 3 before phase 0. The `Amount` type has to exist before any premium is written to the database."* In practice money has been skipped entirely — see 1.6.
6. **Skill count.** The build spec references an Intent & Skill Map of 163 skills; `docs/skill-map.md` holds ~150 plus the economic addendum, and the work order lists reconciling them as outstanding.

## 1.5 Which documents are the source of truth today

**Documented in the files themselves:**
- Architecture v3.1 wins over everything on the backend model, tenancy, the economic rules and the 17 non-negotiables. CLAUDE.md says so.
- Screen Map v3 wins over the v1 catalogue on screens and vocabulary. It says so in its first line.
- The UI Build Spec wins over `ui-contract.md`. It says so.

**Concluded from the code and the history, not documented anywhere:** the *effective* source of truth for what gets built next is **`docs/ui-build-spec-v1.md` Part 12, tracked as a checklist at the bottom of `docs/PHASE-1-WORK-ORDER.md`**. Every feature commit since `be5f099` names a build-spec phase. Architecture §43 has not driven a commit since Phase 1 finished. Nobody wrote that down, and it is the plan-level gap this review most wants to close.

## 1.6 Does the code still follow the original plan?

**Yes for Plan B, with two documented departures and one silent one.**

- Plan B phases 0, 1, 2, 4, 5a are ticked in the work order and each has a branch and a commit.
- **Phase 3 (money) was skipped.** Documented, with a reason: *"Blocked on spec Part 13 items 1 and 2"* — the levy and duty rates, and the withholding tax rate and scope, both of which need legal confirmation and must live in `company_rules`, never in code (D-027). So phases 4 and 5a were built out of order, ahead of 3.
- **Phase 5 was split into 5a and 5b.** 5a (claims, endorsements) shipped; 5b (TOR, certificates, stock) has not. This split is not in the spec — it was introduced in the work-order checklist. Minor, and honest.
- **The silent departure:** the build spec's own Part 1.1 layout expects `apps/web/src/features/` with one folder per Part 6 workflow. The code has `features/` with only two folders (`drafts`, `work`) and puts the rest in `views/` and `pages/`. Harmless, but the spec and the tree no longer match.

**No for Plan A, and it is not a drift — Plan A's phases 3, 4, 5 and 6 were simply never started.** Documents, the experience layer, Ask ASAP and the approval engine are all unbuilt. What exists instead is Plan B's narrower substitute for phase 6: a work-item engine with named verbs and server-evaluated guards.

---

# 2. What has been built

Built = a real file plus a passing test plus a clicked path. Partly = exists and runs with a named hole. Not started = nothing in the repository.

| Capability | Planned in | Built | Partly built | Not started | Changed from plan |
|---|---|---|---|---|---|
| **Authentication and onboarding** | A1 / B1 | ✅ | | | Onboarding is one screen, not the nine-step §7 sequence |
| **Organizations and permissions** | A1 | ✅ | | | Membership flows became SECURITY DEFINER functions, not API writes (D-024) |
| **Database and insurance records** | A2 / B0 | ✅ core | Insurers and contacts thin | | `policy_periods` chosen for the client-policy-year (D-029, option B) |
| **Economic state and workflow engine** | A4 / A6 | Work engine ✅ | | Economic State Service, `economic_transitions` ❌ | Plan B's work-item engine stands in for the economic layer. No `economic_state` column anywhere — correct |
| **Today** | B1 | ✅ | Ranking is client-side | Discover detectors, weighted scoring ❌ | §27's attention engine became 25 lines in a React component |
| **Work** | B1 | ✅ | | | Four views as specified |
| **Activity and runs** | B2 | Runs + SSE ✅ | Chip broken (count 0) | | |
| **Ask ASAP** | A5 / B1 | Search only ✅ | | Gateway, router, skills, citations ❌ | Deliberately: "In Phase 1 it only searches" |
| **Search** | A30 | | Sidebar link only | Real search ❌ | `pg_trgm` installed, unused |
| **+ New** | A31 | | Non-interactive label | ❌ | Honestly labelled "arrives with import in a later phase" |
| **Clients** | A2 | Create + read ✅ | No edit, no merge | Duplicate detection ❌ | Creation lives in Ask and Files, not a + New flow (D-050) |
| **Policies** | A2 | Read ✅ | 404-then-fallback | Create, edit ❌ | |
| **Renewals** | A7 / B2 | ✅ end to end | | Quote comparison ❌ | |
| **Claims** | A8 / B5a | Engine + panels ✅ | **Cannot register from the UI** | Claim-from-email ❌ | |
| **Quotes** | A9 | | | ❌ | |
| **Placement** | A9 / B4 | ✅ with the file gate | Authority not by sum insured | | `authority_sufficient` still a stub — flagged "must land before production" |
| **Servicing** | A10 / B5 | Panels ✅ | Render below the footer | Create ❌ | |
| **TOR** | A10 / B5b | | | ❌ | Next planned phase |
| **Endorsements** | A10 / B5a | ✅ | Not write-tested | | |
| **Documents and imports** | A2 / A3 | Bucket + policies ✅ | Typed references only | Upload, extraction, chunks, embeddings, review UI ❌ | `client_file_documents.reference` is text a person types |
| **Email** | A2 / A9 | Resend invitations ✅ | `LogMailer` fallback | Gmail/M365, ingestion, sending ❌ | Postmark → Resend (D-046) |
| **Money and reconciliation** | A11 / B3 | | | ❌ | Blocked on legal values, deliberately |
| **Reports** | A12 | | | ❌ | |
| **Team** | A12 | Tables + grants | | All code ❌ | `teams`, `user_team_memberships` untouched by any code |
| **Automations** | A13 / B7 | | **Honest empty screen only** | Tables, engine, authoring ❌ | A primary destination with no backend |
| **AI and RAG** | A3 / A5 | | | ❌ **entirely** | No model SDK in any `package.json`; `vector` installed and unused |
| **Evidence and audit history** | A23 / A40 | `audit_log` ✅, RESTRICT FK | Source chips | Resolution API, citation → page, **any UI** ❌ | |
| **Settings** | A42 | Profile menu ✅ | | Company settings, rules, connections, roles ❌ | |

## Proof for everything marked built

| Capability | Files | Migrations | Routes / endpoints | Tests |
|---|---|---|---|---|
| Auth + onboarding | `pages/SignIn.tsx`, `SignUp.tsx`, `CreateOrganization.tsx`, `lib/guards.tsx`, `routes/me.ts` | 0004, 0029 | `/sign-in`, `/sign-up`, `/onboarding`, `/onboarding/create`, `GET /me`, `POST /organizations` | `guards.test.tsx` (3), `CreateOrganization.test.tsx` (1), pgTAP 0100 |
| Organizations + permissions | `routes/organizations.ts`, `invitations.ts`, `pages/Members.tsx` | 0003, 0005, 0006, 0008, 0014, 0024 | 8 endpoints under `/organizations/current/*`, `/invitations/*` | pgTAP 0100, 0302; api suite |
| Tenancy + RLS | `app.can_access`, every policy | 0011, 0015–0021 | — | pgTAP 0200, 0201, 0202, 0203 — RLS on every table, anon evaluates nothing |
| Insurance records | `packages/db` schema | 0022, 0026, 0028 | `GET /policies/:id`, `GET /clients`, `/clients/:id` | pgTAP 0300, 0304, 0306 |
| Work engine | `api/src/engine/apply.ts` (553 lines), `packages/schema/src/recipes/*` | 0023, 0024, 0025 | `POST /work-items`, `POST /work-items/:id/actions` | `apply.test.ts` (271), `gate.test.ts` (210), `servicing.test.ts` (538), pgTAP 0301, 0303, 0305 |
| Today | `views/TodayView.tsx`, `lib/queries.ts` | 0022 | none — `supabase-js` read | `today.acceptance.test.tsx` (4) |
| Work views | `pages/Work.tsx`, `lib/queries.ts` | 0022 | `supabase-js` | web suite |
| Runs + SSE | `routes/work.ts:716,725`, `shell/ActivityChip.tsx` | 0022, 0024 | `GET /runs/:id/events`, `GET /runs/:id/stream` | api suite; run recovery on boot (D-045) |
| Ask (search) | `routes/ask.ts` (71 lines), `shell/AskComposer.tsx` | — | `GET /ask?q=` | api suite, `intent.test.ts` |
| Renewal | `recipes/renewal.ts`, `features/work/ActionPanel.tsx` | 0023 | `POST /work-items/:id/actions` | `apply.test.ts` |
| Placement + gate | `recipes/placement.ts`, `routes/work.ts:385` | 0026 | `POST /placements` | `gate.test.ts`, pgTAP 0304 |
| Claims + endorsements | `views/ClaimPanel.tsx` (292), `EndorsementPanel.tsx` (305), `recipes/claim.ts`, `endorsement.ts` | 0028 | `POST /claims/:id/actions`, `POST /endorsements/:id/actions` | `servicing.test.ts`, pgTAP 0306 |
| Client files + agreements | `views/ClientFileView.tsx` (258), `pages/Agreements.tsx`, `AgreementVersion.tsx`, `routes/compliance.ts` (460) | 0026 | `GET/POST /clients`, `/clients/:id/file`, `/agreements*` | `files.test.tsx`, pgTAP 0304 |
| Draft / send separation | `features/drafts/DraftCard.tsx` | 0023 | `POST /drafts/:id/copied` | draft test; `sentAt` without evidence is a defect by contract |
| Status vocabulary | `components/status/slots.tsx` (202), `packages/schema/src/status.ts` | — | — | `status.test.tsx`, `banned-components.test.ts` (2) |
| Record composition | `recipes/record.ts` (167), `views/RecordViews.tsx`, `FocusCard.tsx` | — | — | `record.test.ts` (6), `record-composition.test.tsx` (5) |
| Storage foundation | `packages/schema/src/env/server.ts:35` | **0012** | none — bucket unused | — |
| Audit | `audit_log`, RESTRICT FK | 0009, 0030 | none — no UI | pgTAP 0307 (5 assertions) |
| Design system | `packages/ui/src/styles.css` + 9 primitives | — | — | banned-string tests over rendered output |

Whole-suite results, re-confirmed: typecheck 9/9, lint 9/9 with `secret-scan: ok (296 files)`, vitest schema 59 / db 2 / workers 2 skipped / api 89 / web 40, pgTAP on hosted `ALL PASS`.

---

# 3. Current frontend strategy

## 3.1 What the present code is trying to create

Exactly the UI you describe as "preferred". This is the headline of the review and it changes the question you are asking.

`docs/ui-contract.md`, committed 2026-09-08, opens with: *"The visible destinations are Today, Work and Automations, in that order. Ask sits after them and is always available. The Activity chip comes last... New and Search are utilities. Profile stays at the bottom. Internal recipe names and insurance modules (Clients, Policies, Renewals, Claims, Money) are never navigation labels."*

Against your ten stated points: **Today/Work/Automations — already built. + New and Search as utilities — present in the shell, both inert. Ask everywhere — built and docked. Activity for runs — built, chip count broken. Insurance objects contextual, no primary Clients/Policies/Claims/Money/Reports menu — already true, and enforced by a nav-order test. Minimal screens with progressive disclosure — partly: the focus card and per-kind recipe layer (D-057) are exactly this. AI prepares, humans decide — the guard engine does this today, with no AI. Evidence beside facts — source chips only. No automatic external sending — enforced by contract and by test. Nothing removed — nothing has been.**

So the "new UI" is not a replacement of the current direction. It is **the same direction, plus the generative layer that was never built** — Spaces composed by intent rather than record pages composed by kind. The gap between what exists and what you want is one layer, not one product.

## 3.2 Temporary versus permanent screens

**Temporary by design, and documented as such.** `pages/Onboarding.tsx` and `CreateOrganization.tsx` (CLAUDE.md: "Phase 1 UI is plain forms — no Spaces yet"), `pages/Automations.tsx` as an empty placeholder until Plan B phase 7, `pages/AgreementVersion.tsx` and `pages/Members.tsx` as settings screens the architecture puts under Profile/Company, and the `/files` register which Screen Map v3 says is "not a destination".

**Permanent.** The shell itself, Today, Work and its four views, the record route `/r/$recordId`, the Ask dock, the Activity chip, the profile control (C01), and every `packages/ui` primitive. All are named as permanent in Screen Map v3 §1.1.

**Genuinely in between.** `views/RecordViews.tsx` plus `FocusCard` plus the per-kind recipe layer. This is the closest thing in the codebase to a Space, and it is either the foundation of the generative layer or the thing it replaces. Section 5 hinges on this.

## 3.3 How tightly coupled is the frontend to the backend?

**Loosely coupled to endpoints, tightly coupled to table shapes.** Reads do not go through page endpoints at all — `lib/queries.ts` calls `supabase.from("work_items").select(WORK_ITEM_COLUMNS)` with the column list imported from `@asap/schema`. Writes go through 30 named API endpoints in `lib/api.ts`, each parsed against a Zod response schema from the same package.

The consequence for your decision: **you can throw away every page and keep every endpoint**, because the contract lives in `packages/schema`, not in the components. But a new UI inherits the same table shapes unless it adds endpoints.

Total non-test frontend code: **~5,400 lines across 30 files.** The largest single file is 305 lines. This is small enough that "replace the frontend" is weeks, not quarters — a fact that should weigh heavily in section 6.

## 3.4 Which components contain business logic

Ranked by how much would be lost or would have to move.

1. **`views/TodayView.tsx` — the attention engine.** It decides what needs you, computes which third-party checks are due by comparing `task_next_check` to the browser's clock, finds paused and could-not-finish runs, and surfaces orphan runs that have no work item. That is §27's Discover pipeline, in the browser, with the client's clock as the arbiter. **This is the one piece of business logic that must move server-side before any new UI, and it is the only real backend prerequisite in this review.**
2. **`features/work/ActionPanel.tsx` (296 lines)** — assembles action payloads, renders per-step disabled reasons, handles `version_stale`. Guard *evaluation* is server-side; guard *presentation* and payload assembly are here. This is where the claim-period defect lives.
3. **`components/status/slots.tsx` (202 lines)** — enforces that a status word cannot render in the wrong slot, and throws if it does. Correctly placed: it is a contract, shared with `packages/schema`.
4. **`features/drafts/DraftCard.tsx` (150 lines)** — the draft/send separation: copying never creates a sent event, and `sentAt` without evidence is a defect.
5. **`views/ClaimPanel.tsx` and `EndorsementPanel.tsx`** — per-item decisions, effective dating, the three separate settlement facts. Insurance rules, in components.

**Display-only, and cheap to discard:** `WorkCard`, `PolicyView`, `FilesView`, `ClientHeader`, `components/states.tsx`, `AgreementVersion`, and everything in `packages/ui`.

**Already in the right place:** `packages/schema/src/recipes/*` — the step recipes and the record-composition rules (`RECORD_SECTIONS`, `GUARD_BLOCKERS`, the `HEADLINES` phrasebook, `focusCard()`) live in the shared package and are imported by **both** the API (`routes/work.ts` calls `claimSteps`, `endorsementSteps`, `renewalSteps`, `placementSteps`) and the web app. A new UI keeps all of it for free. This was the single best structural decision in the build.

## 3.5 Can the frontend be replaced without changing the backend?

**Yes, with one exception and one caveat.**

- The exception is Today's ranking (3.4 item 1). A generated-Space UI cannot re-implement the attention engine in the browser a second time.
- The caveat is that three endpoints are page-shaped rather than capability-shaped and would want revisiting: `GET /clients?view=blocking` (a view parameter named after a screen), `GET /agreements`, `GET /policies/:id`. They work; they are just not what §42 asks for.

Everything else — the engine, the guards, the runs, the audit, RLS, the invitation flow — is UI-agnostic.

## 3.6 What frontend work would be wasted if you replaced it now

**Genuinely wasted:** the 30 page and view files' layout code, and most of the 40 web tests, which are written against current markup. Call it 3,000–4,000 lines.

**Not wasted, and this is most of the recent work:** `packages/ui` (the whole D-056 design port — tokens, 9 primitives, the status pill), `packages/schema` recipes including the D-057 composition rules, `lib/api.ts`, `lib/queries.ts`, `lib/guards.tsx`, `components/status/slots.tsx`, the banned-string tests, and the shell's nav contract. The two most recent commits (D-056 restyle, D-057 focus card) land almost entirely in the keep column — the tokens and primitives are exactly what a component registry renders with, and the recipe layer is exactly what a Space recipe composes.

**Assumption, flagged:** this assumes the new UI keeps the four-layer status vocabulary and the Figtree/Outfit navy-green-gold palette. If it does not, `packages/ui` and the status contract go too, and the waste roughly triples.

## 3.7 What backend work depends on the current UI structure

Very little, and none of it structural: the three page-shaped endpoints in 3.5, and `/ask` returning a `UiIntent` whose `panel` field is an `AskComponentId` — which already presumes a component registry that does not exist yet. That field is a hook for the new UI, not an obstacle.

## 3.8 UI decisions that have already become API or database assumptions

These are the ones to be deliberate about, because they are in migrations and in live rows.

1. **`work_items.steps` is a JSON list of steps, each with its own actions and `disabledReason`.** The record page renders it directly. A Space that composes blocks by intent still has to consume this shape, or the engine changes.
2. **`work_items.task_status` stores the visible four-layer task vocabulary** (`needs_you`, `with_party`, `in_progress`, `done`). The UI's words are the database's enum. Renaming a label is a migration.
3. **`work_items.task_next_check` exists because Today has a "Checks due" section.** A screen created a column.
4. **`work_items.reason` — the "Why is this here?" text — is stored per row**, not computed. Ranking explanations are data.
5. **`client_file_documents.reference` is text a person types**, with a constraint that a received document must carry one. That is a UI decision (no upload yet) hardened into a check constraint. When real uploads land, that constraint needs revisiting.
6. **Drafts: `sentAt` requires evidence.** A contract rule, enforced in schema and test.
7. **No `economic_state` column exists.** The plan's most important prohibition was respected. Worth saying out loud, because it is the assumption that would have been most expensive to unwind.

---

# 4. Current backend strategy

## 4.1 What the backend is ultimately for

Per Architecture §42: *"APIs are organised by capability, not by screen: `/intent`, `/spaces`, `/jobs`, `/automations`, `/attention`, `/search`, `/evidence`. There is no `/clients-page` endpoint, because there is no clients page."* Plus §46's API surface and the simplicity constraints the backend must uphold — every list endpoint returns a ranked, capped default; the backend never returns "everything about this entity".

**None of those seven endpoints exists.** The backend that exists is organised by insurance capability instead: `/work-items`, `/claims`, `/endorsements`, `/placements`, `/clients`, `/agreements`, `/policies`, `/runs`, `/ask`, `/me`, `/organizations`. That is much closer to §42's intent than a screen-shaped API, and it is a reasonable staging post — but it is not the target shape.

## 4.2 What already supports a generated, intent-driven UI

More than you would expect. This is the good news in the review.

- **A finite action vocabulary.** Named `ActionVerb`s and named `GuardId`s, evaluated server-side. §18's rule that the model may only propose actions from a fixed list is already enforceable, because the list exists (`packages/schema/src/actions.ts`).
- **Guards return their own reason text.** `Not yet: We cannot instruct cover for a client whose file is not complete...` comes from the server. A generated block can render a blocker without inventing prose.
- **Progress is derived, never authored.** Steps come from `recipes/*` and run state comes from `runs`. §45 rule 10 is structurally satisfied.
- **`UiIntent` exists and is strict.** Generated with Zod 4's native `z.toJSONSchema` (D-037), proven to be closed at every level, every field required, `maxItems: 4`. The pipe for "model returns a plan, server validates it" is already laid.
- **Recipes are shared, not per-screen.** Both API and web import them.
- **Runs stream over SSE**, which is why the API is Node rather than an edge function.
- **Permissions and organization resolve server-side on every request.** §34's "filter before it reaches the browser" is possible today; there is simply nothing to filter yet.
- **Audit is complete and immovable** (RESTRICT since 0030), so §40 holds under a new UI.

## 4.3 What assumes fixed pages

- `GET /clients?view=blocking` — a parameter named after a screen.
- `GET /agreements` and `GET /policies/:id` — entity reads with no ranking or cap, which §42's simplicity table asks every list endpoint to have.
- **All list reads bypass the API entirely** and go straight to PostgREST from the browser with `.limit(100)`. That is RLS-safe and fast, but it means the backend cannot rank, cap, summarise or permission-filter a list — the four things §42 says it must do. **This is the deepest structural mismatch between the current backend and the intended UI**, and it is a bigger deal than any page file.

## 4.4 Are records, actions, evidence, permissions and runs separated cleanly enough for a different UI?

Three of five: yes. Two: no.

| Concern | Clean? | Why |
|---|---|---|
| **Records** | Yes | Tables plus shared column contracts. Any UI can read them. |
| **Actions** | Yes | One engine, named verbs, named guards, optimistic concurrency, API-only writes gated by a hashed key (D-042). Genuinely UI-agnostic. |
| **Runs** | Yes | Own tables, own stream, boot recovery. |
| **Evidence** | **No** | Evidence is per-feature columns (`claim_documents.reference`, `agreement_versions.clause_reference`, override reasons). §23's resolution API — one endpoint that turns any cited fact into a document, page and highlight — does not exist, and cannot until documents do. |
| **Permissions** | **Partly** | Resolved server-side, correctly. But never used to *remove blocks from a plan before it reaches the browser* (§34), because there are no plans. Today a restricted screen renders a notice client-side, which is render-then-explain, not filter-before-send. |

## 4.5 What backend changes generated Spaces would need

In dependency order, with an honest size on each. **Assumption:** these are my estimates from reading the code, not a written plan.

1. **An attention endpoint** — move `TodayView.tsx`'s ranking server-side, ranked, capped, with the reason. Small, additive, and needed regardless of which UI you choose.
2. **A ranked, capped list endpoint** for Work's four views, so the browser stops selecting 100 rows and deciding. Small.
3. **`component_definitions`** plus a props-schema-per-component migration, and the seven-step validator from §18/Part 4.2. Medium — and blocked on Part 13 item 6, which contract survives.
4. **`spaces` and `space_blocks`** with versioned block storage, so a Space rendered in 2026 still renders in 2028. Medium.
5. **The AI gateway and intent router**, model-agnostic per §45 rule 3. Large, and the only truly large item.
6. **An evidence resolution API** (§23). Blocked on the document phase.
7. **`/search`** beyond `ilike` on titles — `pg_trgm` is installed and waiting.

## 4.6 Would changing the UI now require database or API changes?

**No database changes at all.** I checked every migration: nothing in the schema is page-shaped except the two soft cases in 3.8 (`task_next_check`, and the `reference` check constraint), and neither blocks a new UI.

**Two API additions, both purely additive:** items 1 and 2 above. Nothing needs to be removed or renamed, so old and new UI can run side by side against the same API. That is the technical fact that makes gradual migration safe.

---

# 5. Three timing options

## Option A — Change the UI now, replacing the structure before continuing the later phases

| | |
|---|---|
| **Benefits** | One UI to build against for every remaining phase. Money, TOR and reporting get built once, in the target shape. No second migration later. The generative contract gets exercised early, when there are only five record kinds to satisfy instead of twenty. |
| **Risks** | You would be building the renderer for a plan-producer that does not exist — no gateway, no model decision, no `component_definitions`. That means hand-authoring plans as a stand-in, which is a second temporary UI wearing the target's clothes. Part 13 item 6 is still open, so you might build the wrong contract. And it stops insurance delivery cold: Phase 5b, money, and the two "must land before production" items all wait. |
| **Repeated work** | High if item 6 resolves the other way — the registry and validator get rebuilt. The 40 web tests get rewritten now and again when Spaces actually generate. |
| **Effect on backend** | Forces items 1–4 of 4.5 immediately, including the two blocked on an open decision. Blocks the insurance backend for the duration. |
| **Effect on testing** | Worst of the three. Acceptance tests (`today.acceptance.test.tsx`, `docs/click-through.md`) are written against current markup and would all be rewritten before the new markup is settled. You would lose your regression net at the moment you most need it. |
| **Delivery speed** | Slowest to the next usable thing. Nothing new for a brokerage for weeks. |
| **Migration difficulty** | Moderate — the frontend is only 5,400 lines. The difficulty is not the code, it is deciding the contract under time pressure. |
| **Files changed** | All 30 files in `apps/web/src/pages` and `views`, `router.tsx`, `Shell.tsx`, most of the 40 tests, `docs/click-through.md`. Kept: `packages/ui`, `packages/schema`, `lib/*`. |
| **Phases affected** | Delays B5b, B3, B6, B7 and both production blockers. Pulls A4 forward out of order. |

## Option B — Build the backend first, replace the UI later

| | |
|---|---|
| **Benefits** | Insurance delivery continues uninterrupted: 5b, then money once the legal values land, then the production blockers. The generative contract gets decided with more evidence. Each phase stays previewable, which is the property Part 12 was designed around. |
| **Risks** | The one that actually bites: **every new phase adds more UI in the old shape, so the eventual replacement gets bigger every week.** Money (B3) alone is X08 components, invoicing, receipts, N01 and reconciliation — a large surface built twice. It also lets more UI decisions harden into the database, as `task_next_check` already did. And "later" has a way of not arriving. |
| **Repeated work** | Highest of the three, and it grows with time. Every screen from 5b, 3, 6 and 7 is built once in record-page form and once as a Space. |
| **Effect on backend** | Best in the short run — no distraction. Worst in the long run: nothing forces items 1–2 of 4.5, so list ranking and attention stay in the browser and the mismatch in 4.3 deepens. |
| **Effect on testing** | Comfortable now, painful later. You accumulate acceptance tests against markup you have already decided to discard. |
| **Delivery speed** | Fastest to the next insurance capability. Slowest to the intended product. |
| **Migration difficulty** | Grows monotonically. Today it is 5,400 lines; after money and 5b it is plausibly double. |
| **Files changed** | None now. Everything later. |
| **Phases affected** | None delayed. All of them made more expensive. |

## Option C — Introduce the permanent shell now, migrate Spaces gradually

| | |
|---|---|
| **Benefits** | The shell is **already the target shell** — Today/Work/Automations, Ask everywhere, Activity, no insurance menu, all enforced by a nav test. So the expensive half is done and paid for. Adding the component registry as a *rendering* layer over the existing record composition is additive: `RECORD_SECTIONS` becomes a Space recipe, `focusCard()` becomes a block, and each record kind moves when its slice is next touched anyway. Old and new render paths coexist behind one route, so nothing is removed and no functionality regresses. It also forces the two backend fixes (attention, ranked lists) that are needed under every option. |
| **Risks** | Two render paths for a while, which is real complexity and needs a written end date or it becomes permanent. A registry built before the model exists could still guess wrong on Part 13 item 6 — mitigated by deriving `ComponentId` from `component_definitions` rather than hand-writing the enum, as D-037 already recommends. |
| **Repeated work** | Lowest. Each record kind is migrated once, during work already scheduled for it. The design tokens, primitives, recipes and status contract are reused rather than rebuilt. |
| **Effect on backend** | Best shape. It sequences 4.5 items 1–4 in dependency order and leaves item 5 (the gateway) until its own decision is made, without blocking anything. |
| **Effect on testing** | Best. Existing tests keep passing because the old path stays until its kind migrates. New Space rendering gets its own tests. `docs/click-through.md` stays valid as the acceptance document throughout — which is exactly what you built it for. |
| **Delivery speed** | Slightly slower than B for the next capability, far faster than A to the intended product. |
| **Migration difficulty** | Lowest, because it is spread across work already planned. |
| **Files changed** | Additive first: a new migration for `component_definitions`, a validator in `apps/api`, an attention endpoint, a registry renderer in `apps/web/src/components`. Then one existing view per record kind, on its own schedule. `router.tsx` and `Shell.tsx` barely change. |
| **Phases affected** | B5b and beyond ship into the new layer instead of the old one. No phase is delayed by more than its own migration step. |

---

# 6. Recommendation

## Introduce it gradually — Option C — starting now, with three things stabilised first.

**Why, in order of weight.**

1. **You are not replacing the frontend. You are completing it.** Every item in your ten-point UI direction except progressive disclosure and evidence-beside-facts is already built and already tested. `docs/ui-contract.md` and `docs/ui/screen-map-v3.md` describe your preferred UI, in this repository, from 8 September. Option A's framing — "replace the current frontend structure" — would discard work that already points where you want to go. The real gap is one layer: generated Spaces instead of per-kind record pages.
2. **Option B's cost compounds and Option A's does not pay off yet.** Money (B3) is the largest remaining UI surface. Building it as record pages and then again as Spaces is the single most expensive thing on the table. But building the renderer *first* means building it for a plan-producer that does not exist, with an unresolved contract — so you would be guessing.
3. **The backend is unusually ready for this, and the audit proves it by running.** Named verbs, server-evaluated guards that return their own reason text, derived progress, a strict `UiIntent`, shared recipes, complete audit, RLS on everything. Section 4.2 is a longer list than I expected to be able to write.
4. **The frontend is small — 5,400 non-test lines.** Gradual migration is cheap here in a way it would not be in a large app. The argument for a big-bang rewrite is weakest precisely when the code is this small and this well-factored.
5. **One backend fix is required under every option**, so doing it now costs nothing: Today's attention ranking must move out of the browser. It is business logic in a React component, it uses the client's clock to decide which third-party checks are due, and it is §27's Discover pipeline in the wrong place.

## What must be stabilised before the change begins

Three things, all small, none of them new work:

1. **The six confirmed defects from the audit** — the claim period, the servicing panel's position, the Activity chip's count, the dead `#record-activity` link, the stale Ask error, the policy 404. Migrating a broken path preserves the break and makes it harder to see. This is roughly a day.
2. **Build spec Part 13 item 6 — decided in writing.** Does the §18 `component_definitions` registry survive, or does it collapse into the narrower `UiIntent`? *"These are two different contracts and only one should survive."* Everything in step 3 of the sequence below depends on this answer. It needs no code, only a decision and a D-058 entry.
3. **Which model powers Ask** — the other half of item 6. Not needed to start, but needed before step 6, and it gates §45 rule 3 (model-agnostic through a gateway).

## And to answer the question as you framed it

You asked, if I recommend waiting, for the precise backend milestone. **I do not recommend waiting for the shell and the registry — those can start now.** But the *generative* half has one precise gate: **`component_definitions` exists with a props schema per component, and the seven-step validator in §18/Part 4.2 passes its own tests, before any model output reaches a renderer.** Until that gate is met, plans are authored by our own code, never by a model. That is §45 rules 9 and 11, and it is the line that must not be crossed early.

---

# 7. Proposed integration sequence

Nothing below is implemented. Each step is independently shippable and each ends somewhere previewable on Render, per Part 12's own rule.

### Step 1 — Fix the six audit defects

- **Changes:** `views/ActionPanel.tsx` (claim period into the payload), `pages/Record.tsx` (servicing above the footer), `shell/ActivityChip.tsx` (the count), `views/RecordFooter.tsx` (`#record-activity` target or remove the link), `shell/AskComposer.tsx` (clear the error on success), the policy read path.
- **Untouched:** every migration, every API endpoint, the shell, `packages/ui`.
- **Depends on:** nothing.
- **Tests:** a regression test per defect; the existing 40 web tests must still pass unchanged.
- **Risk of breaking things:** low. Six local changes with tests.
- **Rollback:** yes, per commit.

### Step 2 — Move attention ranking server-side

- **Changes:** a new `GET /attention` (ranked, capped, each item carrying its reason) that takes over what `views/TodayView.tsx` computes; `TodayView` becomes display-only. The server's clock decides which checks are due, not the browser's.
- **Untouched:** the database, all other endpoints, the shell, the record pages.
- **Depends on:** step 1 only for tidiness.
- **Tests:** port `today.acceptance.test.tsx`'s four cases to the endpoint, and keep the view test with fixtures. `docs/click-through.md` is the acceptance check — Amina's five cards with the same status words and reasons.
- **Risk:** medium — Today is the first screen every user sees, and the ranking must not change while moving. Mitigate by asserting the endpoint reproduces the current output on the seeded data before switching the view over.
- **Rollback:** yes. Keep the client-side path behind a flag for one deploy.

### Step 3 — Ranked, capped list reads through the API

- **Changes:** Work's four views read a ranked, capped endpoint instead of `supabase.from("work_items").limit(100)`.
- **Untouched:** the database; `supabase-js` stays for single-record reads for now.
- **Depends on:** step 2's ranking helpers.
- **Tests:** the four view tests, plus a new one proving a hidden row never appears in a count (the ui-contract rule).
- **Risk:** medium — this is the first time the API mediates a list, so RLS must be re-proven through the new path. It cannot be proven in this container; it needs hosted verification as each of the eight seeded identities, exactly as D-055 did.
- **Rollback:** yes, per view.

### Step 4 — `component_definitions` and the validator, with nothing rendering through them yet

- **Changes:** one new migration for `component_definitions` (id, version, props schema, RLS); the seven-step validator in `apps/api`; `ComponentId` derived from the table instead of hand-written (closing D-037's open note).
- **Untouched:** every screen. Nothing renders through the registry in this step.
- **Depends on:** **the Part 13 item 6 decision.** Do not start this step without it.
- **Tests:** a validator test per step of the seven, including that a component missing from the registry is rejected and an invented business value is refused.
- **Risk:** low — additive, and no screen depends on it yet.
- **Rollback:** the code yes; the migration is append-only, so a follow-up migration, never an edit.

### Step 5 — One record kind renders as a Space, behind the same route

- **Changes:** a registry renderer in `apps/web/src/components`; `RECORD_SECTIONS` for **one** kind (renewal — it is the most complete and the best tested) expressed as a Space recipe; `/r/$recordId` chooses the new path for that kind and the old path for the rest.
- **Untouched:** the other four record kinds, the shell, the engine, every guard.
- **Depends on:** step 4.
- **Tests:** the renewal record test must pass against both paths. The banned-string tests must pass over the new rendered output — that is the rule that keeps status words in their slots.
- **Risk:** medium, and contained to one kind. If it goes wrong, one record type is affected and the flag flips back.
- **Rollback:** yes — one boolean.

### Step 6 — Migrate the remaining kinds, each with its own slice

- **Changes:** placement, claim, endorsement, policy move one at a time, each during work already scheduled for it. TOR and certificates (B5b) are **built directly as Spaces** and never as record pages — this is where Option C starts paying.
- **Untouched:** any kind not yet migrated.
- **Depends on:** step 5 proving out.
- **Tests:** the existing per-kind tests, unchanged in intent, re-pointed at the new path. `docs/click-through.md` re-run on hosted after each kind.
- **Risk:** low per step, because the pattern is proven and the blast radius is one kind.
- **Rollback:** yes, per kind.

### Step 7 — The AI gateway and intent router, read-only

- **Changes:** the model-agnostic gateway (§15), the intent router (§16), Ask returns a validated `UiIntent` from a model instead of from an `ilike`. Ask stays read-only: it opens and prepares, and it cannot send, bind, pay, clear a file, issue a certificate or approve anything — enforced at validation step 6 regardless of what the prompt produced.
- **Untouched:** every write path, every guard, the engine, the audit.
- **Depends on:** step 4's validator, and the model decision.
- **Tests:** a routing evaluation set (§43 phase 5 requires one), plus a test that a plan naming a record the caller cannot read returns the fallback and does not reveal that the record exists.
- **Risk:** highest in the sequence, and the reason it is last. Mitigated by read-only scope and by the validator standing between the model and the renderer.
- **Rollback:** yes — Ask falls back to search, which is a strict subset of the same response shape.

### Step 8 — Retire the old render path

- **Changes:** delete the per-kind record page code once every kind has migrated and one full `docs/click-through.md` pass is green on hosted.
- **Untouched:** `packages/ui`, `packages/schema`, `lib/*`, the shell — none of which were ever on the old path.
- **Depends on:** step 6 complete.
- **Tests:** the full suite plus pgTAP plus the click-through document.
- **Risk:** low by then, high if done early. **Do not do this step before step 6 finishes** — the two paths coexisting is the safety property of the whole plan.
- **Rollback:** by revert, until the commit is old. Write the end date down when step 5 lands.

**One thing this sequence deliberately does not touch:** documents, extraction, chunks and embeddings — Plan A phase 3. Evidence-beside-facts and citation-to-page cannot be finished without it, and it is a phase, not a step. It should be planned separately and not folded into a UI migration.

---

# 8. Final answer

### 1. Current planned phase

**UI Build Spec v1 Phase 5b** — TOR, certificates and stock (spec 6.4, 6.5, T01–T02). Phase 5a closed on 2026-09-09. Phase 3 (money) remains deliberately skipped, blocked on spec Part 13 items 1 and 2 (levy and duty rates; WHT rate and scope), because those are legal values that must live in `company_rules` with a source, never in code.

Against Architecture v3.1 §43 the position is different and worth stating plainly: **Foundation phase 1 complete, phase 2 partly complete (records yes; email, mailboxes and imports no), phases 3, 4, 5 and 6 not started.** The vertical slices are being delivered ahead of the foundation they were planned to sit on. That is a real inversion, and it is why the AI and document layers feel so far away.

### 2. Percentage of the full plan actually implemented

Three honest measures, because one number would mislead:

| Measured against | Implemented | How counted |
|---|---|---|
| **UI Build Spec v1** (8 phases) | **~60%** | Phases 0, 1, 2, 4, 5a done; 5b, 3, 6, 7 not. Weighted for 5a being half of 5. |
| **Screen Map v3** (60 surfaces) | **~25%** | About 15 surfaces built: Today, Work, Ask (search only), Activity, five record kinds, K01, K02, G01, G02, C01, A01-as-empty. |
| **Architecture v3.1** (13 phases) | **~20%** | Phase 1 complete; phase 2 about half; phases 7–10 partly delivered early through Plan B; phases 3, 4, 5, 6, 11, 12, 13 not started. |

**The most useful single number is ~20–25% of the intended product**, because the unbuilt part contains the three largest and least-started systems — documents, the experience layer, and AI — and one of them (AI) has not a single line of code anywhere in the repository.

### 3. Next planned phase

Phase 5b (TOR, certificates, stock). Two items in the work order are marked **must land before production** and are not in any phase:

- **Placement authority by sum insured and class.** `authority_sufficient` is still a stub, so today any member who can approve at all can approve any sum insured. This is the most serious open functional risk in the product.
- Audit-log survival — already done in migration 0030.

### 4. Best time to introduce the new UI

**Now, gradually — Option C.** Not because the current UI is finished, but because the shell you want already exists and is already tested, and the missing piece is one layer rather than one product. Waiting makes the migration bigger every week, chiefly because money is the largest remaining UI surface and would otherwise be built twice.

### 5. What should be changed first

1. The six audit defects (a day's work).
2. **Build spec Part 13 item 6, decided and written as D-058** — registry or `UiIntent`, one survives. No code; this is a decision.
3. Today's attention ranking moves server-side, out of `views/TodayView.tsx`.
4. Then, and only then, `component_definitions` plus the validator.

### 6. What should not be touched yet

- **The work-item engine, its verbs and its guards.** `apps/api/src/engine/` is the most valuable and best-tested code in the repository, and it is UI-agnostic. A UI migration must not open it.
- **Every migration.** Append-only. Nothing in this plan needs a schema change, and the two soft UI-shaped columns (`task_next_check`, the `reference` check constraint) should be left until documents land.
- **`packages/ui` and `packages/schema`.** They are the parts that survive the migration. Touching them now risks the one thing that is genuinely reusable.
- **The four-layer status vocabulary and its slot enforcement.** If this is reopened, `packages/ui`, the database enum and every test go with it.
- **RLS, the hashed API-key gate, the audit log.** Nothing in a UI change has any business near them.
- **The old record-page path** — until step 6 finishes. Two coexisting paths is the safety property, not an untidiness to clean up early.
- **Documents and extraction.** A phase, not a step. Do not fold it into the UI work.

### 7. Main risks

1. **The two plans are still both live, and CLAUDE.md points at the older shell.** Until one is named as the source of truth for phase order, every future session can reasonably pick either. This is the highest-probability risk in the review, and the cheapest to fix.
2. **Part 13 item 6 unresolved.** Building the registry against the wrong contract is the one expensive mistake available in this sequence.
3. **Placement authority is not enforced by sum insured.** A live functional hole flagged for production, unrelated to the UI, and it should not be allowed to slip behind a UI migration.
4. **Two render paths outliving their welcome.** Write the retirement date down at step 5.
5. **The AI layer is not started at all** — no SDK, no gateway, no model decision, no evaluation harness. Every remaining architecture phase depends on it. Its size is currently unestimated, and that is the largest unknown in the plan.
6. **Documents are the hidden critical path.** Evidence-beside-facts, citation-to-page, extraction review, RAG and the money phase's receipts all wait on Plan A phase 3, which has one migration written (the storage bucket, 0012) and nothing else.
7. **The container cannot verify hosted RLS in the browser path** (D-031). Steps 3 and 6 need hosted verification as each of the eight seeded identities, which is manual work that must not be skipped.
8. **Client-side ranking and 100-row list reads** mean the backend currently cannot rank, cap, summarise or permission-filter a list — the four things §42 says it must. Step 2 and step 3 exist to close this, and if they are skipped the new UI inherits the problem.

### 8. The exact next prompt to give Claude Code after reviewing this report

> Two decisions and one fix, then stop.
>
> 1. Resolve UI Build Spec v1 Part 13 item 6 and record it as D-058: does the Architecture §18 `component_definitions` registry survive, or does it collapse into the narrower `UiIntent` in Part 4? Read both contracts, state the trade-off in plain English, recommend one, and write the decision with the reason. Then reconcile the phase plans: name in `docs/PHASE-1-WORK-ORDER.md` which of Architecture §43 and UI Build Spec Part 12 is the source of truth for build order, and correct the shell described in `CLAUDE.md` so it matches Screen Map v3's three destinations, noting that the architecture still wins on the backend model and the non-negotiables. Do not renumber any existing phase.
> 2. Fix the six defects from `ASAP_CURRENT_BUILD_AUDIT.md` — the claim policy period never reaching the act payload, the servicing panel rendering after the record footer, the Activity chip counting zero with failed runs present, the dead `#record-activity` link, the stale Ask error surviving a successful ask, and the 404 on every policy open. One commit per defect, a regression test for each, and no change to the engine, any migration, or `packages/ui`.
> 3. Do not start the component registry, the attention endpoint, or any UI migration. Report the D-058 recommendation and the six fixes, then stop.
