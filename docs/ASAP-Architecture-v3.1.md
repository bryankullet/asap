# ASAP

## Technical Architecture for an AI Operating System for Insurance Brokers

### Version 3.1

---

## Changes from Version 3.0

Version 3.0 described the intelligence loop — intent → skills → retrieval → reasoning → generated Space → action → approval → execution → evidence — and the platform that runs it. Version 3.1 keeps all of it and adds the **economic operating model** beneath it, from `docs/research/ASAP-Kenyan-Insurance-Brokerages-Economic-State-Machine.pdf` (the Economic State Machine report, 5 September 2026) and the integration audit in `docs/research/ESM-INTEGRATION-AUDIT.md`.

The thesis: insurance work exists because an economic unit — one client, one policy, one period of cover — is somewhere in its lifecycle and something is preventing it from moving safely forward, with money, time, retention, service cost, evidence or professional risk attached to the blockage. User intent remains the human interaction model. Economic state becomes the business operating model underneath the product. The two are not confused: the employee says what they need done; ASAP works out where value sits and what unblocks it.

Added in v3.1:

* **The hierarchy of truth** (§0): economic model → intelligence model → experience model → execution model → evidence and audit.
* **§3A — the economic operating model**: the unified loop that begins at a trigger and ends at a verified transition; the client-policy-year as the primary economic unit; economic position as a vector of dimensions computed from facts, never a stored status; the eight-state management view as an internal summary that never reaches the UI.
* **§3B — the Economic State Service**: the deterministic resolver that turns facts, evidence, money, workflow, clocks and exceptions into a state vector, blockers, value at stake and next transitions. The model may explain it; it may not author it.
* **§8A — the money state machine** M0–M8 as a defined projection over money tables, and the trapped-value gap as a named detector.
* **§8B — contribution and service load**: profitability per unit as a progressively measured estimate.
* **§22 — regulatory and market values** as per-organization configuration with a source reference, never constants.
* **§23 — the evidence-to-transition map**: a transition is verified only when its required evidence resolves.
* **§24A — the exception state machine**: fourteen loops, each with signal → consequence → evidence → recovery → skills → Space → Job → resolution evidence.
* **§25, §26, §27, §28** — Spaces answer nine economic questions in plain language; Jobs bind to a transition goal and complete only when completion evidence resolves; Discover becomes the economic attention engine with a declared weighted score; automations move or protect economic state.
* **§32 — management control loop** (daily / weekly / monthly) as parameterised analysis feeding Discover, Report and Investigation Spaces.
* **§39 — economic evaluation set**: the report's ten stress-test scenarios as fixtures (`docs/evaluation/SCENARIOS.md`).
* **§43 — phase annotations** placing each piece of the economic layer in the phase that already owns its parts. Phase 1 is unchanged.
* **§17 — skill contracts** gain economic purpose (applicable states, transition served, blockers resolved, required and success evidence, money / service-cost / retention / risk effect). Ten new skills and one `unit.*` family fill genuine gaps; see `docs/skill-map.md`.

Research status is preserved throughout: the report labels its claims *observed fact*, *strong inference* or *hypothesis*. Hypotheses are configurable, measured or labelled as estimates in ASAP, never hardcoded (`docs/research/OPERATOR-VALIDATION.md`).

---

## Changes from Version 2.0

Version 2.0 described a correct and secure insurance backend. It did not describe the layer that makes ASAP feel AI-native rather than "insurance software with a chatbot bolted on". Version 3.0 keeps everything in v2.0 and adds that layer.

Kept unchanged from v2.0:

* Supabase / PostgreSQL / pgvector as the system of record.
* Multi-tenant isolation through Row Level Security, including background-worker organization context.
* The full insurance data model (clients, opportunities, quotes, placement, policies, renewals, servicing, claims, money, commissions, work).
* Document storage, contextual chunking, hybrid search, re-ranking, agentic retrieval, enforced citations, retrieval evaluation set.
* Model-agnostic AI gateway.
* Approval engine, controlled action tools, audit history.
* Data ownership and offboarding rules.

Added in v3.0:

* **Section 3 — the intent operating model** as the system's controlling loop.
* **Section 9 — email and communication data model.** v2.0 referenced `emails.organization_id` but never defined the tables. The Communication Space and every `email.*` skill depend on them.
* **Section 10 — the experience layer data model**: `spaces`, `space_blocks`, `jobs`, `job_steps`, `attention_items`, `automations`, `skills`, `component_definitions`.
* **Section 16 — the intent router.** v2.0's query router chose a *data source*. v3.0's router also chooses a *response shape*: simple answer, update the current Space, or create a new Space.
* **Section 17 — the skill registry.** v2.0 exposed ~26 tools. The Intent & Skill Map defines ~150 skills. Skills are a composition layer above tools, each with a declared contract.
* **Section 18 — the generative UI contract.** The model returns a validated UI plan drawn from a fixed component library. It may not invent interfaces.
* **Section 23 — evidence resolution** promoted to a first-class product API (chunk → signed URL → page → highlight region).
* **Section 25 — Spaces**, **Section 26 — Jobs**, **Section 27 — Discover / attention engine**, **Section 28 — automation engine**, **Section 29 — event bus**.
* **Section 35 — realtime and streaming protocol** for generated UI.
* **Section 36 — system states**: empty, loading, waiting on third party, missing data, uncertainty, error.
* **Section 42 — application structure replaced.** v2.0's menu tree (Work / Clients / Policies / Renewals / Claims / Money / Reports) is removed. It contradicts the product. Business objects surface contextually inside Spaces.
* **Section 43 — implementation phases re-sliced vertically.** v2.0 built horizontally by layer, which meant the product's *home screen* depended on the *last* phase. v3.0 builds one insurance lifecycle end to end at a time.
* **Section 4 — the implementation stack is now specified concretely**: monorepo, shared Zod schema package, Hono API, Node workers plus one Python extraction worker, `supabase-js` versus Drizzle, Supabase CLI migrations, Vitest and pgTAP.
* **Sections 46–48 — API surface and two coverage maps** proving every skill in the Skill Map and every UI requirement has a backend path.

---

# 0. The hierarchy of truth

Three documents used to look like three ideas. They are one model with five layers, and the layers answer different questions.

```text
ECONOMIC MODEL         What is happening to business value?
  docs/research/…Economic-State-Machine.pdf · §3A · §8A · §8B · §24A
        ↓
INTELLIGENCE MODEL     What needs to happen next, and which capability can do it?
  docs/skill-map.md · §3 · §16 · §17 · §3B
        ↓
EXPERIENCE MODEL       What should the employee see and do?
  §18 · §25 · §26 · §27 · §36 · docs/ui/*
        ↓
EXECUTION MODEL        How does ASAP safely perform it?
  §15 · §20 · §21 · §28 · §29 · §45
        ↓
EVIDENCE + AUDIT       How do we prove what happened?
  §23 · §40 · supabase/migrations (audit_log, events)
```

Reading rule: a lower layer never contradicts a higher one. If a Space shows a status that the economic model cannot derive from facts, the Space is wrong. If the economic model needs a fact the execution model cannot record with evidence, the model is not yet implementable, and says so.

---

# 1. Product definition

ASAP is a secure AI operating system used by insurance brokers.

Each brokerage connects its:

* Email
* Clients
* Policies
* Quotations
* Claims documents
* Renewal records
* Spreadsheets
* Accounting information
* Existing CRM or insurance software
* Internal procedures

ASAP then gives that brokerage its own private AI workspace.

```text
                         ASAP PLATFORM
                               │
                    Insurance AI engine
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
   Brokerage A            Brokerage B          Brokerage C
         │                     │                     │
   Private data           Private data          Private data
   Private documents      Private documents     Private documents
   Private search index   Private search index  Private search index
   Private users          Private users         Private users
   Private rules          Private rules         Private rules
   Private AI memory      Private AI memory     Private AI memory
```

Brokerage data is never mixed across companies.

---

# 2. Core product principle

ASAP is not merely a chatbot over insurance documents, and it is not traditional insurance software with an assistant attached to the side.

It combines:

```text
Insurance database
        +
Private documents and search index
        +
Email and communications
        +
Company memory
        +
Insurance workflows
        +
AI reasoning
        +
Generated workspaces
        +
Controlled actions
```

Division of ownership:

* The **database** owns business facts.
* The **document system** owns original evidence and the searchable index built from it.
* The **work engine** owns processes, status and deadlines.
* The **skill layer** owns what insurance operations are possible.
* The **experience layer** (Spaces, Jobs, Discover) owns what the user sees and where their work lives.
* The **AI** understands requests, interprets documents, recommends actions and calls controlled tools.

The user is never required to learn the internal information architecture of insurance software.

```text
DO NOT BUILD:
Insurance module → submenu → record → form → action

BUILD:
User intent → insurance skill → business context → generated workspace
→ prepared action → approval → execution → evidence
```

---

# 3. The intent operating model

This loop is the controlling design of the entire system. Every backend component exists to serve one step of it.

```text
User intent
   ↓
ASAP understands business context        → context service (§33)
   ↓
Selects one or more insurance skills     → intent router (§16) + skill registry (§17)
   ↓
Retrieves records, documents and email   → PostgreSQL, hybrid search (§14), email (§9)
   ↓
Reasons over the situation               → AI gateway (§15)
   ↓
Generates the appropriate Space          → UI contract (§18) + Spaces (§25)
   ↓
Prepares recommended actions             → work tools (§20)
   ↓
Human approves where necessary           → approval engine (§21)
   ↓
ASAP executes                            → secure executor (§20)
   ↓
Evidence + audit trail are recorded      → evidence (§23) + audit (§40)
```

ASAP does not need to predict every sentence a broker might type. It needs to understand a finite set of insurance intents and a finite set of insurance skills.

## The five working layers

The product exposes five ways of working. These are not insurance modules.

| Layer | User's mental model | Backend owner |
| --- | --- | --- |
| Discover | "What should I know?" | Attention engine (§27) |
| Ask ASAP | "Tell ASAP what I want." | Intent router + gateway (§15–16) |
| Spaces | "Where my work lives." | Spaces service (§25) |
| Jobs | "What ASAP is doing." | Jobs service (§26) |
| Automations | "How I teach ASAP to work automatically." | Automation engine (§28) |

Plus two universal utilities: **Search** (§30) and **+ New / ingestion** (§31).

## Universal intent types

The router classifies every request into one or more of these. They are stable; the skill catalogue grows underneath them.

```text
Find        Locate a client, policy, claim, email, document, payment
Understand  Explain status, cover, history, delay or problem
Prioritize  Tell me what needs attention
Create      Create client, opportunity, claim, servicing request
Prepare     Prepare quote, renewal, email, report, submission
Compare     Compare insurers, premiums, cover or versions
Check       Verify completeness, requirements, status or discrepancies
Follow up   Prepare or manage communication
Update      Change internal records or workflow state
Assign      Give work to someone
Approve     Confirm a prepared action
Analyze     Surface trends, risks, performance or financial insights
Automate    Create recurring or event-driven rules
```

---

# 3A. The economic operating model

## Why work exists

An insurance broker turns client trust, risk information, insurer access and staff work into placed cover; that cover becomes profitable only when commission is collected, service cost stays controlled, evidence is correct, and the client renews. Every piece of brokerage work is therefore an attempt to move an **economic unit** forward, or to stop it from losing value.

## The unified loop

§3's intelligence loop is the middle of a longer loop. The whole of it:

```text
TRIGGER   user intent · event (§29) · schedule · detector (§27)
   ↓
Identify the economic unit                      → §3A, context service (§33)
   ↓
Reconstruct its current economic position       → Economic State Service (§3B)
   ↓
Detect the bottleneck, exception or desired transition
   ↓
Understand the outcome required                 → intent router (§16)
   ↓
Select one or more insurance skills             → skill registry (§17)
   ↓
Retrieve records, documents, email, evidence    → §14, §9, §23
   ↓
Reason over the situation                       → AI gateway (§15)
   ↓
Generate or update the appropriate Space        → §18, §25
   ↓
Create or continue a Job where work is required → §26
   ↓
Prepare the next action                         → work tools (§20)
   ↓
Human approval where required                   → approval engine (§21)
   ↓
Execute                                         → secure executor (§20)
   ↓
VERIFY that the required evidence now exists    → §23 evidence-to-transition map
   ↓
Confirm the economic transition                 → economic_transitions (§26)
   ↓
Update Discover, related Spaces, money position, risk
   ↓
Record evidence and audit trail                 → §40
```

Two halves, two owners. The **human interaction model** is still "tell ASAP what you need done" (§3). The **business operating model** is the economic loop. The employee never has to understand the second; the product is built on it.

## The primary economic unit: client-policy-year

```text
one client + one policy + one period of cover
Acme Ltd · Motor Fleet · 1 Nov 2026 – 31 Oct 2027
```

It is the unit because it contains a client need, a defined risk, quotations, a premium, a client decision, evidence that cover exists, commission, service and claims effort, an expiry, a renewal or exit, and a measurable contribution. It becomes economically serious when the broker commits staff time, revenue-producing when premium reaches the insurer and cover is placed, and complete when the period has ended or renewed, obligations are understood, money and adjustments are reconciled, evidence is stored, and no exposure remains.

Secondary units attach to it: the client relationship (many periods), opportunity or tender (may create several), quote request (one insurer path), endorsement or service request, claim-support case, premium item, commission receivable, renewal cycle, complaint or error.

**Representation.** Decision D-029 (pending operator answer before Phase 2 schema): recommended as a thin first-class `policy_periods` row per client-policy-year, with commission, claims, endorsements, documents, premium items and renewal cycles referencing the period. The economic position is **never stored on it**; it is projected (§3B). See `docs/research/ESM-INTEGRATION-AUDIT.md` §G for the alternatives rejected.

## Economic position is a vector, not a status

There is no `economic_state` column, anywhere, ever. A policy can be active, missing its final schedule, waiting on a claim document, owed commission, approaching renewal and generating unusual service cost at the same time. The position is the tuple of these dimensions, each computed from authoritative facts and evidence:

```text
commitment        none · pursuing · mandated · declined            (opportunity, mandate evidence)
risk_information  incomplete · conflicting · market_ready           (requirements vs evidence; conflicts)
market            not_approached · awaiting · terms_usable · declined · re_marketing
client_decision   none · pending · instructed · changed · expired_terms
premium           possible · quoted · selected · due · received_by_insurer · failed
cover             none · confirmed · confirmed_mismatch · cancelled
policy_evidence   missing · partial · complete · incorrect · overdue
active_service    quiet · open_requests · open_claim · blocked
commission        not_due · due · stated · variance · paid · settled · disputed · overdue
renewal           not_started · started · at_risk · retained · lost · lapsed
exceptions        [] or a list of open exception loops (§24A)
service_load      unmeasured · normal · elevated · abnormal        (estimate until operator-validated)
```

Each value is defined by a rule over records and evidence, documented with the dimension. Values are computed on read (SQL projections, cached in `entity_summaries` with `computed_at`), not written by users, jobs or models.

## The eight-state management view

The report reduces the business to eight questions and eight states: possible business → broker committed → market-ready risk → decision-ready options → placed cover → active service → cash and renewal → economic closure. In ASAP this is a **derived summary for management analysis** (§32) and for reasoning inside the gateway. It is never a column, never an enum, and never appears in UI copy, tooltips or alt text (D-028). Spaces speak plain brokerage language instead: not "S7 transition blocked", but "Cover cannot safely start yet. Premium receipt has not been matched to this policy."

## Rules

* State is calculated from records, rules and evidence. The model may explain a state, detect likely problems, recommend a transition, select skills and prepare work. It may not set, infer or invent a state value. This is §45 ("the database owns workflow status") applied one level down.
* A transition is **confirmed** only when its required evidence resolves (§23). Until then it is a hypothesis the Space shows as unproven.
* Every legal or market value the economic model uses (payment deadlines, document clocks, tax rates, commission caps) is a per-organization configuration with a source reference (§22), never a constant.
* Every quantity the report labels a hypothesis is configurable, measured or displayed as an estimate (`docs/research/OPERATOR-VALIDATION.md`).

---

# 3B. Economic State Service

The deterministic component that computes §3A's position. It is not an AI component and calls no model.

```text
authoritative business facts     (policies, periods, quotes, decisions, invoices, receipts, commissions …)
+ evidence state                 (documents, extractions, email links, delivery acknowledgements — §23)
+ money state                    (§8A projection)
+ workflow state                 (work_items, jobs, approvals — §24, §26, §21)
+ time and deadlines             (clocks: expiry, quote validity, payment-before-risk, commission, document, endorsement, claim)
+ exceptions                     (§24A)
+ organization rules             (lead times, thresholds, regulatory values — §22)
        ↓
current economic position        (the vector, per unit)
        ↓
blocked and available transitions, each with the evidence it needs
        ↓
value at stake                   (expected commission, premium, renewal value, recoverability, risk class)
        ↓
next transition candidates       (ranked deterministically; the model chooses how to help, not whether they are true)
```

## Where it lives

* **Projections in PostgreSQL**: one SQL view or function per dimension, tenant-scoped through the same RLS as everything else, readable by the API as the user and by workers as `asap_worker` with organization context. Aggregates are cached in `entity_summaries` and refreshed by events (§29).
* **A small TypeScript resolver in `apps/api`**, shared with `apps/workers`, that assembles the vector, evaluates clocks against organization rules, lists transitions and computes value at stake. No Drizzle in the API path: it reads through `supabase-js`; the worker variant reads through Drizzle under `withOrganization`.

## Who calls it

| Caller | What it gets |
| --- | --- |
| Context service (§33) | `economic_position` in the context envelope: vector, blockers, value at stake, missing evidence, active clocks |
| Intent router (§16) | the unit and its blockers, so "what's stopping Acme?" resolves without a lookup skill |
| Skill registry (§17) | which skills apply to the current states and serve the next transition |
| Space recipes (§25) | the nine answers a Space renders |
| Jobs (§26) | `transition_goal`, completion requirements, verification of completion evidence |
| Discover detectors (§27) | signal classes and the deterministic scoring inputs |
| Automations (§28) | conditions such as "risk information became market-ready" as computed facts |
| Analysis skills (§32) | the eight-state summary and the money chain for management questions |

## What it must never do

* Accept a state value from a model, a user or a job as input. Inputs are facts; states are outputs.
* Persist a state value on a business table. Only `economic_transitions` (§26) records that a transition was *verified*, with its evidence.
* Use a hardcoded legal or market constant. It reads `company_rules`.
* Present a hypothesis as a fact. Service load, contribution and probability of loss carry `confidence` and `basis` (measured | estimated | configured).

## Phasing

Skeleton and the first two dimensions (`cover`, `policy_evidence` for imported policies) in Phase 4 alongside `jobs` and `spaces`; the full vector for the renewal slice in Phase 7; money dimensions in Phase 11; service load and contribution in Phase 12. Nothing in Phase 1.

---

# 4. Core technology stack

## Repository and shared types

A single monorepo, managed with **pnpm workspaces** and **Turborepo**.

```text
apps/
├── web         React PWA
├── api         Hono service — gateway, intent router, skills, REST
├── workers     Node/TS queue consumers — jobs, detectors, automations
└── extractor   Python service — document text, tables, page positions
packages/
├── schema      Zod definitions: component props, tool arguments, API contracts
├── db          Drizzle schema + generated types
└── ui          Component library implementing component_definitions
```

`packages/schema` is the load-bearing part. Every shape that crosses a boundary is defined once in **Zod** and derived everywhere else:

```text
Zod schema
   ├── runtime validation in the API and the UI plan validator (§18)
   ├── TypeScript types for the frontend renderer and the workers
   └── JSON Schema, via zod-to-json-schema, for component_definitions.props_schema
```

Without this, the frontend renderer and the server-side validator drift apart and the mismatch surfaces at runtime instead of at build time.

## Frontend

* React
* TypeScript
* Vite
* Tailwind CSS
* shadcn/ui
* TanStack Query
* React Hook Form
* Zod
* Progressive Web App support

The frontend ships a **fixed component library** (§18). It renders UI plans; it does not receive markup or code from the model.

## Backend

* Supabase
* PostgreSQL
* pgvector
* PostgreSQL full-text search
* Supabase Auth
* Supabase Storage
* Supabase Edge Functions
* Supabase Realtime
* Supabase Queues
* Supabase Cron

## API and data access

* **Hono** on Node for the API service: the AI gateway, the intent router, skill execution and the REST surface (§46). Chosen for first-class server-sent events, which the streaming protocol in §35 requires.
* **`supabase-js`** for every request made on behalf of a signed-in user. RLS applies.
* **Drizzle** for service-role queries inside background workers only, after `set_config('app.organization_id', …)` has been called. Drizzle never appears in a user request path.
* **Supabase CLI migrations**, as SQL files committed to the repository, so RLS policies are reviewable in diffs rather than edited in a dashboard.

## AI

* Model-agnostic AI gateway (OpenAI, Anthropic and others behind one interface)
* Embedding model from any provider; embeddings stored in PostgreSQL
* Structured outputs and function calling
* Streaming responses
* Prompt caching for stable instructions and large documents
* Model routing: small, fast model for intent routing, classification, chunk contextualization and re-ranking; frontier model for interpretation, drafting, comparison and cited answers

## Background processing

* Supabase Queues for job management
* TypeScript background workers for all long-running work
* **One Python service for document extraction.** Every chunk must carry a page number and a bounding box (§13). Python's PDF tooling — PyMuPDF, pdfplumber, layout models — extracts tables with coordinates materially better than the Node ecosystem, and §45 forbids sending documents to a hosted extraction API. The service consumes the ingestion queue and returns structured JSON; it is the only non-TypeScript component in the system.
* Edge Functions for webhooks and short server operations only; they enqueue, they do not process documents
* A durable job orchestrator for multi-step, long-lived work (§26). Queues alone cannot model a renewal that waits six days for an insurer.
* Dead-letter queue for failed jobs
* Idempotency protection for repeated operations

## Communications

* Gmail OAuth
* Microsoft 365 OAuth
* Provider-agnostic inbound email
* Postmark for platform-generated transactional email

## Testing

* **Vitest** for unit and integration tests across the TypeScript workspaces.
* **pgTAP** for Row Level Security policies, executed against a real database. The production gate in §44 requires isolation to be proven by a database test rather than a gateway test; pgTAP is how that gate is met.
* Retrieval and routing evaluation harnesses (§39) run in CI alongside the test suite.

## Monitoring

* Sentry for errors
* PostHog for product analytics
* Structured application logs
* PostgreSQL audit history
* Dedicated AI-run, retrieval-run, tool-call, skill-run and job-step records

## Automation rule

All automation is built inside ASAP.

No n8n.

---

# 5. High-level architecture

```text
Broker employee
      ↓
ASAP application shell  (Discover · Ask ASAP · Spaces · Jobs · Automations · Search · + New)
      ↓
Authentication and permissions
      ↓
Context service          ← current Space, client, policy, claim, selection, role
      ↓
Intent router            ← classify intent, select skills, choose response shape
      ↓
Skill registry           ← skill contracts, required context, approval rules
      ↓
AI gateway
      │
      ├── PostgreSQL business records
      ├── In-database document search (hybrid)
      ├── Email and communications
      ├── Company memory
      ├── Insurance workflow engine
      └── Controlled action tools
      ↓
UI plan validator        ← components must exist; props must typecheck
      ↓
Approval engine
      ↓
Action executor
      ↓
Spaces · Jobs · Attention items  (what the user sees next)
      ↓
Database and audit history
```

The event bus (§29) runs alongside this and feeds the automation engine and the attention engine.

---

# 6. Multi-tenant structure

Every brokerage is represented by an organization.

```text
organizations
├── id
├── name
├── country
├── timezone
├── currency
├── settings
├── subscription_plan
├── status
├── created_at
└── deleted_at
```

Every company-owned record contains:

```text
organization_id
```

Examples:

```text
clients.organization_id
policies.organization_id
claims.organization_id
documents.organization_id
document_chunks.organization_id
emails.organization_id
tasks.organization_id
ai_memories.organization_id
spaces.organization_id
jobs.organization_id
automations.organization_id
attention_items.organization_id
```

Every request follows:

```text
Authenticated user
        ↓
Organization membership
        ↓
Role and permissions
        ↓
Allowed records
        ↓
Allowed skills
        ↓
Allowed AI tools
        ↓
Allowed actions
        ↓
Allowed UI components
```

Supabase Row Level Security must enforce company isolation inside the database, rather than relying only on frontend or gateway filtering. This applies equally to business records, document records, the search index, Spaces, Jobs, attention items and automations.

## Background workers and RLS

The service role bypasses RLS. Background workers must therefore set the organization context at the start of every job:

```sql
select set_config('app.organization_id', '<organization_id>', true);
```

RLS policies honour this setting. A worker that has not set an organization context cannot read or write tenant data. Workers never process more than one organization inside a single database transaction.

Automation runs, job steps and attention detectors are background work and obey this rule without exception.

---

# 7. Brokerage onboarding

## Step 1: Create the brokerage workspace

The first user:

* Creates the brokerage.
* Enters company details.
* Selects country, currency and timezone.
* Becomes the initial administrator.
* Accepts data-processing and security terms.

ASAP creates:

* Organization record
* Default roles
* Private storage namespace
* Default insurance workflows
* Default automations (paused, in draft)
* Default attention detectors
* Audit configuration

## Step 2: Invite employees

The administrator invites users and assigns roles.

Initial role templates:

* Brokerage administrator
* Account executive
* Placement officer
* Policy administrator
* Claims officer
* Renewals officer
* Finance officer
* Manager
* Read-only user

Roles determine what each user may:

* View
* Create
* Edit
* Approve
* Export
* Delete
* Send externally
* Ask AI to perform

## Step 3: Connect existing systems

The brokerage can connect:

* Shared email inbox
* Individual work inboxes
* Google Drive
* Microsoft OneDrive or SharePoint
* Existing CRM
* Policy-management system
* Accounting system
* Spreadsheets
* Document folders

The administrator selects what ASAP can access.

```text
✓ Read placement@brokerage.com
✓ Read claims@brokerage.com
✓ Import policy spreadsheet
✓ Import client documents
✕ Do not access directors' personal folders
✕ Do not access HR email
```

## Step 4: Import structured records

ASAP imports:

* Clients
* Contacts
* Insurers
* Policies
* Policy expiries
* Claims
* Outstanding premiums
* Renewal lists
* Quotations
* Invoices
* Commission records

The system detects:

* Duplicate clients
* Duplicate policies
* Missing policy numbers
* Invalid dates
* Missing insurer relationships
* Conflicting records

Imported records enter a review state before becoming authoritative. The import review itself is presented as a Space, not as an admin screen.

## Step 5: Process documents

ASAP ingests:

* Policy schedules
* Quotations
* Proposal forms
* Claim forms
* Assessment reports
* Debit notes
* Credit notes
* Renewal notices
* Endorsements
* Invoices
* Correspondence
* Supporting evidence

## Step 6: Configure company rules

The brokerage defines:

* Approval limits
* Email-signing rules
* Renewal lead times
* Follow-up frequency
* Escalation rules
* Required documents
* Preferred insurers
* Departments
* Assignment rules
* Working hours
* Communication templates

These are stored in `company_rules` and are loaded into every AI request as operating memory (§22).

## Step 7: Shadow mode

Initially, ASAP can:

* Search
* Summarize
* Detect missing information
* Recommend actions
* Draft communications
* Create Spaces and attention items

It cannot send or change consequential records automatically.

## Step 8: Progressive activation

```text
Read and answer
        ↓
Draft work
        ↓
Create internal tasks
        ↓
Send approved communications
        ↓
Perform routine actions
        ↓
Monitor workflows continuously
```

## Step 9: Onboarding into the interaction model

Users do not need training in a menu tree, but they do need to learn a new way of working. Onboarding is delivered inside the product, not as a manual.

* The first Discover screen is seeded from imported data, so it is never empty on day one.
* Ask ASAP shows role-specific example intents ("Renew Acme", "Who owes us money?") drawn from the user's own portfolio.
* The first Space a user opens carries a one-time explanation of Space states.
* The first Job explains why AI work is observable.
* Automation suggestions are proposed from observed repetition ("You have prepared 6 renewals this way — automate it?") rather than taught up front.

Backend requirement: `user_onboarding_state` per user, tracking which model concepts have been introduced, so the frontend never re-teaches.

---

# 8. Insurance database

## Organization and access

```text
organizations
users
organization_memberships
roles
permissions
role_permissions
teams
user_team_memberships
```

## Clients and relationships

```text
clients
client_contacts
client_addresses
client_relationships
client_notes
client_preferences
client_assignments
```

A client may be:

* Individual
* Business
* Group
* Association
* Institution

## Insurers and service providers

```text
insurers
insurer_contacts
insurer_products
insurer_requirements
assessors
loss_adjusters
medical_providers
repairers
other_service_providers
```

## Sales and placement

```text
opportunities
insurance_requirements
risk_items
quote_requests
quote_request_insurers
insurer_quotes
quote_options
quote_comparisons
recommendations
client_decisions
placement_instructions
```

## Policies

```text
policies
policy_sections
insured_items
policy_parties
policy_terms
policy_exclusions
policy_limits
policy_deductibles
policy_documents
policy_status_history
```

## Renewals

```text
renewal_cycles
renewal_requirements
renewal_quotes
renewal_decisions
renewal_followups
renewal_outcomes
```

Every policy creates a renewal cycle based on its expiry date and the brokerage's configured lead time.

## Endorsements and servicing

```text
service_requests
endorsements
endorsement_changes
endorsement_documents
endorsement_status_history
certificates
cancellations
```

An **endorsement** is a formal amendment to a policy already in force — adding a vehicle, changing an insured value, correcting a name. A **TOR** (Transfer of Risk) moves a risk from one insurer to another mid-term or at renewal. Both are modelled as `service_requests` with a specialised type, so the servicing pipeline (classify → check requirements → request from insurer → track → review response → update policy → complete) is shared.

## Claims support

```text
claims
claim_incidents
claim_requirements
claim_documents
claim_updates
claim_reserves
claim_payments
claim_service_providers
claim_correspondence
claim_status_history
```

ASAP may help brokers prepare, document and follow up on claims.

It must not independently make an insurer's final claim decision.

## Money

```text
invoices
invoice_lines
premium_transactions
receipts
payments
refunds
commissions
commission_statements
commission_reconciliations
outstanding_balances
```

## Work management

```text
work_items
tasks
task_dependencies
approvals
exceptions
deadlines
scheduled_actions
notifications
events
activity_logs
```

## Documents and search

```text
documents
document_versions
document_chunks
document_extractions
```

## AI and memory

```text
conversations
messages
conversation_summaries
company_facts
company_rules
entity_summaries
memory_proposals
ai_runs
retrieval_runs
tool_calls
skill_runs
evaluation_sets
evaluation_results
```

## Experience layer

New in v3.0, defined in §10:

```text
spaces
space_blocks
space_participants
space_events
jobs
job_steps
job_interrupts
attention_items
attention_detectors
automations
automation_versions
automation_runs
skills
skill_versions
component_definitions
```

---

# 8A. Money state machine

Operational progress and money progress are different. The money chain is a **projection** over the money tables, computed by the Economic State Service, with each stage unlocked by a recorded fact or evidence.

```text
M0 possible premium          estimate on the opportunity                 → unlocked by usable insurer terms
M1 quoted premium            insurer_quotes.premium, valid_until          → unlocked by client selection
M2 selected premium          client_decisions                             → unlocked by a correct payment instruction
M3 premium due               invoices / premium_transactions              → unlocked by receipt or a permitted payment condition
M4 premium received by insurer   receipts matched to the period          → unlocked by cover confirmation + commission calculation
M5 commission due            commission_receivables (expected: premium × class rate per company_rules)   → unlocked by insurer statement
M6 commission stated         commission_statements lines matched to the period                          → unlocked by matching policy, premium, rate, tax
M7 net commission paid       payments matched to statement + wht_certificates                           → unlocked by bank match and WHT evidence
M8 final commission settled  commission_adjustments (refunds, cancellations, clawbacks) cleared          → unlocked by policy-year close
```

The **trapped-value gap** — premium received by insurer → commission due → correctly stated → cash received and matched — is a named detector family in §27 (`money.commission_aging`, `money.commission_variance`, `money.premium_unlinked`, `money.wht_missing`). The commission payment clock starts when the insurer receives premium and its length is a per-organization regulatory value (§22), not the number 30.

ASAP must be able to state, per unit and per portfolio: premium expected, selected, due, paid; commission expected, due, stated, paid, unmatched, disputed; WHT evidence missing; adjustments and clawbacks unresolved. Every figure is a deterministic calculation reference (§23), never model output.

Schema consequences (Phase 11, see §43): `commission_receivables`, `wht_certificates`, `commission_adjustments`; `receipts` and `commission_statements` lines reference the policy period.

---

# 8B. Contribution and service load

Premium and gross commission do not indicate profitability. A large account can be poor business if acquisition effort is excessive, servicing is heavy, insurer corrections cause rework, commission is delayed or lost, or the client does not renew.

```text
contribution per client-policy-year
  = commission and permitted fees, net of adjustments
  − direct acquisition effort
  − placement effort
  − administration effort
  − claims and service effort
  − rework and error cost
```

ASAP does not invent cost data. It builds the measurement path and labels everything until measured:

* `effort_records` (Phase 12): `user_id`, unit reference, activity class (acquisition | placement | administration | service | claims | rework), minutes, `basis` (timer | estimate | inferred from activity), `recorded_at`. Inferred effort (from emails handled, documents processed, job steps run) is a hypothesis with its own confidence.
* Staff cost rates, "normal" service hours per class, and abnormal-load thresholds are per-organization configuration seeded empty; ASAP proposes values from observed distributions and asks the brokerage to confirm.
* Every contribution figure carries `basis` and a confidence band and renders as an estimate in Spaces and reports ("Estimated contribution: KSh 30k–45k, based on 14 recorded hours and estimated rates").
* `analysis.service_load` and `analysis.contribution` (§17) are the skill surface; the *Investigation* Space recipe gains an economic variant ("why is this account unprofitable?").

---

# 9. Email and communication data model

v2.0 assumed email existed but never defined it. Every `email.*` skill, the Communication Space, unhandled-email detection and the "email received" automation trigger depend on these tables.

```text
mailboxes
├── id
├── organization_id
├── provider              (gmail | microsoft | imap | forwarding)
├── address
├── mailbox_type          (shared | individual)
├── scope                 (folders and labels ASAP may read)
├── sync_state
├── connected_by
├── status
└── disconnected_at

email_threads
├── id
├── organization_id
├── mailbox_id
├── provider_thread_id
├── subject
├── participants
├── first_message_at
├── last_message_at
├── message_count
├── handled_status        (unhandled | in_progress | handled | ignored)
├── handled_by
└── summary               (rolling thread summary written by a small model)

emails
├── id
├── organization_id
├── thread_id
├── provider_message_id
├── direction             (inbound | outbound)
├── from_address
├── to_addresses
├── cc_addresses
├── sent_at
├── received_at
├── subject
├── body_text
├── body_html
├── body_tsv              (full-text search vector)
├── embedding             (vector, for semantic email search)
├── classification        (quotation terms | claim notification | payment advice | query | ...)
├── detected_action
├── confidence
├── confidentiality
└── deleted_at

email_attachments
├── id
├── organization_id
├── email_id
├── filename
├── mime_type
├── file_hash
├── document_id           (set once the attachment is ingested as a document)
└── ingestion_status

email_entity_links
├── id
├── organization_id
├── email_id
├── entity_type           (client | policy | claim | quote | opportunity | service_request | invoice)
├── entity_id
├── link_source           (ai | user | automation)
├── confidence
├── confirmed_by
└── confirmed_at

email_drafts
├── id
├── organization_id
├── thread_id
├── in_reply_to_email_id
├── entity_type
├── entity_id
├── prepared_by           (ai | user | automation)
├── prepared_from_skill
├── subject
├── body
├── attachments
├── approval_id
├── status                (draft | pending_approval | approved | sent | discarded)
├── sent_email_id
└── sent_at
```

## Rules

* Inbound email arrives by webhook; the Edge Function stores the raw message and enqueues processing. It does not classify or extract inline.
* Attachments enter the document ingestion pipeline (§13) and become searchable documents linked to the same entity.
* Entity linking is AI-proposed and confidence-scored. Low-confidence links surface for confirmation rather than being applied silently.
* Outbound email is always an `email_drafts` row first. There is no code path that sends external email without passing through §21.
* `handled_status` on threads powers `email.detect_unhandled` and the "unanswered email" attention detector.
* Emails are indexed for both keyword (`body_tsv`) and semantic (`embedding`) search so `search_communications()` behaves like document search.

## Ingestion pipeline

```text
Brokerage connects inbox
        ↓
Email provider sends webhook
        ↓
ASAP stores permitted email        (scope check against mailboxes.scope)
        ↓
Attachments enter ingestion pipeline  (§13)
        ↓
AI identifies client and insurance case
        ↓
Email links to relevant records    (email_entity_links)
        ↓
ASAP detects requested action
        ↓
Task, alert, Space or draft is created
        ↓
Emit email.received event          → automations + attention detectors
```

Each brokerage chooses which inboxes and folders ASAP can access. Deleted or disconnected integrations stop future synchronization; already-ingested email remains, subject to retention policy.

---

# 10. Experience layer data model

This is the layer v2.0 was missing. It stores what the user sees, what ASAP is doing, what deserves attention, and what the brokerage has taught ASAP to do automatically.

## Spaces

A Space is a durable, task-oriented workspace. It is not a page and not a chat log.

```text
spaces
├── id
├── organization_id
├── space_type            (client | quote | comparison | placement | policy | servicing |
│                          claim | renewal | money | reconciliation | document |
│                          communication | work | search | report | team | automation |
│                          investigation | import_review)
├── title                 ("Acme · 2026 Motor Renewal")
├── subtitle
├── primary_entity_type
├── primary_entity_id
├── related_entity_refs   (jsonb array of {entity_type, entity_id})
├── work_item_id          (nullable — the durable work this Space presents)
├── conversation_id       (the Ask ASAP thread bound to this Space)
├── state                 (active | waiting | needs_you | completed | archived)
├── waiting_on            (nullable — insurer, client, internal user, document)
├── waiting_since
├── progress_percent      (derived, not authored by the model)
├── created_by            (user | ai | automation)
├── created_by_automation_id
├── creation_reason
├── owner_user_id
├── pinned_by             (array of user ids)
├── last_activity_at
├── completed_at
└── deleted_at

space_blocks
├── id
├── organization_id
├── space_id
├── position
├── component            (must exist in component_definitions)
├── component_version
├── props                (jsonb — validated against the component schema)
├── data_binding         (jsonb — how to refresh this block's data)
├── skill_run_id         (which skill produced this block)
├── evidence_refs        (jsonb array of chunk / record / email references)
├── pinned               (survives Space morphing)
├── created_at
└── superseded_at

space_participants
├── space_id
├── user_id
├── role                 (owner | collaborator | viewer)
└── last_seen_at

space_events
├── id
├── organization_id
├── space_id
├── event_type           (created | morphed | block_added | block_removed |
│                         state_changed | job_attached | approval_requested |
│                         approved | rejected | completed)
├── actor                (user | ai | automation)
├── payload
└── created_at
```

### Ownership rule

`work_items` own business status. Spaces reference it. A Space's `state` is derived from its work item and its open approvals, never authored independently. Two sources of truth for "is this renewal done?" is the single most likely way to corrupt this system.

### Persistence rule

Generated UI does not disappear when the conversation ends. A Space remains available while the work is active, then moves to `completed` and stays searchable and auditable forever.

## Jobs

A Space is where the user works. A Job is work ASAP is doing.

```text
jobs
├── id
├── organization_id
├── job_type             (renewal_preparation | quote_collection | claim_submission |
│                         document_ingestion | reconciliation | portfolio_review |
│                         import | analysis | automation_run)
├── title                ("Acme Renewal Preparation")
├── space_id             (nullable — the Space this job feeds)
├── work_item_id
├── entity_type
├── entity_id
├── status               (queued | running | waiting_external | needs_you |
│                         completed | failed | cancelled)
├── initiated_by         (user | ai | automation | schedule)
├── created_by_automation_id
├── creation_reason
├── requested_by_user_id
├── progress_percent
├── started_at
├── last_heartbeat_at
├── resume_at            (for scheduled wake-ups)
├── completed_at
├── failure_reason
└── dead_lettered_at

job_steps
├── id
├── organization_id
├── job_id
├── position
├── step_key
├── label                ("APA terms received")
├── skill_name           (which skill this step runs)
├── status               (pending | running | waiting_external | done | skipped | failed)
├── waiting_on
├── waiting_since
├── attempts
├── idempotency_key
├── input
├── output
├── evidence_refs
├── started_at
├── finished_at
└── error

job_interrupts
├── id
├── organization_id
├── job_id
├── job_step_id
├── interrupt_type       (conflict | missing_data | ambiguous_extraction |
│                         approval_required | permission_required | external_failure)
├── question             ("Vehicle KDA 482A has conflicting values")
├── options              (jsonb — the choices presented, with their evidence)
├── resolution
├── resolved_by
├── resolved_at
└── created_at
```

### Long-lived work

A renewal job may wait six days for an insurer. Supabase Queues model short units of work, not multi-day waits. Jobs are therefore a durable state machine:

* A step that enters `waiting_external` releases its worker and sets `resume_at` or registers an event subscription.
* Supabase Cron sweeps `jobs` for due `resume_at` values and re-enqueues them.
* The event bus (§29) can wake a waiting step early — an insurer's email arriving satisfies "waiting for CIC terms".
* `last_heartbeat_at` detects stalled workers; stalled jobs are re-enqueued once, then dead-lettered and surfaced as an exception.
* Every step carries an `idempotency_key` so a retry never sends a second email or creates a second invoice.

## Attention items (Discover)

```text
attention_items
├── id
├── organization_id
├── item_type            (priority | exception | opportunity | waiting |
│                         prepared | change | pattern | approval)
├── title                ("Acme Motor Renewal")
├── summary              ("Terms received from 2 of 3 insurers. CIC outstanding.")
├── entity_type
├── entity_id
├── space_id             (nullable — where [Continue] goes)
├── job_id
├── work_item_id
├── detector_key         (which detector produced it)
├── severity             (1–5)
├── score                (computed ranking score)
├── audience_user_ids    (null = whole brokerage, subject to role filtering)
├── audience_roles
├── suggested_action     (label + target)
├── evidence_refs
├── state                (open | acknowledged | snoozed | resolved | dismissed)
├── snoozed_until
├── first_detected_at
├── last_confirmed_at
├── resolved_at
└── dedupe_key           (unique per organization + open state)

attention_detectors
├── id
├── organization_id      (null = platform default)
├── detector_key
├── description
├── schedule             (cron expression)
├── query                (parameterised, never free SQL from the model)
├── severity_rule
├── enabled
└── last_run_at
```

`dedupe_key` prevents the same overdue premium from appearing eight days running as eight cards. A detector re-confirms an existing item rather than creating a new one.

## Automations

```text
automations
├── id
├── organization_id
├── name                 ("30-Day Renewal Preparation")
├── description
├── status               (draft | active | paused | archived)
├── current_version_id
├── created_by
├── created_from_intent  (the natural-language sentence the user typed)
├── last_run_at
├── next_run_at
└── deleted_at

automation_versions
├── id
├── organization_id
├── automation_id
├── version
├── trigger              (jsonb: type + parameters)
├── conditions           (jsonb: field/operator/value tree — no free SQL)
├── skills               (ordered list of skill names with bound arguments)
├── actions              (ordered list of action definitions)
├── approval_rule        (which actions require human approval)
├── exception_handling   (on failure: retry | flag | escalate | stop)
├── audience             (who receives resulting work)
├── created_by
├── created_at
└── activated_at

automation_runs
├── id
├── organization_id
├── automation_id
├── automation_version_id
├── trigger_event_id
├── mode                 (live | test | dry_run)
├── status               (matched | skipped | running | completed | failed | awaiting_approval)
├── condition_trace      (jsonb — which conditions matched, with values)
├── skills_run
├── actions_taken
├── created_entities     (jsonb refs to work items, Spaces, jobs, drafts created)
├── job_id
├── error
├── started_at
└── finished_at
```

### Explainability

Every object an automation creates carries `created_by_automation_id` and `creation_reason`. This is what makes "Why did ASAP create this?" answerable:

```text
Created by:        60-Day Renewal Watch
Triggered:         Today · 08:02
Reason:            Acme Motor Policy expires in 58 days.
Condition matched: No renewal terms recorded.
[View automation]
```

The panel is assembled from `automation_runs.condition_trace` joined to the created object. It is not generated prose.

## Skills and components

```text
skills
├── id
├── skill_name           ("renewal.compare")
├── family               ("renewal")
├── description
├── current_version_id
├── status               (active | deprecated)
└── platform_owned       (true for built-in skills)

skill_versions
├── id
├── skill_id
├── version
├── required_context     (jsonb — e.g. ["policy_id"])
├── optional_context
├── data_sources         (database | documents | email | memory | calculation)
├── allowed_ai_actions
├── restricted_actions
├── tools_used           (which §20 tools it may call)
├── generated_ui         (default component recipe)
├── user_actions         (what the user may do with the result)
├── approval_requirements
├── evidence_requirements
├── audit_requirements
├── failure_behaviour    (missing-data handling)
├── required_permissions
└── created_at

component_definitions
├── id
├── component            ("QuoteComparison")
├── version
├── props_schema         (JSON Schema)
├── required_permissions
├── data_requirements
├── supports_evidence    (boolean)
├── mobile_behaviour     (full | collapsed | summary_only | hidden)
├── status               (active | deprecated)
└── created_at
```

`skills` and `component_definitions` are seeded from the Intent & Skill Map and the component library, and are versioned so that a Space rendered last year still renders today.

---

# 11. Document storage

Original documents are stored in private Supabase Storage.

```text
insurance-documents/
└── organization_id/
    └── entity_type/
        └── entity_id/
            └── document_id/
                ├── original.pdf
                ├── extracted.json
                └── preview.png
```

Example:

```text
insurance-documents/
└── brokerage-184/
    └── policies/
        └── policy-991/
            └── document-447/
                ├── original.pdf
                └── extracted.json
```

Supabase Storage access is controlled using RLS-backed storage policies. Files remain private and are opened through permission-checked signed URLs.

Original documents are never sent to a third party for storage or indexing. The searchable index is built inside ASAP's own database.

---

# 12. Document records

```text
documents
├── id
├── organization_id
├── document_type
├── title
├── entity_type
├── entity_id
├── storage_path
├── mime_type
├── file_hash
├── version
├── status
├── confidentiality
├── uploaded_by
├── created_at
└── deleted_at

document_versions
├── id
├── organization_id
├── document_id
├── version
├── storage_path
├── processing_status
├── extraction_status
├── indexing_status
├── created_at
└── superseded_at

document_chunks
├── id
├── organization_id
├── document_id
├── document_version_id
├── chunk_index
├── page_number
├── bounding_box
├── section_title
├── chunk_type          (text | table | header)
├── context_summary     (1–2 sentences written by a small model)
├── content             (context_summary + original text)
├── content_tsv         (full-text search vector)
├── embedding           (vector)
├── entity_type
├── entity_id
├── client_id
├── policy_id
├── document_type
├── confidentiality
├── policy_year
└── created_at

document_extractions
├── id
├── organization_id
├── document_version_id
├── schema_name
├── extracted_data
├── confidence
├── validation_errors
├── review_status
├── reviewed_by
├── reviewed_at
└── source_references
```

## Indexes on document_chunks

* HNSW index on `embedding`
* GIN index on `content_tsv`
* B-tree index on `(organization_id, client_id, policy_id)`
* B-tree index on `(organization_id, document_type, policy_year)`

RLS on `document_chunks` uses the same `organization_id` policy as every other table.

---

# 13. Document ingestion

```text
Document received
        ↓
Store original in Supabase Storage
        ↓
Create document record
        ↓
Validate file
        ↓
Calculate duplicate-detection hash
        ↓
Classify insurance document
        ↓
Extract text, tables, page numbers and positions
        ↓
Slice by section; keep tables whole
(extraction and slicing run in the Python extractor service)
        ↓
Small model writes a context summary for each chunk
(whole document held in a cached prompt; one pass per chunk)
        ↓
Embed each chunk
        ↓
Insert all chunks and metadata in one transaction
        ↓
Structured field extraction
        ↓
Validate extracted values; uncertain fields go to review
        ↓
Connect document to client, policy or claim
        ↓
Mark document searchable
        ↓
Emit document.ingested event  → automations + attention detectors
```

## Contextual chunking

A chunk that reads "Limit: 5,000,000 any one occurrence" is unsearchable on its own. Before indexing, a small model writes one or two sentences placing the chunk in context, for example: "From the Property Damage section of the fire policy schedule for Client X, 2026 renewal, table of limits." This summary is prepended to the chunk text and both are indexed for vector and keyword search. This is a one-time cost at ingestion.

## Chunking rules

* Split at section and clause boundaries, not fixed character counts.
* Tables are never split. A table is one chunk, with its heading.
* Every chunk carries page number and bounding box so citations resolve to a highlighted region of the original PDF.
* Every chunk carries the entity, client, policy, document type, confidentiality and policy year of its parent document.

## Document versioning

```text
New document version uploaded
        ↓
Process new version
        ↓
Validate extraction
        ↓
Chunk, contextualize and embed new version
        ↓
In one transaction:
    insert new version's chunks
    delete old version's chunks
    activate new version
        ↓
Keep historical record and original file in Supabase
```

Deleting a document deletes its chunks in the same transaction. There is no external index to synchronize and no indexing status to poll.

## Ingestion as a visible Job

Ingestion is not silent. Every ingestion run is a `job` with steps the user can watch, which is what makes drag-and-drop upload (§31) feel like a conversation rather than a file transfer. A failed classification or a low-confidence extraction becomes a `job_interrupt`, not a silent skip.

---

# 14. Document retrieval

Retrieval runs entirely inside PostgreSQL.

```text
Query
        ↓
Permission and entity filter
(organization, role, confidentiality, client / policy scope)
        ↓
Hybrid search in parallel
├── vector similarity on embedding   (top 20)
└── full-text keyword on content_tsv (top 20)
        ↓
Merge with reciprocal rank fusion
        ↓
Re-rank top 30 → top 10 using a small model
        ↓
Return chunks with document, page and bounding box
```

## Why hybrid

Vector search finds "riots" when the document says "civil commotion." Keyword search finds exact policy numbers, clause references and insurer names that vector search blurs. Combining both is the single largest accuracy gain available and is required.

## Filtering before search

When the user is working on a client, policy or claim, the filter restricts the search to that scope before any similarity is computed. This is faster, cheaper and eliminates most wrong candidates. Confidentiality and role checks are applied in the same `WHERE` clause, so a user never receives a chunk they could not open as a document.

**The current Space supplies this filter automatically.** A question asked inside the Acme Renewal Space is scoped to Acme's policies before the model sees anything. This is the mechanism behind "context is fundamental" (§33).

## Tool exposure

Retrieval is exposed to the AI as one tool:

```text
search_documents(query, filters)
```

The model may call it repeatedly. A simple question takes one call. A hard coverage question may take several: search for the peril, search for the synonym, check the exclusions section, check endorsements, then answer. The gateway limits the number of calls per request.

## Retrieval records

Every search writes a `retrieval_runs` row: query, filters applied, chunks returned, chunks ultimately cited, latency.

---

# 15. AI gateway

The frontend never communicates directly with any model provider.

```text
ASAP frontend
      ↓
ASAP AI gateway
      ├── authenticate user
      ├── identify brokerage
      ├── load context envelope        (§33)
      ├── check permissions
      ├── load conversation
      ├── load company rules
      ├── route intent                 (§16)
      ├── select skills                (§17)
      ├── choose model and provider
      ├── select tools
      ├── execute retrieval
      ├── enforce citations
      ├── produce and validate a UI plan (§18)
      ├── stream response              (§35)
      └── record audit history
```

The AI gateway protects:

* Model provider credentials
* Supabase privileged credentials
* Internal prompts
* Brokerage permissions
* Usage limits
* Tool definitions
* Skill definitions
* Approval rules
* Component schemas

The gateway is provider-agnostic. Switching or mixing model providers is a configuration change and does not touch retrieval, storage, permissions or the UI contract.

---

# 16. Intent router

v2.0's query router decided **where data came from**. That is still required and is preserved below. v3.0's router additionally decides **what shape the response takes**, because the interface follows the user's intent.

## Stage 1 — Data routing (unchanged from v2.0)

```text
User request
      ↓
ASAP query router
      │
      ├── Exact client, policy, claim or invoice
      │      → Query PostgreSQL
      │
      ├── Policy or document interpretation
      │      → search_documents (hybrid, may loop)
      │
      ├── One selected document
      │      → Review complete document
      │
      ├── Email or thread question
      │      → search_communications
      │
      ├── Financial calculation
      │      → Retrieve structured inputs
      │      → Calculate in code
      │
      ├── Exhaustive portfolio review
      │      → Background database workflow (a Job)
      │
      └── Combination
             → Run relevant sources in parallel
```

| Request | Source |
| --- | --- |
| "When does policy POL-184 expire?" | PostgreSQL |
| "Does this policy include political violence?" | Document search, agentic loop |
| "Which policies expire next month?" | PostgreSQL |
| "Find emails discussing the rejected claim documents." | Email and document search |
| "Calculate the outstanding premium." | PostgreSQL and deterministic code |
| "Review every active policy for missing schedules." | Background portfolio workflow |

## Stage 2 — Intent and skill selection

```text
Utterance + context envelope
      ↓
Small model classifies:
      ├── intent_type      (find | understand | prioritize | create | prepare |
      │                     compare | check | follow_up | update | assign |
      │                     approve | analyze | automate)
      ├── entities         (resolved against the database, not guessed)
      ├── scope            (this record | this client | this brokerage)
      └── candidate skills (from the skill registry, filtered by permission)
      ↓
Missing required context?
      ├── resolvable from the current Space   → resolve silently
      ├── resolvable by one lookup            → resolve silently
      └── genuinely ambiguous                 → ask one disambiguating question
```

Entity resolution is a database operation. "Renew Acme" resolves `Acme` against `clients` with fuzzy matching; two candidates produce a choice, not a guess.

## Stage 3 — Response shape

```text
                     ┌──────────────────────────────────────┐
Simple answer        │ Fact retrievable, no work implied     │
                     │ "When does this expire?"              │
                     └──────────────────────────────────────┘
                     ┌──────────────────────────────────────┐
Update current Space │ Refinement of what is on screen       │
                     │ "Only show policies expiring this year"│
                     └──────────────────────────────────────┘
                     ┌──────────────────────────────────────┐
Create new Space     │ Multi-step work with its own lifecycle│
                     │ "Renew Acme"                          │
                     └──────────────────────────────────────┘
                     ┌──────────────────────────────────────┐
Create a Job         │ Long-running or externally blocked    │
                     │ "Collect terms from three insurers"   │
                     └──────────────────────────────────────┘
                     ┌──────────────────────────────────────┐
Create an Automation │ "Always do this when…"                │
                     └──────────────────────────────────────┘
```

Worked examples:

```text
"Renew Acme"                          → Renewal Space (+ Job)
"Compare these quotations"            → Quote Comparison Space
"What's happening with Jane's claim?" → Claim Space
"Help me reconcile Jubilee's statement" → Reconciliation Space
"Why are CIC claims taking longer?"   → Investigation Space
"Find CIC's last email"               → simple answer with an evidence link
"What is James waiting on?"           → Work Space filtered to James
"Show me their policies"              → update the current Client Space
```

The router records its decision on the `ai_runs` row, including rejected alternatives, so routing quality is measurable rather than anecdotal.

## Existing-Space reuse

Before creating a Space, the router searches for an open Space with the same `primary_entity_id` and `space_type`. "Renew Acme" twice must reopen one renewal, not fork two. This check is a database constraint, not a model judgement.

---

# 17. Skill registry

A **tool** is a narrow, safe database or system operation (§20). A **skill** is a named insurance capability composed of tools, retrieval and reasoning. The Intent & Skill Map defines roughly 150 skills across 14 families; v2.0 defined 26 tools. Skills sit between them.

```text
Intent  →  Skill(s)  →  Tools  →  Database / documents / email
```

## Every skill must declare

Stored in `skill_versions` and enforced by the gateway, not by prompt convention:

```text
Skill name
What it does
Required context
Optional context
Data sources
Allowed AI actions
Restricted actions
Generated UI (default component recipe)
Available user actions
Approval requirements
Evidence / sources
Audit trail
Failure / missing-data behaviour
Required permissions

Economic purpose (v3.1 — see docs/skill-map.md addendum)
  Economic unit it operates on            (client-policy-year · client · opportunity · claim · receivable …)
  Applicable economic states              (which dimension values it is relevant in)
  Transition it helps achieve             (dimension: from → to)
  Blockers it resolves                    (missing evidence, waiting party, conflict, deadline)
  Required evidence / success evidence    (what must exist before; what proves it worked)
  Effects                                 (money · service cost · retention · professional/compliance risk)
  Failure consequence                     (what value is lost if it does not run)
  Detector and automation opportunities   (which §27 detectors and §28 automations can invoke it)
```

The economic block lets the router prefer skills that serve the unit's next transition, lets Discover attach the right action to a card, and lets a Job know which skill's success evidence completes it. It is metadata about existing skills first; only ten new skills and the `unit.*` family were needed to cover the report's transitions and exceptions (`docs/skill-map.md`, `docs/research/ESM-INTEGRATION-AUDIT.md` §F).

## Skill families

```text
client.*        find create update summary relationship_history contacts activity
                assign_owner list_policies list_claims list_opportunities money_summary

opportunity.*   create detect_from_email
quote.*         prepare extract_requirements check_completeness select_insurers
                prepare_request track_responses extract_terms compare compare_cover
                follow_up prepare_client_options record_client_choice

placement.*     prepare check_requirements prepare_submission confirm track_policy_issuance
underwriting.*  track_requirements record_terms resolve_queries

policy.*        find summary coverage schedule documents check_item compare_versions
                history expiry parties

service.*       create classify extract_request check_requirements
                prepare_insurer_request track follow_up review_response
                update_policy complete
tor.*           prepare
endorsement.*   prepare
certificate.*   request

claim.*         create detect_from_email extract_incident find_policy check_coverage
                check_documents timeline status detect_blocker prepare_submission
                track follow_up record_response settlement_summary close

renewal.*       find list_upcoming assess_risk prepare check_documents request_terms
                track_terms extract_terms compare explain_change follow_up
                prepare_recommendation record_client_choice prepare_placement complete

money.*         client_balance outstanding overdue prepare_follow_up record_payment
                match_payment reconcile insurer_balance
commission.*    expected received reconcile outstanding

document.*      classify extract summarize find compare validate link_to_record
                check_missing detect_conflict

email.*         find thread_summary classify identify_client identify_policy
                identify_claim identify_quote extract_action prepare_reply
                prepare_follow_up link_to_record detect_unhandled

work.*          today prioritize waiting blocked overdue by_user by_client
                assign reassign complete explain

search.*        global semantic records documents email relationships timeline

analysis.*      production renewals claims insurers clients money commission
                workload performance explain_change

team.*          workload performance assign reassign approvals overdue activity

automation.*    create explain edit pause resume delete test history

unit.*          position blockers next_transition close_check        (v3.1 — the economic unit)
```

v3.1 additions to existing families: `opportunity.qualify`, `quote.check_comparability`, `quote.track_validity`, `placement.verify_cover_match`, `money.check_payment_condition`, `commission.check_wht_evidence`, `analysis.service_load`, `analysis.contribution`. Contract extensions without new skills: `commission.outstanding` gains aging buckets; `document.detect_conflict` covers structured facts (list versus schedule).

## Skill composition

A Space usually runs several skills. There is no page-per-skill. Opening a renewal runs, in one Job:

```text
renewal.prepare
  → policy.summary
  → policy.compare_versions
  → claim.timeline (loss history)
  → renewal.check_documents
  → document.check_missing
  → renewal.request_terms
  → renewal.track_terms
  → renewal.extract_terms
  → renewal.compare
  → renewal.explain_change
  → renewal.prepare_recommendation
```

Each skill contributes blocks to the same Space and steps to the same Job.

## Skill execution record

```text
skill_runs
├── id
├── organization_id
├── ai_run_id
├── job_id
├── job_step_id
├── space_id
├── skill_name
├── skill_version
├── inputs
├── resolved_context
├── tools_called
├── outputs
├── blocks_produced
├── evidence_refs
├── confidence
├── missing_data
├── status              (completed | partial | blocked | failed)
├── latency_ms
└── created_at
```

`status = partial` is a first-class outcome. A renewal comparison with two of three insurers' terms is useful and must render, marked as incomplete.

## Design checklist for every intent

No skill enters the registry until these fourteen questions are answered and recorded. This is the working procedure that produces a `skill_version` row.

```text
 1. What is the user trying to achieve?          → intent_type
 2. What context does ASAP already know?         → context envelope (§33)
 3. What information must ASAP retrieve?         → data_sources
 4. Which skills must run?                       → skill composition
 5. Simple answer, update Space, or new Space?   → response shape (§16)
 6. Which UI primitives should appear?           → generated_ui recipe (§18)
 7. What should ASAP prepare automatically?      → allowed_ai_actions
 8. What needs human judgement?                  → restricted_actions
 9. What actions become available?               → user_actions
10. What happens after approval?                 → executor path (§20–21)
11. What happens if information is missing?      → failure_behaviour (§36)
12. What evidence should be shown?               → evidence_requirements (§23)
13. Should this create or update a Job?          → job binding (§26)
14. Could this be automated in future?           → candidate trigger (§28)
```

There is no page per skill. A generated Space may combine many.

---

# 18. Generative UI contract

The AI composes interfaces from a fixed library. It never emits markup, code or arbitrary layout. This is what keeps a dynamically generated workspace visually consistent and safe.

## The contract

The model returns a **UI plan**:

```json
{
  "response_shape": "create_space",
  "space": {
    "space_type": "renewal",
    "title": "Acme · 2026 Motor Renewal",
    "primary_entity_type": "policy",
    "primary_entity_id": "pol_991"
  },
  "blocks": [
    { "component": "RenewalReadiness", "props": { "renewal_cycle_id": "rc_44" } },
    { "component": "InsurerResponseTracker", "props": { "quote_request_id": "qr_18" } },
    { "component": "TermComparison",
      "props": { "quote_ids": ["iq_101", "iq_102"] },
      "evidence_refs": ["chunk_8841", "chunk_8907"] },
    { "component": "RecommendationCard",
      "props": { "recommendation_id": "rec_12" },
      "requires_approval": true }
  ],
  "narration": "Terms are in from APA and Britam. CIC is outstanding."
}
```

## Validation pipeline

```text
Model output
      ↓
1. Component exists in component_definitions?          → else reject
      ↓
2. Props validate against props_schema?                → else reject
      ↓
3. Referenced IDs exist and belong to this org?        → else reject
      ↓
4. User has required_permissions for the component?    → else drop block
      ↓
5. Evidence required and present?                      → else force abstention
      ↓
6. Data fetched server-side from IDs                   → never from model text
      ↓
Persist as space_blocks and stream to the client
```

**Rule: components reference records by ID; the server fetches the values.** The model never supplies the premium figure that gets displayed. This removes an entire class of hallucination from the interface — if a number appears on screen, it came from the database or from a cited chunk.

A rejected plan is repaired once by the gateway (drop the invalid block, re-validate). A second failure returns a simple answer with an explanatory notice rather than a broken Space.

## Component library

```text
Client        ClientHeader · ContactCard · RelationshipSummary
Policy        PolicyCard · CoverageTable · PolicyTimeline · PolicySchedule ·
              ExpiryIndicator
Quote         QuoteCard · QuoteComparison · CoverageComparison ·
              InsurerResponseTracker
Renewal       RenewalReadiness · RenewalTimeline · TermComparison
Claim         ClaimStatus · ClaimTimeline · MissingDocuments · ClaimPartyCard
Document      DocumentCard · DocumentViewer · DocumentChecklist · ExtractionReview
Email         EmailThread · DraftEmail · CommunicationSummary
Money         OutstandingPremiumCard · InvoiceTable · PaymentTimeline ·
              CommissionReconciliation
Work          WorkCard · WaitingCard · ExceptionCard · ApprovalCard · AssignmentCard
Generic       RecommendationCard · Metric · Table · Chart · Timeline · Checklist ·
              Alert · ActivityFeed · SourceEvidence
```

Selection inputs, as required by the product spec: intent, role, business context, current Space, available data, permissions, workflow state.

## Versioning

`component_definitions` is versioned. A Space rendered in 2026 stores `component_version` on each block and still renders in 2028. Deprecating a component requires a migration of stored blocks, not a silent removal.

---

# 19. AI runtime

```text
 1. Employee expresses an intent (typed, spoken, or by dropping a file).
 2. ASAP authenticates the employee.
 3. ASAP establishes brokerage, role and permissions.
 4. The context service assembles the context envelope.
 5. The intent router classifies intent, resolves entities and selects skills.
 6. The router chooses a response shape.
 7. Database, document, email and memory retrieval run — in parallel where independent.
 8. Relevant results are given to the AI.
 9. AI answers with citations to chunk IDs, or proposes actions, or emits a UI plan.
10. The gateway resolves citations to document, page and highlight.
    Claims without a citation are rejected or restated as
    "not found in the documents."
11. The UI plan is validated against the component contract.
12. AI requests controlled tools when necessary.
13. The backend validates permissions.
14. The approval engine evaluates risk.
15. The tool executes if allowed.
16. The result is verified.
17. The database is updated.
18. Spaces, Jobs and attention items are created or updated.
19. AI run, retrieval run, skill run, tool call and audit events are recorded.
20. The final result is streamed to the employee.
```

---

# 20. AI tools

The AI receives narrowly defined tools. Skills call tools; the model never calls the database directly.

## Read tools

```text
find_client()
get_policy()
get_policy_documents()
get_renewal()
get_claim()
get_invoice()
get_outstanding_balance()
search_documents()
search_communications()
search_records()
get_activity_history()
get_entity_summary()
```

## Work tools

```text
create_task()
create_followup()
draft_email()
prepare_quote_comparison()
prepare_renewal_summary()
prepare_claim_checklist()
create_service_request()
request_missing_document()
request_approval()
create_space()
update_space()
create_job()
propose_automation()
create_attention_item()
```

## Controlled action tools

```text
send_approved_email()
update_policy_status()
record_client_decision()
create_invoice()
record_payment()
assign_work_item()
close_completed_task()
activate_automation()
```

Every tool checks:

* Brokerage
* User
* Role
* Permission
* Current record state
* Required inputs
* Approval requirement
* Idempotency
* Audit requirement

The AI never receives arbitrary SQL access.

---

# 21. Approval engine

| Action type | Default behavior |
| --- | --- |
| Search and summarize | Automatic |
| Draft communication | Automatic |
| Create internal task | Automatic |
| Create or update a Space | Automatic |
| Recommend insurer or option | Allowed with evidence |
| Send routine reminder | Configurable |
| Send final quotation | Approval required |
| Confirm client placement instruction | Approval required |
| Change policy information | Approval required |
| Create high-value financial transaction | Approval required |
| Activate an automation that sends externally | Approval required |
| Make final claim decision | Not permitted |
| Bind cover without authority | Not permitted |

Brokerages can configure stricter rules.

## The division of labour

ASAP does most of the preparation automatically:

```text
✓ read emails                ✓ prepare renewals        ✓ detect missing information
✓ classify documents         ✓ prepare claims          ✓ draft communication
✓ extract information        ✓ compare quotes          ✓ reconcile information
✓ identify records           ✓ surface risks           ✓ create internal work
✓ make recommendations       ✓ generate Spaces         ✓ raise attention items
```

Human approval remains for consequential actions:

```text
✓ sending external communication where required
✓ insurer selection
✓ binding / placement
✓ material policy changes
✓ consequential financial actions
✓ ambiguous extracted information
```

## The brokerage sending rule

ASAP sends **routine scheduled reminders** itself where configured — renewal due notices, TOR expiry notices, receipt confirmations. Everything else is prepared as a draft that a human sends. This is a per-organization setting in `company_rules`, defaulting to the conservative option.

## Approval surface

Approvals are contextual, not a separate inbox to visit. An `ApprovalCard` appears inside the Space where the work lives; the same approval also appears in Discover and in the manager's approvals view. All three read one `approvals` row.

```text
approvals
├── id
├── organization_id
├── requested_by        (ai | automation | user)
├── skill_run_id
├── job_id
├── space_id
├── action_type
├── action_payload      (exactly what will execute — immutable once requested)
├── risk_level
├── required_role
├── required_approvals  (count, for high-value actions)
├── status              (pending | approved | rejected | expired | superseded)
├── decided_by
├── decision_reason
├── decided_at
├── executed_at
└── execution_result
```

The payload is frozen at request time. An approval approves a specific action, not a description of one. If the underlying data changes before execution, the approval is `superseded` and re-requested.

Harmless internal actions never ask for confirmation. Repeated confirmation prompts train users to approve without reading, which defeats the control.

---

# 22. Company memory

ASAP memory is brokerage-specific.

## Authoritative memory

Structured facts:

* Policy expiry
* Client contact
* Insurer
* Premium
* Claim status
* Renewal date

## Evidence memory

* Policy schedules
* Emails
* Quotations
* Claim documents
* Endorsements
* Invoices

## Operating memory

Approved brokerage rules:

* Preferred renewal lead time
* Approval limits
* Required documents
* Escalation procedure
* Communication preferences
* Insurer-submission procedure
* Sending rule (which messages ASAP may send unattended)

## Conversation memory

* Recent messages
* Conversation summaries
* Active request
* Unresolved decisions
* Previous tool results
* Current Space state

### Regulatory and market values (v3.1)

Kenyan legal and market values the economic model depends on — the commission payment deadline after the insurer receives premium, the policy-document clock, the withholding-tax rate on commission, commission caps by class of business, the claims-settlement reference period, licensing amounts — are **per-organization configuration**, never constants in code or SQL. They live in `company_rules` with `rule_class = 'regulatory'` and carry:

```text
key                 e.g. commission_payment_deadline_days
value               e.g. 30
unit                days | percent | KES | …
applies_to          class of business, where relevant
source              citation (statute, regulation, guideline, regulator publication) and URL
effective_from
verified_at         when the brokerage last confirmed it
verified_by
```

ASAP ships the report's sourced values (`docs/research/economic-state-machine.md`, sources S3, S4, S5, S8, S15) as **proposals** in the onboarding review, marked unverified until the brokerage confirms them. A rule with no `verified_at` renders as "unconfirmed" wherever it drives a clock or a calculation. Laws change; the report itself says to confirm before commercial use (D-027).

A casual chat message does not automatically become permanent brokerage policy.

The AI may propose a memory (`memory_proposals`), but sensitive operating rules require approval.

## Entity summaries

`entity_summaries` holds precomputed rollups — "4 active policies, 1 renewal underway, 1 open claim, KSh 840k outstanding". These power search result cards, Client Space headers and Discover cards without recomputing aggregates on every keystroke. They are refreshed by event (§29), not by cron polling, and carry `computed_at` so staleness is visible.

---

# 23. Evidence and citation resolution

Evidence is part of the product experience, not debugging output.

Every generated statement that rests on a document must resolve to:

```text
Fact
Source           (document, page)
Region           (bounding box for highlight)
Confidence / uncertainty
Business meaning
Available action
```

## Resolution API

```text
GET /evidence/{chunk_id}
      ↓
check organization, role, confidentiality
      ↓
return {
  document_id, title, document_type,
  page_number, bounding_box,
  signed_url (short-lived),
  chunk_text,
  extracted_from   (which extraction, if structured),
  captured_at
}
```

Rendered by the `SourceEvidence` component:

```text
Comprehensive Motor

Policy
APA/MT/20481

Evidence
Motor Policy Schedule.pdf
Page 2

[Open source]
```

## Evidence beyond documents

A citation may also point to a database record, an email, a calculation or an extraction:

```text
evidence_refs: [
  { type: "chunk",       id: "chunk_8841" },
  { type: "record",      table: "policies", id: "pol_991", field: "expiry_date" },
  { type: "email",       id: "eml_4412" },
  { type: "calculation", id: "calc_77", formula: "sum(invoices) - sum(receipts)" },
  { type: "extraction",  id: "ext_205", confidence: 0.71, review_status: "pending" }
]
```

A calculation reference stores the inputs and the deterministic formula, so "KSh 840,000 outstanding" can be expanded into the invoices and receipts that produced it. Financial figures are never model output.

## Evidence unlocks transitions (v3.1)

A major economic transition is `STATE + REQUIRED FACTS + REQUIRED EVIDENCE + DECISION/APPROVAL → VERIFIED TRANSITION`. The Economic State Service (§3B) treats a transition as *proven* only when each required evidence reference resolves; otherwise the Space shows it as unproven and the Job stays `needs_you`.

| Evidence | Created by | Transition it unlocks | If missing | Recreatable later? |
| --- | --- | --- | --- | --- |
| Client mandate / appointment | client + broker | commitment: pursuing → mandated (authorised work) | dispute over authority; free work | weakly |
| Current policy schedule | previous insurer / client | risk_information → market_ready | wrong comparison, missed cover changes | usually |
| Proposal / risk-information form | client with broker | risk facts → insurer quote | decline, conditions, liability avoidance | before placement |
| Asset / member / vehicle list | client | complete exposure → accurate terms | items uninsured or mispriced | yes, at a cost |
| Claims history | insurer / client | risk assessment → fair quote | premium or terms wrong | usually |
| Insurer quotation | insurer | market → terms_usable → client decision | no defensible recommendation | must be re-issued if expired |
| Comparison and explanation record | broker | terms → informed choice | mis-selling, complaint risk | weak if reconstructed |
| Written client instruction | client | client_decision → instructed (placement authority) | wrong insurer or cover dispute | hard after a loss |
| Premium receipt / payment confirmation | insurer / bank | premium → received_by_insurer; commission → due | risk may not start; commission not due | bank evidence may surface later |
| Cover note / written confirmation | insurer / broker | cover → confirmed | client cannot rely on cover | yes, but delay is risky |
| Schedule and wording | insurer | policy_evidence → complete | limits and exclusions unclear | yes |
| Delivery acknowledgement | client / broker | policy_evidence → delivered | conduct and complaint exposure | hard to recreate honestly |
| Endorsement instruction + document | client / insurer | active_service change → confirmed | asset or value stays wrong | sometimes |
| Claim notification + documents | client / broker / providers | incident → insurer claim process | delay or denial | some evidence decays |
| Commission statement | insurer | commission → stated | missing income invisible | usually |
| WHT certificate | insurer / KRA | commission → paid (tax credit evidence) | tax credit lost or delayed | with effort |
| Renewal instruction | client | renewal → retained (next policy-year) | lapse or client loss | not after the deadline without a gap |

Every row is a `document`, `email`, `record` or `extraction` reference in `evidence_refs`. Verifying a transition writes `economic_transitions` (§26) with those references and emits `transition.confirmed` (§29).

---

# 24. Work engine

Insurance work is represented as durable records.

```text
work_items
├── organization_id
├── work_type
├── related_entity_type
├── related_entity_id
├── status
├── priority
├── assigned_team
├── assigned_user
├── next_action
├── next_action_at
├── waiting_for
├── deadline_at
├── completed_at
├── outcome
├── space_id                 (the Space presenting this work)
├── created_by_automation_id
└── creation_reason
```

Work types include:

* New opportunity
* Quotation
* Placement
* Renewal
* Endorsement
* TOR
* Certificate request
* Claim support
* Premium follow-up
* Commission reconciliation
* Missing document
* Client service request

The database owns work status. The AI may recommend or request a transition, but it does not invent workflow state.

---

# 24A. Exception state machine

Exceptions are the product's main job, not edge cases. ASAP is most useful when the normal path breaks. Each loop below is a first-class pattern: a detector produces the **signal**, the Economic State Service states the **consequence** and the **evidence** required to recover, the router selects the **skills**, the result is a **Space** with a **Job** or prepared action, and the loop closes only on **resolution evidence**.

| Exception | Starts from | Signal | Economic consequence | Recovery evidence | Skills | Space |
| --- | --- | --- | --- | --- | --- | --- |
| Bad-fit opportunity | commitment: pursuing | low expected commission vs service need; effort accumulating | pursuit cost only | decline recorded | `opportunity.qualify` | Quote |
| Lost quote | market → client_decision | client silent past validity; appointment elsewhere | all quotation work earns nothing | loss reason recorded | `quote.follow_up`, `quote.record_client_choice` | Quote |
| Insurer decline | market | decline received | placement work grows, sale may fail | improved submission or new market terms | `quote.select_insurers`, `quote.prepare_request` | Quote |
| Missing information | risk_information: incomplete | requirements unmet near expiry | poor terms, lost renewal | requested evidence received | `quote.check_completeness`, `document.check_missing`, `renewal.request_terms` | Renewal / Quote |
| Conflicting information | risk_information: conflicting | list ≠ schedule | rework, wrong cover, liability | resolved value with source | `document.detect_conflict` → job interrupt | Quote / Renewal |
| Quote expiry | client_decision: pending | validity approaching or passed | re-quote, price change, cover gap | fresh terms and instruction | `quote.track_validity`, `quote.follow_up` | Quote |
| Late client decision | client_decision: pending | inception approaching | lapse or emergency placement | written instruction | `quote.prepare_client_options`, `renewal.prepare_recommendation` | Renewal |
| Premium failure | premium: due / failed | inception without insurer receipt | no cover, no commission, complaint exposure | receipt or revised inception | `money.check_payment_condition`, `money.prepare_follow_up` | Placement |
| Incorrect cover confirmation | cover: confirmed_mismatch | confirmation ≠ instruction | client believes wrong cover | corrected confirmation | `placement.verify_cover_match`, `service.prepare_insurer_request` | Placement |
| Delayed policy evidence | policy_evidence: overdue | document clock exceeded | follow-up cost, conduct risk | delivered and acknowledged documents | `policy.documents`, `document.validate`, follow-up | Policy |
| Claim blockage | active_service: open_claim | no movement beyond threshold | retention and relationship risk | insurer response or document | `claim.detect_blocker`, `claim.follow_up` | Claim |
| Endorsement / TOR blockage | active_service: blocked | past requested effective date | wrong active cover | insurer confirmation of exact change | `service.track`, `service.review_response`, `tor.prepare` | Servicing |
| Cancellation / refund | cover: cancelled | cancellation recorded | commission reduced or returned | earned-period and clawback reconciled | `money.reconcile`, `commission.reconcile` | Reconciliation |
| Commission dispute | commission: variance / overdue | statement missing or differs | cash and reported income wrong | premium, policy, rate, WHT and payment matched | `commission.reconcile`, `commission.check_wht_evidence` | Reconciliation |
| Renewal lost / lapsed | renewal: lost / lapsed | no instruction by expiry | future commission disappears | win-back or closure recorded | `renewal.assess_risk`, `renewal.follow_up` | Renewal |
| Complaint / professional error | any | complaint, wrong document, missed deadline, breach | legal, licence, reputation cost | investigation, correction, notification recorded | `unit.position`, `document.validate`, `work.explain` | Investigation |

Each exception is an `exceptions` row (§24) linked to the unit and the dimension, so the same table that records job failures records economic exceptions, and Discover treats both as one class of signal.

---

# 25. Spaces

## Lifecycle

```text
created ──→ active ──→ waiting ──→ active ──→ completed ──→ archived
               │                      ↑
               └──→ needs_you ────────┘
```

| State | Meaning | Set by |
| --- | --- | --- |
| `active` | Work is progressing; the user can act now | Work item status |
| `waiting` | Blocked on a third party (insurer, client, assessor) | `waiting_on` set by a job step |
| `needs_you` | Blocked on this user — an approval, a conflict, a decision | Open approval or `job_interrupt` |
| `completed` | Outcome recorded | Work item completion |
| `archived` | Removed from active lists; still searchable and auditable | Retention policy |

`pinned` and `recent` are per-user views, not states — `space_participants` and `spaces.pinned_by`.

## Progress

`progress_percent` is derived from completed job steps and satisfied requirements. It is never written by the model. The checklist a user sees:

```text
Acme Motor Renewal
Progress ████████░░ 78%

✓ Current policy reviewed
✓ Claims history checked
✓ APA terms received
✓ Britam terms received
○ Waiting for CIC
○ Client presentation
```

is a direct read of `job_steps`, not a generated summary.

## Morphing

A Space changes shape as the user asks follow-up questions, without navigation.

```text
Open "Acme Ltd"                          → Client Space (summary blocks)
"Show me their policies"                 → policy blocks replace summary detail
"Only those expiring this year"          → same blocks, filter applied
"What's changing on the motor renewal?"  → transitions into renewal comparison
"Why did APA increase the premium?"      → adds explanation + evidence blocks
```

Mechanics:

* Each morph is a new set of `space_blocks`; superseded blocks are stamped `superseded_at`, not deleted. The Space has a visual history.
* `pinned` blocks survive morphing — the user keeps the comparison table on screen while asking about something else.
* The conversation stays bound to the Space, so "why did it increase?" needs no re-stated subject.
* A morph never silently changes `primary_entity_id`. Changing subject creates or reopens a different Space, with a visible transition.

## Navigation between Spaces

Spaces are linked, not nested. `related_entity_refs` and `space_events` make the graph navigable: a Claim Space links to the Policy Space, the Client Space, the Communication Space for its thread, and any Money Space holding its recovery. Back-navigation is a stack of Space IDs, not a URL hierarchy of modules.

## Spaces are economic workspaces (v3.1)

Whatever its recipe, a Space helps the user answer nine questions about the economic unit it presents:

```text
1. What are we trying to accomplish?          transition goal, in plain words
2. Where is this unit right now?               position, per relevant dimension
3. What is preventing it from moving?          blockers
4. What information or evidence is missing?    unmet requirements, each with a way to get it
5. Who or what are we waiting on?              waiting_on · waiting_since · clock
6. What money or value is at stake?            expected commission, premium, renewal value (estimates labelled)
7. What risk exists if nothing happens?        cover gap, professional or compliance exposure, lost renewal
8. What is the most useful next action?        one prepared action
9. What proof will tell us it is resolved?     completion evidence
```

Existing components carry the answers: `Checklist` for requirements, `WaitingCard` and `ExceptionCard` for blockers, `Metric` for value at stake, `Alert` for risk, `RecommendationCard` for the next action, `SourceEvidence` for proof. The answers come from the Economic State Service (§3B), not from the model; the model narrates.

**Plain language.** The eight-state view and the S/M codes never reach the interface — not in copy, tooltips, alt text or debug panes visible to brokers (D-028). Each dimension value has a phrasebook entry in the recipe, e.g. `premium: due` → "Cover cannot safely start yet. Premium receipt has not been matched to this policy."

**Workflow state versus economic position.** `spaces.state` (`active | waiting | needs_you | completed | archived`) is the workflow state of the Space and stays as defined below. A Space can be `active` while its unit is economically blocked; the block that answers question 3 says so.

**Recipes.** Enrich the existing recipes rather than add new ones. The only addition is an economic variant of *Investigation* ("why is this account unprofitable?", "where is commission trapped?").

## Core Space recipes

These are recipes, not fixed screens. ASAP composes the appropriate components for the situation.

```text
Client · Quote · Quote Comparison · Placement · Policy · Servicing · Claim ·
Renewal · Money · Reconciliation · Document · Communication · Work · Search ·
Report · Team · Automation · Investigation · Import Review
```

---

# 26. Jobs

## Purpose

Jobs answer one question: **what is ASAP doing for me?** They are not a manual task manager. Human to-dos live in `work_items` and `tasks`; Jobs expose machine work so that AI activity is observable and therefore trustworthy.

## Work, Jobs and transitions (v3.1)

```text
WORK ITEM            work somebody needs to perform
JOB                  what ASAP is doing
ECONOMIC TRANSITION  why the work matters to the brokerage
```

A Job binds to a **transition goal**, computed by the Economic State Service when the Job is created and frozen with it:

```text
jobs.transition_goal (jsonb, Phase 4)
├── unit_ref                 { type: "policy_period", id }        (or client, opportunity, claim, receivable)
├── dimension                e.g. "cover"
├── from_snapshot            the vector at creation
├── target                   e.g. { cover: "confirmed", premium: "received_by_insurer" }
├── blocked_by               [ { kind: "missing_evidence", evidence: "premium_receipt" }, … ]
├── value_at_stake           { expected_commission, premium, renewal_value, basis }
└── risk_at_stake            [ "cover_gap", "professional_liability" ]

jobs.completion_requirements (jsonb)   the evidence that must resolve (§23 map)
jobs.completion_evidence_refs (jsonb)  what actually resolved
```

Example — a placement Job:

```text
Position now      decision-ready options          (client_decision: instructed, premium: due, cover: none)
Desired           placed cover                    (premium: received_by_insurer, cover: confirmed)
Blocked because   client instruction exists; premium receipt missing
Skills            placement.check_requirements · money.check_payment_condition · document.find · email.find · follow-up
If unresolved     cover may not safely start; commission does not become due; liability exposure
Completion        premium receipt + insurer cover confirmation matching the instruction
```

**Completion.** Progress is still derived from `job_steps`. A Job may reach `completed` only when its `completion_requirements` resolve; a final `unit.verify_transition` step checks them, writes `economic_transitions` and emits `transition.confirmed`. If evidence is missing the Job ends `needs_you` with the unmet requirement, never `completed`.

```text
economic_transitions (Phase 4)
├── id · organization_id
├── unit_type · unit_id
├── dimension · from_value · to_value
├── verified_at · verified_by (user | job | automation)
├── evidence_refs (jsonb)
├── job_id · automation_run_id
└── created_at
```

This is the only place a state *value* is ever written, and it is a record that a transition was verified with evidence — not the current state, which remains a projection. `work_items` gain `economic_reason` (plain-language why plus the unit and dimension) so a human to-do explains itself on a card.

## States

```text
queued → running → waiting_external → running → completed
                 ↘ needs_you ↗
                 ↘ failed
                 ↘ cancelled
```

## Interrupts

When a step needs human judgement, it creates a `job_interrupt` and the job moves to `needs_you`. The interrupt carries the evidence for each option:

```text
ASAP needs you

Vehicle KDA 482A has conflicting values.

2025 schedule            KSh 4.2M   [Motor Schedule.pdf p.3]
Client spreadsheet       KSh 3.8M   [Fleet List.xlsx row 14]

[Use 4.2M]  [Use 3.8M]  [Enter another value]
```

Resolution writes to `job_interrupts.resolution`, records who decided, and resumes the step. An unresolved extraction never overwrites a manually entered value.

## Failure handling

* Transient failures retry with backoff, bounded by `attempts`.
* Permanent failures move the job to `failed`, raise an `exception` record and an attention item, and preserve every completed step's output. Partial work is never discarded.
* A tool failure is never reported to the user as success.
* Dead-lettered jobs are visible to administrators with their full step trace.

---

# 27. Discover and the attention engine

Discover replaces the dashboard. Its purpose: *show me what matters without making me find it.*

## Pipeline

```text
Scheduled detectors (Supabase Cron)  ─┐
Event-driven detectors (§29)         ─┼─→ candidate signals
Job and approval state               ─┘
        ↓
Deduplicate on dedupe_key
        ↓
Score
        ↓
Filter by audience, role and RLS
        ↓
attention_items
        ↓
Realtime push to Discover
```

## The economic attention engine (v3.1)

Discover surfaces where value is **blocked, deteriorating, at risk, waiting, missing evidence, consuming excessive effort, likely to be lost, or ready to unlock**. Every card names the unit, the blocker in plain words, the value at stake (labelled estimate where estimated) and one next action:

```text
Commission on 14 policies should already have been received.               (commission: overdue)
Acme renewal: KSh 84k expected commission at risk; no client instruction with 8 days to expiry.
Cover is active but the final schedule is still missing.                   (policy_evidence: overdue)
Three insurer quotations cannot safely be compared: exclusions incomplete. (quote comparability)
Client selected terms but payment has not been confirmed.                  (premium: due)
This medical account has generated unusually high servicing work relative to commission. (estimate)
Renewal approaching: current exposure data conflicts with last year's schedule.
```

## Scoring

Ranking is deterministic and inspectable, not a model judgement. v3.1 replaces the multiplicative formula (a zero in any factor hid a card) with a **declared weighted composition** of deterministic inputs, each normalised to 0–1 with a documented default when unknown:

```text
score = Σ weight_i × input_i          weights per organization, inspectable on the card

inputs   severity                     detector-declared
         deadline_urgency             from the active clock (§22 regulatory values, renewal lead time)
         waiting_duration             waiting_since vs configured acceptable time (hypothesis until measured)
         ownership                    this user's client or work
         expected_commission          from the money projection (§8A); default 0.5 when unknown
         value_at_risk                premium / renewal value; default 0.5 when unknown
         recoverability               1 − recoverability (unrecoverable losses rank higher)
         compliance_risk              conduct / professional-liability class of the blocker
         service_cost_deterioration   from effort_records (estimate; default 0)
         evidence_completeness        1 − share of required evidence present
         loss_probability             where measured (renewal risk model); default 0
         staleness_penalty            acknowledged items decay
```

A model may write the *summary sentence* on a card. It does not decide the order, the inputs or the weights.

## Detector catalogue

```text
Renewals         approaching expiry without terms · terms received and unreviewed ·
                 renewal at risk (premium increase, loss ratio, client silence)
Claims           document missing beyond N days · no insurer movement beyond N days ·
                 settlement received and unrecorded
Money            invoice overdue · unallocated receipt · commission variance ·
                 premium leakage (policy in force, no invoice)
Email            unhandled thread beyond N hours · insurer reply awaiting action
Documents        failed ingestion · low-confidence extraction pending review ·
                 expected document never arrived
Work             overdue work item · unassigned work · approval pending beyond N hours
Portfolio        cover gap · expiring certificate · lapsed policy still on cover note
Patterns         anomaly detection (see below)

Economic (v3.1) commission aging beyond the configured deadline · premium received but unlinked to a period ·
                 client instruction missing near inception · quote validity expiring · cover confirmation ≠ instruction ·
                 policy document beyond the configured clock · endorsement past effective date · cancellation clawback
                 unmatched · service load abnormal (estimate) · renewal started late for its class · compliance evidence
                 missing (delivery, disclosure, approval) · bad-fit pursuit consuming effort · economic closure blocked
```

## Pattern detection

```text
ASAP noticed

Premium increases are unusually high
across six October motor renewals.

[Investigate]
```

This is a separate analytical pass, not a row query. A scheduled job computes distributions over comparable groups (same class of business, same period, same insurer), flags outliers beyond a configured threshold, and writes a `pattern` attention item whose `[Investigate]` action creates an Investigation Space pre-loaded with the cohort. Anomaly thresholds are per-organization and tunable, because a brokerage with 40 policies and one with 40,000 have different noise floors.

## Constraints

* Discover is not a KPI dashboard. It shows priorities, exceptions, opportunities, waiting items, things ASAP prepared, important changes, emerging patterns and obvious next actions.
* Every card must carry one obvious next action that opens a Space or resolves in place.
* Cards are capped per user per day; overflow is summarised ("11 more items") rather than listed.
* Resolution is automatic where possible: paying the invoice resolves the overdue card without anyone dismissing it.
* Snooze is per user; dismiss is per user; resolve is per organization.

---

# 28. Automation engine

Automations are how a brokerage teaches ASAP how it operates. All automation is built inside ASAP. No n8n.

## Natural-language authoring

```text
User: "When a policy is 30 days from expiry, prepare the renewal
       and assign it to the account manager."
        ↓
automation.create → structured draft, shown for confirmation:

30-Day Renewal Preparation

WHEN      Policy is 30 days from expiry
IF        Policy status = Active
THEN      Create renewal work
          Review existing policy
          Check claims history
          Check required documents
          Prepare client email
          Assign to policy owner
APPROVAL  External communication requires approval

[Test on last 30 days]  [Create automation]
```

The sentence is stored in `created_from_intent`. The structured version is what executes — never the sentence.

## Model

```text
TRIGGER + CONDITIONS + ASAP SKILLS + ACTIONS + APPROVAL RULE + EXCEPTION HANDLING
```

## Triggers

```text
Email received
Document uploaded
Policy approaching expiry
Quote received
Claim created
Claim status changed
Payment received
Invoice overdue
Record changed
Work item overdue
Date/time reached (scheduled)
User action
```

## Actions

```text
Create work            Assign work            Prepare email
Prepare document       Extract information    Update internal record
Check requirements     Compare information    Run analysis
Generate report        Create notification    Request approval
Flag exception         Start workflow
```

Note the deliberate limits: automations may **update safe internal fields**, but external sending and consequential changes route through the approval engine regardless of what the automation says.

## Automations move or protect economic state (v3.1)

Default automations shipped **paused** with every new brokerage (§7), each expressed as TRIGGER + CONDITIONS + SKILLS + ACTIONS + APPROVAL + EXCEPTION HANDLING:

```text
WHEN risk information is still incomplete at (expiry − configured lead time)
  → document.check_missing → prepare request to client                       (approval: external send)
WHEN all required risk evidence is present
  → Economic State Service confirms risk_information = market_ready          (deterministic, not a model judgement)
  → create placement work · prepare insurer submission
WHEN quote validity is within the configured window
  → quote.track_validity → surface client-decision risk · prepare follow-up
WHEN a premium receipt arrives
  → money.match_payment → commission.expected → wait for cover confirmation
WHEN a cover confirmation arrives
  → placement.verify_cover_match → exception if it differs from the instruction
WHEN a policy document is still missing after the configured document clock
  → attention item · prepare insurer follow-up
WHEN commission has been due longer than the configured payment deadline
  → commission.reconcile · commission.check_wht_evidence → flag variance
WHEN service load for a unit exceeds the configured threshold (estimate)
  → analysis.contribution → Investigation Space
WHEN a policy period reaches its renewal lead time
  → renewal.prepare (readiness) → create renewal work
```

Two rules. A transition an automation "marks" is a check by the Economic State Service, never a model judgement. External communication and consequential actions route through the approval engine exactly as before, whatever the automation says.

## Required properties

Automations must be:

```text
Visible      listed with plain-language descriptions, not JSON
Editable     versioned; editing creates a new automation_version
Explainable  every created object traces back to a run and a matched condition
Testable     dry-run against historical data before activation
Pausable     pause and resume without losing history
Auditable    every run recorded with its condition trace
```

## Test mode

`automation_runs.mode = test` replays the trigger against the last N days of real data and reports what *would* have been created, without creating anything or sending anything. This is a production gate for any automation that can send externally.

## Monitoring

The Automation Space shows, per automation: runs over time, matched versus skipped, objects created, approvals requested, failures, and average time-to-human-action. A rule that fires 400 times a week and is dismissed 390 times is a bad rule and must be visible as one.

## Suggested automations

Repeated identical sequences of user actions produce a proposal (`propose_automation`), never a silent activation. The brokerage always opts in.

---

# 29. Event bus

Automation triggers, attention detectors, entity-summary refresh and job wake-ups all need to know when something happened. Polling every table does not scale and produces stale Discover cards.

```text
events
├── id
├── organization_id
├── event_type          (email.received | document.ingested | policy.updated |
│                        quote.received | claim.created | claim.status_changed |
│                        payment.received | invoice.overdue | record.changed |
│                        work.overdue | approval.decided | job.step_completed |
│                        space.created | schedule.fired | user.action)
├── entity_type
├── entity_id
├── actor               (user | ai | automation | system)
├── payload             (jsonb — before/after for changes)
├── occurred_at
├── processed_at
└── processing_attempts
```

## Emission

* Database triggers emit `record.changed` events for audited tables.
* Application code emits semantic events (`quote.received` carries more meaning than `insurer_quotes.insert`).
* Cron emits `schedule.fired`.

## Consumption

```text
event
  ├─→ automation dispatcher   (match trigger + conditions → automation_run)
  ├─→ attention detectors     (event-driven subset)
  ├─→ job wake-ups            (resume steps waiting on this event)
  ├─→ entity_summaries        (invalidate and recompute)
  └─→ realtime channels       (push to open Spaces and Discover)
```

Consumers are idempotent and record `processed_at` per consumer. A duplicated webhook must not create two claims.

---

# 30. Search

Search is a universal utility available everywhere, not a module.

```text
Query
  ├─→ entity search        (clients, policies, claims, vehicles, quotes, insurers,
  │                         contacts, invoices, payments — tsvector + trigram)
  ├─→ document search      (hybrid, §14)
  ├─→ communication search (emails, threads)
  ├─→ workspace search     (Spaces, Jobs, automations)
  └─→ semantic fallback    (when literal matching returns little)
        ↓
  merge, rank, group by object type
        ↓
  attach entity_summaries so results carry context
```

A result is never a bare link:

```text
ACME LTD
4 active policies · 1 open claim · 1 active renewal · KSh 840k outstanding
Recent: CIC email yesterday · Payment received Aug 28
[Open Acme Space]
```

Opening a result opens a **Space**, never a module record page. `search.relationships` and `search.timeline` answer "who insured this risk before?" and "show me everything connected to this claim" by traversing `email_entity_links`, `policy_status_history`, `space_events` and `activity_logs`.

Backend requirements: a materialised `searchable_entities` view per organization (id, type, display name, aliases, tsvector, summary ref), refreshed by event; trigram indexes for fuzzy name matching ("Acme" → "Acme Holdings Ltd").

---

# 31. + New and intent-first ingestion

Manual creation remains available: upload something, new client, new quote, new claim, new policy, new servicing request, new payment.

But creation is primarily intent-first:

```text
"Create a claim from this email."
"Add Acme as a client."
"Start a quote for these documents."
```

## Drag-and-drop inference

```text
File dropped
      ↓
Ingestion job starts (visible, §13)
      ↓
document.classify + document.extract
      ↓
Entity resolution against existing records
      ↓
Propose an action with its evidence:

  This looks like a new quotation request
  from Mombasa Foods Ltd.

  ASAP found:
    27 vehicles
    Comprehensive cover requested
    Renewal date included

  [Create opportunity]  [Attach to existing client]  [Just file it]
      ↓
User confirms → opportunity created → Quote Space opens
```

The proposal is never auto-executed. Classification confidence below the configured threshold produces a question instead of a proposal.

---

# 32. Reports as generated Spaces

There is no Reports module.

```text
"How did we perform last month?"                        → Report Space
"Which insurer takes longest to settle motor claims?"   → Analysis Space
"Why did revenue fall?"                                 → Investigation Space
```

Analysis runs as parameterised queries selected by the `analysis.*` skills — never free SQL from a model. Aggregates are computed in the database; the model narrates the result and cannot alter the numbers.

```text
CLAIM TURNAROUND
Jan – Sep 2026

                Median days
CIC                 31
APA                 24
Britam              19
Jubilee             17

CIC is currently 41% slower than the brokerage average.

[Investigate CIC]
```

Report Spaces can be saved, pinned, shared with named users or roles, and scheduled. A scheduled report is an automation whose action is "generate report + notify".

```text
saved_reports
├── id
├── organization_id
├── space_id
├── analysis_skill
├── parameters
├── schedule
├── recipients
├── last_generated_at
└── created_by
```

Drilling from any figure to its underlying rows is required. A number a broker cannot open is a number they will not trust.

## Management control loop (v3.1)

Management questions have a daily, weekly and monthly shape. They are parameterised `analysis.*` queries over the Economic State Service's projections, and they feed Discover, Report Spaces and Investigation Spaces — not a dashboard.

```text
DAILY    what expires soon · what waits on client decisions · what waits on payment ·
         what is blocked on insurers · what is missing required evidence · which claims or service work is stuck
WEEKLY   which renewals are at risk · which opportunities have consumed effort but are unlikely to convert ·
         who is overloaded · which documents and endorsements are overdue · which commissions should already have arrived
MONTHLY  expected vs stated vs received commission · commission aging · conversion · retention · service load ·
         exception volume · contribution margin where measured · insurer-caused rework · client profitability (estimate)
```

The biggest management delay the report identifies is between a real event and management knowing its economic meaning. The event bus (§29) plus the state service closes it: a receipt matched today raises the commission clock today, not at month-end reconciliation.

---

# 33. Context model

The same sentence means different things in different places.

```text
"What's outstanding?"

From Discover              → brokerage-wide outstanding work
From the Acme Space        → outstanding items for Acme
From a Claim Space         → missing claim requirements
From a Reconciliation Space→ unreconciled transactions
```

Every request to the gateway carries a **context envelope**, assembled server-side from session state. The frontend may name the current Space; it may never assert an organization, a role or a permission.

```text
context_envelope
├── user_id
├── organization_id          (from session, never from the client)
├── role, permissions        (resolved server-side)
├── locale, timezone, currency
├── current_space_id
├── current_space_type
├── primary_entity           (type + id)
├── related_entities
├── selected_records         (what the user has highlighted)
├── current_job_id
├── conversation_id
├── recent_conversation_summary
├── recent_activity          (last N entities touched)
├── open_approvals_for_user
├── company_rules_version
└── economic_position        (v3.1, from the Economic State Service §3B, for the primary entity's unit:
                              vector · blockers · missing_evidence · value_at_stake · active_clocks)
```

Context feeds three things: entity resolution in the router (§16), the pre-search filter in retrieval (§14), and default arguments for skills (§17). A user in the Acme Renewal Space who types "compare the terms" needs no further specification.

Context is preserved without exposing technical state. The user never sees an ID; the system never guesses one.

---

# 34. Permissions in generated UI

RLS protects data. It does not by itself protect the *interface* — a generated Space could otherwise offer a Finance-only action to a Claims officer and fail confusingly at execution.

Three enforcement points:

1. **Skill filtering.** The router only considers skills the user's role permits. A read-only user's "Renew Acme" returns an explanation, not a renewal Job.
2. **Component filtering.** `component_definitions.required_permissions` drops blocks the user may not see, before the plan is persisted. `CommissionReconciliation` never reaches an account executive's screen.
3. **Action filtering.** Every action attached to a block is re-checked at execution. A stale Space open in another tab cannot execute an action the user has since lost.

A dropped block leaves a visible, non-alarming notice ("Some financial detail is not shown for your role"), not a silent hole.

Shared Spaces render per viewer. Two people opening the same renewal see the same work and different levels of financial detail.

---

# 35. Realtime and streaming

## Streaming a response

Ask ASAP streams typed events, not a wall of text. The UI can render a skeleton Space before the reasoning finishes.

```text
event: intent        { intent_type, entities, skills_selected }
event: shape         { response_shape, space_id }
event: block         { position, component, props }        ← repeated
event: data          { block_position, payload }           ← repeated
event: citation      { block_position, evidence_refs }
event: narration     { text_delta }                        ← repeated
event: action        { action_id, label, requires_approval }
event: interrupt     { question, options }
event: done          { ai_run_id, skill_runs, latency_ms }
event: error         { code, message, recoverable }
```

## Realtime channels

Supabase Realtime, scoped by organization and filtered by RLS:

```text
org:{id}:discover            attention item created / resolved
org:{id}:jobs                job and step status changes
space:{id}                   block added, state changed, participant joined
user:{id}:approvals          approval requested / decided
org:{id}:automations         run completed, failure raised
```

Two people in the same Space see each other's presence and each other's changes. An insurer's email arriving updates the tracker without a refresh.

## Offline and reconnect

The PWA queues user actions offline and replays them with their idempotency keys on reconnect. Realtime resubscribes and requests a delta since `last_seen_at` per channel, so nothing is silently missed.

---

# 36. System states

Every generated surface must handle these. They are backend contracts, not frontend decoration.

## Empty

A new brokerage, a client with no history, a search with no hits. The backend distinguishes **nothing exists** from **nothing matched your filter** from **you may not see it** — three different responses. Empty Discover is seeded from imported data during onboarding so day one is never blank.

## Loading and AI-working

Skeleton blocks stream first (§35). Long operations become Jobs immediately, so nothing appears frozen. Anything over ~2 seconds must show what step is running, drawn from `job_steps`, not a generic spinner.

## Waiting on a third party

A first-class state, not an error. `waiting_on` and `waiting_since` produce "Waiting for CIC · 4 days". Configured thresholds escalate to a follow-up draft, then to an attention item, then to a manager. The user is never left guessing whether ASAP forgot.

## Missing data

Every skill declares `failure_behaviour`. A renewal comparison missing one insurer's terms renders with two, marked incomplete, with a prepared follow-up. Missing data produces a *partial answer plus a route to completion* — never an error page, and never a silently narrower answer that looks complete.

## Uncertainty

Confidence travels with extracted values. Below the review threshold, a value enters `document_extractions.review_status = pending`, is displayed as unconfirmed, and cannot overwrite a manually entered value. The `ExtractionReview` component is where a human confirms it.

## Error

* Tool failure is reported as failure, never as success.
* Model failure falls back: frontier → alternate provider → simple answer with an explanation.
* UI-plan validation failure repairs once, then degrades to a simple answer.
* A failed Job preserves every completed step.
* Errors carry a correlation ID that resolves to the `ai_run` for support.

---

# 37. Mobile and responsive behaviour

The same Spaces render on a phone; the backend does not maintain a second product.

* `component_definitions.mobile_behaviour` declares per component: `full`, `collapsed`, `summary_only`, or `hidden`. A `CoverageTable` becomes a summary with a tap-to-expand; a `TermComparison` becomes a swipeable stack.
* The gateway passes a viewport hint so the UI plan can prefer fewer, denser blocks, and prose can be shorter.
* Discover, approvals and job interrupts are the mobile-critical surfaces — a manager approving a quotation from a phone must see the frozen `action_payload` and its evidence.
* Push notifications map to `user:{id}:approvals` and to high-severity attention items only.
* Documents open through the same signed-URL viewer with page and highlight preserved.

---

# 38. Speed

ASAP feels fast because information is prepared before users ask questions.

* Documents are chunked, contextualized and embedded during ingestion.
* Structured fields are extracted in advance.
* Exact questions use PostgreSQL.
* Document questions use in-database hybrid search, which returns in milliseconds. The model response is the only slow step and is streamed.
* Scope filters shrink the search space before similarity is computed.
* Independent searches run concurrently.
* Stable company instructions and large documents use prompt caching.
* Larger entities receive reusable summaries (`entity_summaries`).
* Small models handle routing, classification, chunk context and re-ranking.
* Frontier models handle policy interpretation, comparison and drafting.
* Simple questions take the short path: one retrieval call, one model call. The agentic loop is reserved for hard questions.

Added in v3.0:

* Discover is precomputed. Opening the app reads `attention_items`; it does not start an analysis.
* Space blocks are persisted with their data bindings, so reopening a Space is a database read, not a regeneration.
* The UI plan streams before its data arrives, so structure appears immediately.
* Intent routing uses a small model with a cached prompt; it must not become a second slow step.

Redis is not required initially. It can be added after measurement demonstrates a caching need.

---

# 39. Precision and safety

ASAP combines:

```text
Structured database facts
+ original document evidence
+ keyword and semantic search
+ contextual chunks with page positions
+ deterministic calculations
+ AI reasoning
+ enforced citations
+ validated UI plans
+ approval controls
+ measured retrieval quality
```

Mandatory accuracy rules:

* Exact policy numbers use exact lookup.
* Dates and monetary amounts come from structured fields where available.
* Financial calculations run in code.
* Every document answer cites the chunk, resolvable to a page and highlight in the original.
* **Displayed values are fetched server-side from record IDs, never taken from model text** (§18).
* Uncertain extractions enter review. An extracted value never overwrites a manually entered value without human confirmation.
* AI distinguishes facts from recommendations.
* AI may answer "not found in the documents."
* Exhaustive reviews process every relevant record.
* Search results are not treated as a complete portfolio review.
* Consequential external actions require approval.
* A retrieval evaluation set of 100–200 real broker questions with known answers and source pages is maintained. Any change to chunking, embeddings, prompts, re-ranking or models must hold or improve the score before release.
* **A routing evaluation set** of real utterances with expected intent, skills and response shape is maintained alongside it. Routing regressions are as damaging as retrieval regressions and are invisible without measurement.
* **An economic evaluation set** (v3.1): the ten stress-test scenarios in `docs/evaluation/SCENARIOS.md`, each with expected state vectors per step, blockers, detectors, skills and Spaces. State computation is deterministic and must match exactly; routing on economically phrased utterances must select the expected skills. Fixtures are phase-tagged and run from Phase 4.

---

# 40. Audit history

Every AI run records:

```text
organization
user
conversation
context envelope (redacted)
model and provider
request type
intent classification
skills selected and rejected
response shape chosen
retrieved records
retrieved chunks
cited chunks
UI plan produced
UI plan validation result
tools offered
tools called
approvals requested
result
failure
latency
usage
timestamp
```

Every business action records:

```text
Who acted
What they did
Which brokerage
Which record
Previous state
New state
Evidence used
Approval
Automation and run, if any
Result
Timestamp
```

Every automation run records its trigger event, condition trace, skills run, actions taken and objects created.

Sensitive document contents and credentials must not be copied into ordinary logs.

---

# 41. Data ownership and offboarding

Each brokerage retains ownership of its data.

ASAP must support:

* Data export
* Document export
* Audit export
* **Space, Job and automation export** (the record of how work was done, not only its result)
* Integration disconnection
* User removal
* Configurable retention
* Account deletion
* Supabase document, chunk and record deletion
* Backup-retention handling

Chunk deletion is transactional with document deletion. There are no derived copies held outside ASAP's own storage and database. Deleting a document also removes the `space_blocks` evidence references that pointed to it, leaving a visible "source removed" marker rather than a dangling link.

---

# 42. Application structure

v2.0 listed a module tree. It is removed. That tree is the information architecture the product exists to avoid.

## Permanent shell

```text
ASAP
────────────────
✦ Discover
▣ Spaces
◌ Jobs
⚡ Automations
────────────────
+ New
⌕ Search
────────────────
Profile / Company
```

Ask ASAP is not a destination. It is persistent, available from every surface and by command palette, and always carries the current context.

Insurance entities do not appear in navigation. Clients, policies, claims, quotes, money and documents surface **inside** Spaces when they matter.

## Administration

Under Profile / Company, out of primary navigation:

```text
Company settings
Team & permissions
Roles
Connections and integrations
Email
Company rules
AI permissions
Document types
Document review
Workflows
Skills and automations catalogue
Data & security
Billing
Audit log
```

## Backend consequence

APIs are organised by capability, not by screen: `/intent`, `/spaces`, `/jobs`, `/automations`, `/attention`, `/search`, `/evidence` (§46). There is no `/clients-page` endpoint, because there is no clients page.

## Simplicity constraints the backend must uphold

ASAP must be operable by someone with very little software training. Several of the things to avoid are backend failures, not styling failures.

| Avoid | Backend obligation |
| --- | --- |
| Huge tables by default | Every list endpoint returns a ranked, capped default with a summary; unbounded result sets are not offered |
| Deep navigation trees | No hierarchical record endpoints; Spaces are entered directly from intent or search |
| Lots of tabs | Blocks are selected per intent (§18); the backend never returns "everything about this entity" |
| Dashboard overload | Discover returns scored, deduplicated, capped items (§27) |
| Multiple screens for one task | One intent produces one Space; multi-step work becomes a Job, not a wizard |
| Static pages for every workflow | Space recipes are composed, not enumerated |
| AI bolted onto traditional software | Ask ASAP is the primary entry point and carries context everywhere (§33) |

Prefer, and support in the API: one obvious next action per surface; generated summaries over raw rows; progressive disclosure through block expansion; timelines for processes; comparisons for decisions; evidence on demand; clear approval surfaces.

---

# 43. Implementation phases

v2.0 built horizontally — all documents, then all AI, then all work, then all workflows, then proactive behaviour last. Under that plan the product's **home screen depends on the final phase**, and there is nothing to demonstrate against the new interface for months.

v3.0 builds the platform foundations once, then delivers **one insurance lifecycle end to end at a time**, including its automations and its Discover cards.

## Foundation

### Phase 1: Secure brokerage workspace
Organizations · authentication · memberships · roles · RLS including worker organization context · storage security · audit foundation · environment separation · **event bus**

### Phase 2: Records and email
Clients · contacts · insurers · policies · policy documents · imports · duplicate detection · **mailboxes, threads, emails, attachments, entity links**

v3.1: the client-policy-year representation (D-029) is decided **before** this schema is written; recommended `policy_periods`. `company_rules` gains the `regulatory` rule class (§22) with the report's sourced values as unverified proposals.

### Phase 3: Document intelligence
Private storage and versions · ingestion queue on TypeScript workers, extraction on the Python extractor service (Edge Functions only enqueue) · classification · text and table extraction with page positions · contextual chunking · embeddings, `document_chunks` and indexes · hybrid search and re-ranking · `search_documents` · **extraction review interface (required)** · retrieval evaluation set and scoring harness

### Phase 4: Experience layer skeleton
`spaces` · `space_blocks` · `jobs` · `job_steps` · `attention_items` · **component registry and UI-plan validator** · realtime channels · streaming protocol

v3.1: Economic State Service skeleton (§3B) with the `cover` and `policy_evidence` dimensions; `jobs.transition_goal`, `completion_requirements`, `completion_evidence_refs`; `economic_transitions`; `work_items.economic_reason`; the Discover weighted score; the first economic evaluation fixtures.

### Phase 5: Ask ASAP
Model-agnostic gateway · context service · **intent router (data + shape)** · skill registry · streaming conversation · database tools · agentic document retrieval · enforced citations with page highlight · **evidence resolution API** · conversation summaries · routing evaluation set

v3.1: `economic_position` in the context envelope (§33); `skill_versions` economic-purpose columns (§17); `unit.position` and `unit.blockers` as read-only skills.

Ask ASAP is read-only at this point: it can answer, and it can create read-only Spaces.

### Phase 6: Work, approvals and controlled actions
Work items · tasks · deadlines · waiting states · notifications · exceptions · draft communications · approval requests · tool executor · idempotency · external sending · audit verification

v3.1: `unit.verify_transition` as a job step; exceptions (§24A) as first-class `exceptions` rows linked to unit and dimension; `client_instructions` / `cover_confirmations` as evidence entities if `client_decisions` proves insufficient.

## Vertical slices

Each slice ships its skills, its Space recipes, its components, its Jobs, its automations, its Discover detectors and its reports — end to end, usable in production by one team.

### Phase 7: Renewals slice
The highest-volume, highest-value brokerage workflow, and the one the interface was designed around.
`renewal.*` skills · Renewal Space · Quote Comparison Space · `RenewalReadiness`, `TermComparison`, `InsurerResponseTracker` · renewal preparation Job with external waits · renewal detectors in Discover · the 30/60-day renewal automations.

v3.1: the full state vector for the renewal path (commitment → risk_information → market → client_decision → premium → cover → policy_evidence → renewal); `quote.check_comparability`, `quote.track_validity`, `placement.verify_cover_match`, `money.check_payment_condition`; scenarios 1, 3, 4, 5, 6 pass.

### Phase 8: Claims slice
`claim.*` skills · Claim Space and timeline · missing-document tracking · insurer follow-up · claim detectors · claim-from-email automation.

### Phase 9: Quote, placement and underwriting slice
`opportunity.*`, `quote.*`, `placement.*`, `underwriting.*` · Quote and Placement Spaces · insurer response tracking · client options and recorded decisions.

### Phase 10: Servicing slice
`service.*`, `tor.*`, `endorsement.*`, `certificate.*` · Service Request Space · endorsement tracking through to policy update.

### Phase 11: Money slice
`money.*`, `commission.*` · Money and Reconciliation Spaces · payment matching · statement reconciliation · debtor follow-up · money detectors.

v3.1: the M0–M8 money chain (§8A); `commission_receivables`, `wht_certificates`, `commission_adjustments`; `commission.check_wht_evidence`; commission aging; the trapped-value detectors; scenario 8 passes.

### Phase 12: Analysis and management
`analysis.*`, `team.*` · Report, Investigation and Team Spaces · saved and scheduled reports · workload and approval views.

v3.1: `effort_records`, `analysis.service_load`, `analysis.contribution` (§8B); the management control loop (§32); the eight-state summary for reports; `unit.close_check`; scenarios 2, 7, 9 pass.

### Phase 13: Full proactivity
Pattern and anomaly detection · portfolio risk alerts · premium leakage · suggested automations · cross-slice detector tuning.

v3.1: the economic leakage map as pattern detectors; operator-validated thresholds replace defaults (`docs/research/OPERATOR-VALIDATION.md`); scenario 10 and the full economic evaluation set pass.

## Ordering rule

A slice is not complete until its skills, Space, Job, detectors, automations and evidence paths all work. Half-slices across many lifecycles produce a demo. One complete slice produces a product a brokerage can use on Monday.

---

# 44. Production gates

ASAP cannot enter production until it passes:

## Brokerage isolation

* Brokerage A cannot retrieve Brokerage B's records.
* Brokerage A cannot open Brokerage B's files.
* Brokerage A cannot retrieve Brokerage B's chunks, verified by an RLS test and not only a gateway test.
* Brokerage A cannot open Brokerage B's Spaces, Jobs, attention items or automations.
* Background workers, automation runs and detectors set organization context per job and RLS still applies to them.
* AI memory remains brokerage-specific.
* Exports cannot cross brokerage boundaries.

## Document reliability

* Duplicate detection works.
* Version replacement is transactional and safe.
* Failed ingestion is visible.
* Document deletion removes all chunks.
* Original documents remain recoverable.
* Extraction review interface is in use before extracted values become authoritative.

## AI reliability

* Exact identifiers use database lookup.
* Every document answer carries at least one resolvable citation.
* Missing evidence causes abstention.
* Calculations are deterministic.
* Exhaustive jobs inspect every required record.
* Tool failures are not reported as success.
* Retrieval evaluation set passes the agreed threshold.
* Routing evaluation set passes the agreed threshold.

## Generated UI safety

* Every rendered component exists in the registry and validates against its schema.
* No displayed business value originates from model text.
* Permission-filtered blocks never reach an unauthorised user.
* A Space rendered against an earlier component version still renders.

## Experience integrity

* A Space's state always matches its underlying work item.
* Progress is derived from job steps, never authored.
* Reopening a Space does not duplicate it.
* Attention items deduplicate and self-resolve when their cause is resolved.
* A waiting job resumes on both its timer and its event.
* An interrupted job resumes exactly once after resolution.

## Action safety

* Unauthorized actions fail.
* Approval policies cannot be bypassed, including from automations.
* Approval payloads are frozen and superseded if their inputs change.
* Duplicate requests do not create duplicate transactions.
* Every external action produces an audit record.
* High-risk actions remain human-controlled.
* Every automation that can send externally has passed a test run.

---

# 45. Non-negotiable rules

ASAP will not:

* Mix brokerage data.
* Send documents to any third party for indexing or storage.
* Tie retrieval to a single model vendor.
* Expose model-provider or Supabase secret keys to the browser.
* Let the frontend provide arbitrary organization IDs, roles or permissions.
* Give AI unrestricted SQL access.
* Use vector search for exact database questions.
* Treat AI-generated values as authoritative without validation.
* **Render a component that is not in the registry, or display a business value taken from model text.**
* **Let the model author work status, progress or approval outcomes.**
* Ship a retrieval, routing or prompt change without an evaluation run.
* Allow AI to make final claims or coverage decisions.
* Allow uncontrolled external communication, including from automations.
* Treat chat history as the database.
* Hide AI actions, automation runs or job failures from the audit history.
* Rebuild insurance modules as primary navigation.
* Use n8n.

---

# 46. API surface

Organised by capability, not by screen.

```text
POST /intent                     utterance + client context → routed response (streamed)
GET  /context                    current context envelope (server-resolved)

GET  /spaces                     filtered by state, entity, owner, pinned
POST /spaces                     explicit creation (rare; usually router-created)
GET  /spaces/{id}                space + blocks + participants
POST /spaces/{id}/messages       ask within a Space (morphs it)
POST /spaces/{id}/blocks/{n}/pin
POST /spaces/{id}/state          complete, archive, reopen
GET  /spaces/{id}/history        space_events

GET  /jobs                       running, waiting, needs_you, failed
GET  /jobs/{id}                  job + steps + interrupts
POST /jobs/{id}/cancel
POST /jobs/{id}/interrupts/{iid}/resolve

GET  /attention                  ranked Discover feed for this user
POST /attention/{id}/acknowledge | /snooze | /dismiss

GET  /automations                list with plain-language descriptions
POST /automations                from natural language or structured definition
POST /automations/{id}/test      dry run over historical data
POST /automations/{id}/pause | /resume
GET  /automations/{id}/runs      history + condition traces
GET  /explain/{object_type}/{id} "why did ASAP create this?"

GET  /search                     unified: entities, documents, email, spaces
GET  /evidence/{ref}             resolve to document, page, highlight, signed URL

GET  /approvals                  pending for this user
POST /approvals/{id}/decide      approve or reject with reason

POST /ingest                     upload → ingestion job → proposed action
GET  /skills                     catalogue available to this role
GET  /components                 registry + schemas (for the client renderer)
```

Every endpoint resolves organization and role server-side from the session.

---

# 47. End-to-end workflows

## An account executive's day

```text
08:05  Opens ASAP. Discover shows 8 ranked items — no dashboard, no menus.
       Top card: Acme motor renewal, terms from 2 of 3 insurers, CIC outstanding.
08:06  [Continue] → the existing Acme Renewal Space reopens (not a new one).
       Progress 78%, read from job steps. Two term comparisons already prepared
       overnight by the 60-Day Renewal Watch automation.
08:10  "Why did APA increase the premium?"
       Space morphs: adds an explanation block with three cited chunks —
       loss ratio, a new excess, a rating change. Tap any figure → page and highlight.
08:15  "Draft a follow-up to CIC."
       Draft appears in the Space. Edits two lines. Approves. Sent, audited.
08:20  Drops a client's fleet spreadsheet in.
       Ingestion job runs visibly. ASAP finds 27 vehicles, flags one whose value
       conflicts with the 2025 schedule → job interrupt with both sources shown.
       Chooses the schedule value. The job resumes.
09:00  Discover: unhandled email from a client — a claim notification.
       [Review] → ASAP has already drafted a claim from it, found the policy and
       checked cover. Confirms. Claim Space opens with a document checklist.
11:30  "What is James waiting on?" → Work Space, no navigation, back in one tap.
16:00  "Prepare the client presentation for Acme."
       Recommendation block assembled from the comparison, with evidence.
       Requires approval to send → queued for the manager.
```

Nothing in that day required knowing which module contains a feature.

## A manager's day

```text
08:00  Discover, manager audience: approvals pending, work overdue, exceptions,
       one pattern card — "premium increases unusually high across six October
       motor renewals."
08:05  [Investigate] → Investigation Space pre-loaded with the six renewals,
       their insurers, prior premiums and loss ratios.
       "Is this all APA?" → morphs to a grouped comparison. It is.
08:20  Approvals: three quotations awaiting release. Each shows the frozen payload,
       the recommendation and its evidence. Approves two, rejects one with a reason.
       The rejection reopens its Space as needs_you for the executive.
09:00  "Who is overloaded?" → Team Space: workload by user, waiting items, overdue.
       "Move Grace's October renewals to David." → assignment actions prepared,
       approved in one step, audited.
14:00  "How are renewals performing this quarter?" → Report Space.
       "Split by account manager." → morphs. Pins it. Schedules it monthly.
15:00  Automations: the unhandled-email rule fired 400 times and was dismissed 390.
       Opens it, tightens the condition, runs a test over the last 30 days,
       reactivates.
```

---

# 48. Coverage map — Skill Map to backend

Every family in the Intent & Skill Map, its generated Space, and the backend components that serve it.

| Skill family | Generated Space | Primary tables | Services |
| --- | --- | --- | --- |
| `client.*` | Client Space | clients, client_contacts, client_assignments, entity_summaries | search, context, spaces |
| `opportunity.*`, `quote.*` | Quote Space, Quote Comparison Space | opportunities, quote_requests, insurer_quotes, quote_comparisons, recommendations, client_decisions | jobs (response tracking), email, documents |
| `placement.*`, `underwriting.*` | Placement Progress Space | placement_instructions, insurer_requirements, policies | jobs, approvals |
| `policy.*` | Policy Space | policies, policy_sections, insured_items, policy_terms, policy_limits, policy_status_history | documents, evidence |
| `service.*`, `tor.*`, `endorsement.*`, `certificate.*` | Service Request Space | service_requests, endorsements, endorsement_changes, certificates, cancellations | jobs, email, approvals |
| `claim.*` | Claim Space, Claim Timeline | claims, claim_incidents, claim_requirements, claim_documents, claim_updates, claim_status_history | jobs, email, documents, detectors |
| `renewal.*` | Renewal Space | renewal_cycles, renewal_requirements, renewal_quotes, renewal_decisions, renewal_outcomes | jobs, automations, detectors |
| `money.*`, `commission.*` | Money Space, Reconciliation Space | invoices, receipts, payments, commissions, commission_statements, outstanding_balances | deterministic calculation, detectors |
| `document.*` | Document Review Space | documents, document_versions, document_chunks, document_extractions | ingestion, hybrid search, evidence |
| `email.*` | Communication Space | mailboxes, email_threads, emails, email_attachments, email_entity_links, email_drafts | ingestion, approvals, detectors |
| `work.*` | Work Space | work_items, tasks, deadlines, exceptions | attention engine |
| `search.*` | Search Space | searchable_entities, document_chunks, emails, spaces | unified search |
| `analysis.*` | Report / Investigation Space | parameterised analytical queries, saved_reports | jobs, scheduling |
| `team.*` | Team Operations Space | organization_memberships, teams, work_items, approvals | approvals, workload |
| `automation.*` | Automation Space | automations, automation_versions, automation_runs, events | event bus, dispatcher |

Every skill's declared contract (required context, data sources, allowed and restricted actions, generated UI, user actions, approval, evidence, audit, failure behaviour) is stored in `skill_versions` and enforced at the gateway.

---

# 49. Coverage map — UI requirements to backend

The 32 design deliverables, and what serves each.

| # | UI deliverable | Backend |
| --- | --- | --- |
| 1 | Permanent application shell | §42; no module endpoints |
| 2 | Discover | §27 attention engine, detectors, scoring |
| 3 | Persistent Ask ASAP | §15 gateway, §16 router, §33 context envelope |
| 4 | Spaces system | §10, §25, `spaces` / `space_blocks` |
| 5 | Space lifecycle | §25 states derived from work items and approvals |
| 6 | Major Space patterns | §25 recipes, §18 component library |
| 7 | Morphing on follow-up | §25 morphing, superseded blocks, pinned blocks |
| 8 | UI primitives library | §18 `component_definitions` + validator |
| 9 | Jobs experience | §26 `jobs` / `job_steps` / `job_interrupts` |
| 10 | Automation builder | §28 natural-language authoring → versioned definition |
| 11 | Automation monitoring / history | §28 `automation_runs`, condition traces |
| 12 | Global search | §30 unified search, `searchable_entities` |
| 13 | + New / ingestion | §31 drag-drop inference, §13 visible ingestion job |
| 14 | Client-centric experiences | §48 `client.*`, `entity_summaries` |
| 15 | Quote / underwriting / placement | §48 `quote.*`, `placement.*`, `underwriting.*` |
| 16 | Policy / servicing / TOR / endorsement | §48 `policy.*`, `service.*`, `tor.*`, `endorsement.*` |
| 17 | Claims | §48 `claim.*`, claim detectors |
| 18 | Money / commission / reconciliation | §48 `money.*`, `commission.*`, deterministic calculation |
| 19 | Generated reporting / investigation | §32 parameterised analysis, saved reports |
| 20 | Approval patterns | §21 frozen payloads, contextual `ApprovalCard` |
| 21 | Evidence / source patterns | §23 resolution API, `SourceEvidence` |
| 22 | Empty states | §36 three distinct empties; seeded Discover |
| 23 | Loading / AI-working | §35 streamed blocks, §26 visible steps |
| 24 | Waiting on third party | §36, `waiting_on` / `waiting_since`, escalation |
| 25 | Missing data | §36 skill `failure_behaviour`, partial results |
| 26 | Error / uncertainty | §36 confidence, review status, fallbacks |
| 27 | Navigation between Spaces | §25 `related_entity_refs`, Space graph |
| 28 | Mobile / responsive | §37 `mobile_behaviour`, viewport hint |
| 29 | Onboarding into the model | §7 step 9, `user_onboarding_state` |
| 30 | Employee daily workflow | §47 |
| 31 | Manager workflow | §47 |
| 32 | Skills lacking a user-facing path | §48; every family maps to a Space and an action |

---

# 50. Final architecture

```text
                    ASAP INSURANCE BROKER PLATFORM
                                 │
                        Multi-tenant application
                                 │
                          Context service
                                 │
                          Intent router
                                 │
                          Skill registry
                                 │
     ┌───────────────┬───────────┼───────────┬────────────────┐
     │               │           │           │                │
 PostgreSQL      Documents     Email     AI gateway       Event bus
     │               │           │           │                │
  Facts          Storage      Threads   Model-agnostic    Triggers
  Workflow       Chunks +     Drafts    Tool calling      Detectors
  Memory         hybrid       Links     Citations         Job wake-ups
  Permissions    search       Entity    UI plans          Summaries
     │               │        linking       │                │
     └───────────────┴───────────┴──────────┴────────────────┘
                                 │
                       UI plan validator
                                 │
                        Approval engine
                                 │
                         Secure executor
                                 │
              Spaces  ·  Jobs  ·  Attention items
                                 │
                          Audit history
```

> ASAP is a secure multi-tenant AI operating system for insurance brokers. Underneath the conversation it tracks one economic unit — a client, a policy, a period of cover — through the states that turn work into cover, commission, cash and a retained client, computing each position from facts and evidence and never from a model. Supabase owns brokerage identity, permissions, business records, workflows, memory, original documents, the searchable document index, email, and audit history. Models from any provider are called only for reasoning, interpretation and drafting, through a gateway that can swap them freely. The intent router turns what a broker says into insurance skills; skills compose validated components into Spaces where work lives; Jobs make machine work observable; Discover surfaces what matters before it is asked for; automations let a brokerage teach ASAP how it operates. Each brokerage receives a private workspace protected by database-level isolation. AI assists and acts only through permission-checked tools, cites every document claim to its source page, renders only components the system defines, and leaves consequential insurance and financial decisions with authorized people.
