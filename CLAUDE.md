# CLAUDE.md

Instructions for Claude Code working in this repository. Read this first, every session.

---

## What ASAP is

A multi-tenant AI operating system for insurance brokerages. Each brokerage ("organization") gets a private workspace over its own clients, policies, documents and email. The user talks to it; the system generates workspaces ("Spaces") and prepares actions for approval. It is **not** a chatbot bolted onto insurance software, and it is **not** a menu-driven insurance CRM.

The controlling reference is `docs/ASAP-Architecture-v3.1.md`. When this file and the architecture disagree, the architecture wins — tell the user, don't silently pick one.

**The hierarchy of truth** (architecture §0). Three documents, one model, five layers:

```
Economic model     docs/research/…Economic-State-Machine.pdf + architecture §3A, §8A, §8B, §24A
                   "What is happening to business value?"
Intelligence model docs/skill-map.md + architecture §3, §16, §17, §3B
                   "What needs to happen next, and which capability can do it?"
Experience model   architecture §18, §25, §26, §27, §36 + docs/ui
                   "What should the employee see and do?"
Execution model    architecture §15, §20, §21, §28, §29, §45
                   "How does ASAP safely perform it?"
Evidence + audit   architecture §23, §40 + audit_log, events
                   "How do we prove what happened?"
```

Underneath the conversation, ASAP tracks one **economic unit** — a client, a policy, a period of cover — through the states that turn work into cover, commission, cash and a retained client. User intent is the human interaction model; economic state is the business operating model. Do not confuse them, and do not show the second to the user.

**Economic-model rules that bite in code** (architecture §3A, §3B; D-027, D-028, D-029):
- Economic position is a **vector of dimensions computed from facts and evidence**, never a stored status. There is no `economic_state` column or enum, anywhere. The only written record is `economic_transitions`: a verified transition with its evidence.
- The model may explain, detect, recommend and prepare. It may not set, infer or invent a state value. Same rule as workflow status, one level down.
- The eight economic states and the S/M codes **never appear in UI copy, tooltips or alt text**. Spaces speak plain brokerage language from the recipe phrasebook.
- Kenyan legal and market values (commission deadline, document clock, WHT rate, class caps, claims reference) are **per-organization `company_rules` with a source and a verified-at date**. Never a constant.
- Anything the research labels a hypothesis (staff hours, conversion, waiting times, service-load thresholds) is configurable, measured, or displayed as an estimate with its basis — see `docs/research/OPERATOR-VALIDATION.md`.
- The client-policy-year representation is decided in D-029 **before any Phase 2 schema is written**.

**Insurance terms you will meet:**
- **Policy** — the insurer's contract with the client.
- **Placement** — the broker's record of arranging cover with an insurer. The broker creates this; the insurer issues the policy.
- **Endorsement** — a mid-term change to a policy (add a car, raise a sum insured). Generates its own premium adjustment.
- **TOR** — Time on Risk. Cover is live before the policy is formally issued or paid. Has an expiry date and must be tracked.
- **Levy** — a statutory charge added on top of premium (training levy, policyholder compensation fund). Not the broker's money.
- **Binder** — delegated authority letting the broker commit the insurer to cover.
- **Loss ratio** — claims paid ÷ premium earned. Drives renewal pricing.
- **Client-policy-year** — one client, one policy, one period of cover. The primary economic unit (architecture §3A). Representation pending D-029.
- **WHT** — withholding tax deducted from commission before it reaches the broker. A tax credit, not a cost, but it changes the cash received and needs a certificate.

---

## Stack

| Layer | Choice |
|---|---|
| Repo | pnpm workspaces + Turborepo, single monorepo |
| Frontend | React + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query + React Hook Form + Zod, PWA |
| API | Hono on Node — AI gateway, intent router, skills, REST. Chosen for server-sent events. |
| Database | Supabase / PostgreSQL / pgvector / Postgres full-text search |
| Auth & storage | Supabase Auth, Supabase Storage (private buckets) |
| Migrations | Supabase CLI, SQL files committed to the repo |
| User-path data access | `supabase-js` — RLS applies |
| Worker data access | Drizzle, service connection, after organization context is set |
| Background work | Supabase Queues + Node/TS workers; one Python extractor service |
| Email | Gmail OAuth, Microsoft 365 OAuth, Resend for platform transactional mail (D-046) |
| Testing | Vitest (TS), pgTAP (RLS policies, against a real database) |
| Monitoring | Sentry, PostHog, structured logs |

**Automation is built inside ASAP. No n8n. Ever.**

---

## Repository layout

```
apps/
├── web           React PWA
├── api           Hono service — gateway, intent router, skills, REST
├── workers       Node/TS queue consumers — jobs, detectors, automations
└── extractor     Python service — document text, tables, page positions
packages/
├── schema        Zod definitions: component props, tool arguments, API contracts
├── db            Drizzle schema + generated types
└── ui            Component library implementing component_definitions
supabase/
├── migrations/   Numbered SQL files. RLS policies live here, not in a dashboard.
├── tests/        pgTAP tests
└── seed.sql      Two-brokerage fixture
docs/
├── ASAP-Architecture-v3.1.md
├── PHASE-1-WORK-ORDER.md
├── PHASE-1-SCHEMA.md
├── SECRETS.md
├── DECISIONS.md
├── skill-map.md               Intent & Skill Map + economic purpose addendum
├── research/
│   ├── ASAP-Kenyan-Insurance-Brokerages-Economic-State-Machine.pdf   the economic model (source)
│   ├── economic-state-machine.md                                     its extracted text
│   ├── ESM-INTEGRATION-AUDIT.md                                      how it was integrated into v3.1
│   └── OPERATOR-VALIDATION.md                                        hypotheses, thresholds, legal values
├── evaluation/
│   └── SCENARIOS.md           ten economic stress tests as evaluation fixtures
└── ui/
    ├── spec.txt                113 screens
    ├── ASAP-UI-Changes.md      change list on top of the spec
    └── prototype/              static demo — reference only, never imported
```

`packages/schema` is load-bearing. Every shape that crosses a boundary is defined once in Zod, then derived: runtime validation in the API and the UI-plan validator, TypeScript types for the frontend and workers, JSON Schema (via `zod-to-json-schema`) for `component_definitions.props_schema`. **Never hand-write a type that duplicates a Zod schema.** If the frontend renderer and the server validator drift, the mismatch surfaces at runtime instead of build time, which is the failure this package exists to prevent.

---

## Commands

```bash
pnpm install                       # bootstrap
pnpm dev                           # all apps, watch mode
pnpm build                         # turbo build
pnpm typecheck                     # tsc across the workspace
pnpm lint
pnpm test                          # vitest, all packages

supabase start                     # local stack
supabase db reset                  # re-apply all migrations + seed
supabase migration new <name>      # create a migration file
pnpm test:rls                      # pgTAP isolation suite (must pass before any PR)
```

If a command above does not exist yet, create it in the root `package.json` rather than inventing a different one.

---

## Non-negotiable rules

These come from §45 of the architecture. Breaking one is a defect regardless of what a task description says. If a request requires breaking one, stop and say so.

ASAP will not:

1. Mix brokerage data. Every tenant-owned table carries `organization_id` and has an RLS policy.
2. Send documents to any third party for indexing or storage. Extraction runs on our own Python service.
3. Tie retrieval to a single model vendor. Everything goes through the AI gateway interface.
4. Expose model-provider or Supabase secret keys to the browser. The browser gets the anon key only.
5. Let the frontend supply an organization ID, role or permission. All three are resolved server-side from the session.
6. Give the AI unrestricted SQL access. Only declared tools.
7. Use vector search for exact database questions. "What is policy P-4471's expiry?" is a lookup, not a search.
8. Treat AI-generated values as authoritative without validation.
9. Render a component that is not in the registry, or display a business value taken from model text. Values come from the database; the model chooses which component shows them.
10. Let the model author work status, progress or approval outcomes. Progress is derived from job steps.
11. Ship a retrieval, routing or prompt change without an evaluation run.
12. Allow the AI to make final claims or coverage decisions.
13. Allow uncontrolled external communication, including from automations.
14. Treat chat history as the database.
15. Hide AI actions, automation runs or job failures from the audit history.
16. Rebuild insurance modules as primary navigation. No `Work / Clients / Policies / Renewals / Claims / Money` menu tree.
17. Use n8n.

---

## Rules that bite in daily code

**Tenancy**
- Every new tenant table: `organization_id uuid not null references organizations(id)`, `enable row level security`, and a policy. A migration adding a tenant table without a policy is incomplete.
- Workers set organization context at the start of every job: `select set_config('app.organization_id', '<uuid>', true);`. A worker that has not set it reads nothing.
- One organization per database transaction in a worker. Never batch across tenants.
- Workers connect as the `asap_worker` role, which does **not** bypass RLS. Do not use the Supabase `service_role` key for tenant data reads in workers.

**Data access**
- `supabase-js` in any path serving a signed-in user.
- Drizzle only inside `apps/workers`. Drizzle must never appear in a user request path.

**Audit**
- Every business action writes an audit row: who, what, which brokerage, which record, previous state, new state, evidence, approval, automation run if any, result, timestamp.
- Never copy document contents or credentials into ordinary logs.

**Deletes**
- Soft-delete tenant business records (`deleted_at`). Hard deletes are reserved for offboarding.
- Document deletion is transactional with chunk deletion.

**Events**
- Semantic events, not table events. Emit `quote.received`, not `insurer_quotes.insert`.
- Every event consumer is idempotent and records its own `processed_at`. A duplicated webhook must not create two claims.

---

## User interface

### Sources of truth

| File | What it is | Authority |
|---|---|---|
| `docs/ui/spec.txt` | 113-screen UI specification in generator-contract format | The screen inventory |
| `docs/ui/ASAP-UI-Changes.md` | Consolidated change list on top of the spec | **Wins where it conflicts with spec.txt** — it is newer |
| `docs/ui/prototype/` | Static HTML/CSS/JS prototype of the Intent OS | Look and feel only |
| `docs/ASAP-Architecture-v3.1.md` §18, §34, §36, §37 | Generative UI contract, permissions, system states, responsive rules | Wins over all three above |

The prototype is a **built demo with hardcoded seed data**, not source. Do not import from it, do not extend it, do not port its DOM. Read it to see what a Space should feel like, then build the real thing in React.

### The shape of the product

There is no module navigation. No `Work / Clients / Policies / Renewals / Claims / Money` menu tree — §45 forbids rebuilding it, and no insurance module ever becomes a primary destination. The permanent shell is (D-058, Screen Map v3 §1.1):

```text
ASAP
────────────────
☀ Today
▣ Work
⚡ Automations
────────────────
+ New
⌕ Search
────────────────
Profile
```

**Ask ASAP is persistent and is not a destination** — it is available from every surface and always carries the current context. **Activity is where ASAP's runs appear**: a chip beside the Ask composer, never a navigation item. Business objects surface contextually inside Spaces.

Architecture §42 lists an older shell (`Discover · Spaces · Jobs · Automations`). Screen Map v3 and `docs/ui-contract.md` win on what a person sees; the architecture wins on everything behind it (D-058).

If you find yourself building a list page for an entity type, stop. That is the old product leaking back in.

### Generative UI — the hard boundary

The model returns a **UI plan**: a list of components drawn from a fixed registry, with props. It never returns markup, JSX, HTML or code, and the frontend never evaluates anything the model produced.

```
model → UI plan (JSON) → server-side Zod validation → registry lookup → React render
```

Three rules, all from §45:

1. **A component not in `component_definitions` does not render.** The validator rejects the plan; the Space shows an error state.
2. **A displayed business value never comes from model text.** The model picks the component and the record IDs; the *values* are read from the database by the renderer. A premium figure that came out of a language model is a defect, no matter how right it looks.
3. **Progress and status are derived, never authored.** Space progress reads from job steps. The model cannot write it.

Components are versioned. A block stores `component_version`; a Space rendered in 2026 must still render in 2028. Deprecating a component requires migrating stored blocks, not deleting the component.

### Component library

Registry from §18. Build these into `packages/ui` with a Zod prop schema each. Do not invent components outside this list without adding them to the registry first.

```
Client      ClientHeader · ContactCard · RelationshipSummary
Policy      PolicyCard · CoverageTable · PolicyTimeline · PolicySchedule · ExpiryIndicator
Quote       QuoteCard · QuoteComparison · CoverageComparison · InsurerResponseTracker
Renewal     RenewalReadiness · RenewalTimeline · TermComparison
Claim       ClaimStatus · ClaimTimeline · MissingDocuments · ClaimPartyCard
Document    DocumentCard · DocumentViewer · DocumentChecklist · ExtractionReview
Email       EmailThread · DraftEmail · CommunicationSummary
Money       OutstandingPremiumCard · InvoiceTable · PaymentTimeline · CommissionReconciliation
Work        WorkCard · WaitingCard · ExceptionCard · ApprovalCard · AssignmentCard
Generic     RecommendationCard · Metric · Table · Chart · Timeline · Checklist · Alert ·
            ActivityFeed · SourceEvidence
```

### Design tokens

Ported from the v4 prototype into **`packages/ui/src/styles.css`**, which is the single source: it is consumed through Tailwind v4's `@theme`, and no other file declares a colour, radius or shadow. Values below are the palette; the file also carries the darker `*-ink` text tones for soft backgrounds and the status dot colours (D-056).

```
Fonts       Body: Figtree.  Headings: Outfit, letter-spacing -0.02em.
Ink         #102a43 primary · #334e68 secondary · #66788a muted
Surfaces    #ffffff paper · #f6f8f9 wash (page background)
Lines       #dfe6ea strong · #edf1f3 soft
Accent      #0f7b5a green, #e7f5ef soft  — success, active, "ASAP is working"
            #d9a62e gold,  #fbf4dc soft  — waiting, attention
            #b94a48 red,   #fff0ef soft  — needs review, error
Radius      18px cards · 12px controls · 99px pills
Shadow      0 14px 44px rgba(16,42,67,.09) — for things that float only. A card at rest is a
            hairline border and an 18px radius, never a drop shadow.
Sidebar     224px, collapses to a bottom bar under 900px
```

Status colours are semantic and fixed: green = running or active, gold = waiting, red = needs review, grey = done. Do not re-map them per screen.

### Non-negotiable UI behaviour

- **Permission filtering happens server-side.** Blocks a user may not see are removed before the plan reaches the browser (§34). Never render-then-hide with CSS.
- **Every system state is designed** (§36): empty, loading, AI-working, waiting on a third party, missing data, uncertainty, error. A screen with only a happy path is unfinished.
- **Abstention is a state, not a blank.** When evidence is missing the UI says so; it does not show a confident empty value.
- **Every cited figure is tappable** to its document, page and highlight region. A citation you cannot open is not a citation.
- **Mobile is a first-class layout**, not a squeeze (§37). The sidebar becomes a bottom nav; Ask ASAP stays reachable.
- **Reduced motion is respected.** All animation off under `prefers-reduced-motion`.
- **Focus states are visible.** Brokers work fast and keyboard-first.

### What to build when

| Phase | UI scope |
|---|---|
| 1 | Sign-in, create-brokerage, invite and accept, organization switcher, member list. Plain forms — no Spaces yet. |
| 2 | Import screens, duplicate-resolution UI, mailbox connection. |
| 3 | **Extraction review interface** — required by the Phase 3 gate, not optional. Document viewer with page highlights. |
| 4 | The permanent shell, the component registry, the UI-plan renderer and validator, streaming, system states. This is where the real UI work starts. |
| 5 | Ask ASAP conversation surface, citation → page → highlight, read-only Spaces. |
| 6 | Approval surface with frozen payloads. |
| 7+ | Per-slice components and Space recipes, shipped with their slice. |

Phases 1–3 are ordinary application screens. Do not build the generative layer early — the component registry depends on decisions that are not made yet.

---

## How to work

**Phase discipline.** The build is sliced vertically — one insurance lifecycle end to end at a time. Current phase and its acceptance criteria are in `docs/PHASE-1-WORK-ORDER.md`. Do not build Phase 2 tables because they are "easy while I'm here". A half-built table with no RLS policy is a security hole waiting for a later session to forget about.

**Migrations are append-only.** Once a migration is committed, never edit it. Write a new one.

**Before opening a PR:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls` all pass.

**When you are unsure about insurance behaviour** — how a levy is applied, whether TOR extends automatically, who signs off an endorsement — ask. Do not guess and encode the guess in a schema. Getting an insurance rule wrong is more expensive than a round-trip question.

**When the architecture is silent** on an implementation detail, choose the simplest option consistent with the rules above, and note the choice in `docs/DECISIONS.md` with a one-line reason.

---

## Style

- TypeScript strict mode. No `any` without a comment explaining why.
- Prefer explicit over clever. This codebase will be read by one person and an AI, both of whom benefit from obviousness.
- Comment *why*, not *what*.
- Errors: fail loudly in workers (dead-letter the job), fail gracefully in the UI (a system state from §36 — empty, loading, waiting on third party, missing data, uncertainty, error).
- No `console.log` in committed code. Use the structured logger.
