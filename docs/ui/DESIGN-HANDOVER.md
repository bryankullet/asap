# ASAP — UI design handover

**For:** Claude Design, or any designer taking on the interface.
**Status:** written 15 September 2026, against commit `e41431b`.
**Authority:** this document *summarises* and points into the controlling sources. Where it and
`docs/ASAP-Architecture-v3.1.md` disagree, the architecture wins. Where it and
`docs/ui/screen-map-v3.md` disagree on *what a screen knows about*, v3 wins.

---

## 0. What I am asking for

Design the interface for a product that is **already partly built and running**. This is not a
greenfield brief: a shell, twenty-six routes, a token file and a component library exist and are
deployed. Section 12 says exactly what exists, so you can tell redesign from new design.

What would help most, in order:

1. **The screens that have no design at all** — the money surfaces (N01–N04), certificates
   (T01–T02), screening review (K03), the approval surface (X01), source evidence (X02), conflict
   resolution (X03), and the premium breakdown panel (X08). These are specified in prose in
   §5 and have never been drawn.
2. **The generated-workspace layer** — "Work" screens are *composed from blocks*, not hand-laid
   pages (§8). The block vocabulary needs visual design: 45 component types, of which 9 exist.
3. **A pass over what is built** — the shell, Discover, Work, Jobs, Ask, Automations, Import. These
   were implemented from an approved interactive demo and are structurally right, but the inner
   screens still mix two generations of tokens.

What I am **not** asking for: a new information architecture. The navigation is settled and
constrained (§4), and one constraint in particular is non-negotiable — see §3.

---

## 1. What ASAP is

A multi-tenant AI operating system for insurance brokerages in Kenya. Each brokerage gets a private
workspace over its own clients, policies, documents and email. A person tells it what they need;
it assembles a workspace for that piece of work and prepares actions for a human to approve.

**It is not a chatbot bolted onto insurance software, and it is not a menu-driven insurance CRM.**
Both of those are the failure modes this design exists to avoid.

The people using it are brokers, account handlers, claims staff, a finance person and a principal
officer, in a brokerage of roughly 8–30 people placing cover for something like 1,400 clients. They
work fast, keyboard-first, and they are interrupted constantly. The product's job is to make the
state of the business legible and to remove preparation work — not to make anyone browse.

### The underlying model, briefly

Under the conversation, ASAP tracks one **economic unit** — a client, a policy, a period of cover —
through the states that turn work into cover, commission, cash and a retained client.

This matters to you for one reason: **the economic state is never shown to the user.** There are
eight internal states with codes; they never appear in UI copy, tooltips or alt text. Screens speak
plain brokerage language. Do not design a status pipeline visualisation of them.

---

## 2. The people, and what each one needs to see

Not formal personas — these are the shapes of need the screens have to serve.

| Who | What their day is | What they need from a screen |
|---|---|---|
| **Broker / account handler** | Placing and renewing cover, chasing insurers | What can move now, what is waiting on whom and since when, one clear next action |
| **Claims handler** | Documents, insurers, clients who are anxious | What is missing, what was sent, what the insurer has actually said |
| **Finance** | Invoices, receipts, commission, insurer settlement | Which of three commission figures they are looking at, and what has not been reconciled |
| **Principal officer** | Regulatory exposure, overrides, licensing | Where the brokerage itself is exposed, and every override that was used |
| **Admin / owner** | Members, roles, connections, rules | Who can do what, what ASAP is allowed to read |

---

## 3. Hard constraints on the design

These come from §45 of the architecture. Breaking one is a defect, not a style disagreement. The
ones that bind a designer:

1. **No insurance-module navigation.** There is no `Work / Clients / Policies / Renewals / Claims /
   Money` menu tree, and no insurance object is ever a primary destination. If you find yourself
   designing a list page for an entity type, that is the old product leaking back in.
2. **Never render a business value that came from model text.** The model chooses which component
   shows a figure; the figure is read from the database. A premium that came out of a language model
   is a defect however right it looks.
3. **Progress and status are derived, never authored.** The model may not write work status,
   progress or approval outcomes.
4. **The model may not make final claims or coverage decisions**, and may not clear a client file,
   issue a certificate, attribute money or move money. It prepares; a person decides.
5. **Abstention is a state, not a blank.** When evidence is missing the screen says so. It never
   shows a confident empty value, and never a zero where the answer is "not stated".
6. **Every cited figure is tappable** to its document, page and highlight region. A citation you
   cannot open is not a citation.
7. **Permission filtering happens server-side.** Blocks a person may not see are removed before the
   page reaches the browser. Never design a render-then-hide-with-CSS pattern.
8. **Every system state is designed** (§9). A screen with only a happy path is unfinished.
9. **Mobile is a first-class layout, not a squeeze.** And never hide approval evidence or financial
   totals merely to fit a phone.
10. **Do not use colour alone to carry status.**

---

## 4. The shell

Settled, implemented, and not up for redesign at the structural level. Decision D-064.

```
ASAP
────────────────
✦ Discover        what deserves attention now
⌁ Ask ASAP        the conversation, in full
▱ Work            what a person owns
◴ Jobs            what ASAP is processing
⌘ Automations     standing instructions, and every firing
────────────────
⌕ Search
＋ New
────────────────
Profile
```

**Implemented geometry** (ported from the approved demo): a `228px 1fr` grid filling the viewport.
Sidebar `#f1f4f0` with a `#e0e5e0` right border. Each destination is a 42px row, 13px radius; the
active one is a white pill with a 1px shadow. The application does not scroll — the panes do. Under
900px the sidebar becomes a 58px bottom bar.

Four things about the shell that are load-bearing:

- **Ask ASAP is both a destination and a persistent composer.** It is docked on every surface and
  never covers content; it is *also* a full screen with the conversation, its context chip, the
  generated Work panel and the evidence.
- **Work and Jobs are deliberately separate.** Jobs is what *ASAP* is processing; Work is what a
  *person* owns. A finished Job means ASAP produced an output — never that a policy renewed, a claim
  was accepted, or money arrived.
- **Runs appear in an Activity chip** beside the Ask composer, never in navigation.
- **The word "Space" never appears on screen.** It is called Work. "Space" is internal vocabulary.

Everything else in the product — all 60 surfaces in §5 — is reached from a Work item, a record, Ask,
or settings. **None of them becomes a sixth destination.**

---

## 5. The surface inventory

60 surfaces. Build status: **live** = a real route rendering real rows; **framed** = route exists,
inner design incomplete or on older tokens; **not built** = specified in prose only.

### Getting in — O

| ID | Surface | Status |
|---|---|---|
| O01 | Sign in, sign up, forgotten password, reset, invitation accept | live |
| O02 | Choose or create a brokerage (onboarding) | live |
| O03 | Add files or paste information — **import** | live |
| O04 | Review an import: duplicates, conflicts, what was read | framed |
| O05 | Connect email (Gmail / Microsoft 365 OAuth) | framed — can start, cannot finish |
| O06 | Connection status and sync review | framed |

**On import, and this matters for the design:** a brokerage's book arrives as **any document type** —
CSV, spreadsheet, or a PDF policy schedule — and the system reads the table out of it, proposing a
column mapping a person confirms. Every imported client lands as **Not started** on their compliance
file. An imported client is never assumed cleared. Day one should show the size of the backlog, not
hide it.

### The shell's own screens — H

| ID | Surface | Status |
|---|---|---|
| H01 | Discover, including first use | live |
| H02 | Ask ASAP | live |
| H03 | Work — Active · Waiting · For review · Completed · Pinned · Recent | live |
| H04 | Global search | live |
| H05 | + New | live |

### The work surfaces — S

These are the generated workspaces. S01–S20: Client · Opportunity and quote · Quote and cover
comparison · Placement and underwriting · Policy · Servicing request · TOR preparation ·
Endorsement · Certificate request · Claim · Renewal · Money · Reconciliation · Document review ·
Communication · Work · Report · Investigation · Team operations · Exceptions, cancellation and
economic closure.

**Status:** one record page (`/r/$recordId`) with composed panels serves several of these today, and
a first Renewal workspace exists behind a flag. The rest are **not built as designed surfaces**. This
is the largest single piece of design work and §8 explains how it is assembled.

### Jobs and automations — J, A

| ID | Surface | Status |
|---|---|---|
| J01 | Jobs — All · Running · Waiting · Work · Completed | live |
| J02 | Job detail and recovery | framed |
| A01 | Automations — standing instructions and the history of every firing, **including the ones that did nothing, and why** | live |
| A02 | Creating an automation — trigger, conditions, skill, prepared action, approval, whether it reaches outside the brokerage | live |
| A03 | Automation history and monitoring | live |

Automations are a *surface*, not a module: an automation **is** the thing, and there is no builder
rebuilding a menu tree behind it.

### Compliance — K *(new in v3)*

| ID | Surface | Status |
|---|---|---|
| K01 | Client files register — Blocking live work · Incomplete · Refresh due · Cleared · Not started | live |
| K02 | A client's file: identity documents held and missing, beneficial ownership, source of funds, screening results, the decision and who made it, refresh date | framed |
| K03 | Screening match review — the hit, the list, what matches and what does not, and: not a match · possible match, escalate · confirmed match | **not built** |

**The gate, which needs a designed treatment:** a placement cannot be approved while the client's
file is Not started, Incomplete or Blocked. The approval screen shows the block **as a reason, in
plain words** — *We cannot instruct cover for a client whose file is not complete* — with a direct
link to K02. The principal officer alone may override, in writing, and the override is permanently
audited and appears on their Discover.

### Insurer agreements — G *(new in v3)*

| ID | Surface | Status |
|---|---|---|
| G01 | Insurer agreements register. **The number that matters: how much commission is being expected against no documented rate.** On day one that is most of it — which is the point of showing it. | live |
| G02 | An agreement version: rate by class, effective dates, payment terms, sliding scale, and the clause each rate came from with a link to the page | framed |

ASAP reads an agreement and **proposes** rates; a person confirms each one before it is live. An
unconfirmed rate is never used in a comparison.

### Certificates as controlled stock — T *(new in v3, not built)*

A motor certificate is closer to a cheque book than to a document.

| ID | Surface |
|---|---|
| T01 | Certificate stock — Allocated · Issued · Voided · **Unaccounted**. Unaccounted is the important view: a number allocated and not shown as issued or voided is a live problem and stays on screen until resolved. |
| T02 | One certificate, its whole life. Issue against a policy; void with a reason; reprint — which records a reprint and never issues a second number. |

### Money — N *(new in v3, not built)*

| ID | Surface |
|---|---|
| N01 | **Money we can't place** — receipts that arrived and cannot be attributed. Amount, date, channel, whatever reference text came with it (often none), and candidate matches with the reason for each. **The total is shown prominently**: unattributed money in the bank is a liability, not a rounding item. ASAP may propose; it may never attribute. |
| N02 | Insurer account — the whole two-way position, **kept separate and never netted on screen**: premium due out, commission due in, unidentified receipts, disputes both ways. Plus the brokerage's own **regulatory exposure**: premium collected from clients and held beyond terms, as a named figure with its age. |
| N03 | Settlement run — which periods are being settled, base premium, levies and duty passed on, commission deducted, net payable, every component named. Preparing is not paying; approving is not payment. ASAP never moves money. |
| N04 | Tax certificates — withheld tax, certificates received, outstanding, and the total sitting unrecoverable. A policy year cannot close while one is outstanding. |

### Shared panels — X

| ID | Surface | Status |
|---|---|---|
| X01 | Approval and action review — the frozen payload a person is actually approving | **not built** |
| X02 | Source evidence — document, page, highlight region | **not built** as a panel |
| X03 | Missing facts, conflicts and duplicate choice | **not built** |
| X04 | Assign or hand off work | not built |
| X05 | Share, save and export scope | not built |
| X06 | Manual creation and focused editing | partial (`+ New`) |
| X07 | Effort and service-cost record | not built |
| X08 | **What makes up this premium** — every component, its rate or amount, its version, the total, and the commission basis named explicitly. Opens on *any* premium figure anywhere. Read-only. | **not built** |

### Settings and account — C

| ID | Surface | Status |
|---|---|---|
| C01 | Profile and company settings | framed |
| C02 | Members, roles and permissions | live |
| C03 | Data, access and security — what ASAP is allowed to read | live |
| C04 | Billing and subscription | not built |
| C05 | Audit history — everything that happened, in order, **including what ASAP only prepared** | live |
| C06 | Insurers, business rules and approval policy — levy rates, stamp duty, WHT rate, commission deadlines, all versioned with effective dates | **not built, and blocking** |

---

## 6. Vocabulary

**No word appears in two layers.** Position carries the layer: task status in the card headline,
cover status on the policy period line, money status in the money row.

| Layer | Words |
|---|---|
| **Task** | With ⟨named party⟩ · In progress · Done |
| **Run** | Working · Paused · Finished · Couldn't finish · Stopped |
| **Cover** | Draft · Requested · Submitted · Confirmed · Active cover · Expired · Cancelled |
| **Money** | Not invoiced · Unpaid · Part paid · Paid · Received · Reconciled · Disputed · Due to insurer · Settled |

Two **scoped** sets, which is the only reason the layer rule survives:

- **Client file** — Not started · Incomplete · In review · Cleared · Refresh due. These appear
  *only* on the client record header and K01–K03. On a work card an incomplete file shows as a
  blocked task with its reason: *Blocked — client file incomplete*.
- **Certificate stock** — Allocated · Issued · Voided · Unaccounted. Only on T01 and T02. Note
  **Voided**, not cancelled: the cover layer owns Cancelled, and a spoiled certificate is not
  cancelled cover.

**Retired words, which a test enforces:** "Needs you" appears nowhere. "Space" appears nowhere on
screen. Work's filters are exactly Active · Waiting · For review · Completed · Pinned · Recent.

**Job completion names the actual result** — *Renewal pack prepared* — and never claims the policy
renewed, the insurer accepted, or the money arrived.

---

## 7. Evidence, citation and abstention

The most distinctive thing about this product's screens, and the easiest to design away by accident.

Every fact ASAP shows carries a **condition**, one of six:

| Condition | Means | What the person should do |
|---|---|---|
| `known` | Read from a source, labelled | Trust it, check the source if it matters |
| `inferred` | Derived, not stated | Look before relying on it |
| `conflicting` | Two sources disagree — **both are kept** | Decide which is right |
| `missing` | Never given | Supply it or request it |
| `stale` | Was true, may not be | Refresh |
| `waiting` | Someone else owes it | Chase, or wait knowingly |

Rules that follow:

- **A conflict never resolves itself on screen.** Picking a winner between two policy numbers hides
  the exact thing a person needs to see. Show both, with their sources.
- **A field that was never given is stated, not omitted.** The absence is the information.
- **Where a value was never captured it reads *not stated*, never zero.**
- **Do not show confidence percentages.** Plain labels only — *Source confirmed*, *Check this
  value*, *Not enough information*. An uncalibrated number reads as a guarantee.
- **Everything extracted from a document arrives as `proposed`.** A person's acceptance is what
  turns a reading into a value. The extraction review screen (Phase 3's gate) is where that
  happens: a document viewer with page highlights, the proposed value beside the region it was read
  from, and accept/correct per field.

---

## 8. How a work screen is actually assembled

This is the part that most changes how you design. Work screens are **not hand-laid pages**.

```
model → UI plan (JSON) → server-side validation → registry lookup → React render
```

The model returns a list of components drawn from a fixed registry, with props and record IDs. It
never returns markup, and the frontend never evaluates anything it produced. Three consequences:

1. **A component not in the registry does not render.** The plan is rejected and the screen shows an
   error state. So: a new visual idea has to become a registry component, with a prop schema, before
   it can appear anywhere.
2. **Components are versioned.** A screen rendered in 2026 must still render in 2028. Deprecating a
   component means migrating stored blocks, not deleting the component.
3. **Design the vocabulary, not the page.** What you are designing is a set of blocks that compose
   sensibly in any order the model picks, plus the rules for how a screen made of them reads: one
   readable title, client and period, plain status, one short explanation, **one primary button**, at
   most two secondary controls beside it. Everything else lives in the relevant card or a labelled
   More menu.

### The registry

45 component types are specified. **Nine are implemented:** `ClientHeader`, `PolicyCard`,
`RenewalReadiness`, `TermComparison`, `InsurerResponseTracker`, `DraftEmail`, `Checklist`,
`ActivityFeed`, `SourceEvidence`.

The rest, grouped as the architecture groups them:

```
Client      ContactCard · RelationshipSummary
Policy      CoverageTable · PolicyTimeline · PolicySchedule · ExpiryIndicator
Quote       QuoteCard · QuoteComparison · CoverageComparison
Renewal     RenewalTimeline
Claim       ClaimStatus · ClaimTimeline · MissingDocuments · ClaimPartyCard
Document    DocumentCard · DocumentViewer · DocumentChecklist · ExtractionReview
Email       EmailThread · CommunicationSummary
Money       OutstandingPremiumCard · InvoiceTable · PaymentTimeline · CommissionReconciliation
Work        WorkCard · WaitingCard · ExceptionCard · ApprovalCard · AssignmentCard
Generic     RecommendationCard · Metric · Table · Chart · Timeline · Alert
```

The primitive layer that exists underneath: badge, button, card, checklist, chip, field, input,
layout, notice, overlay, select, table, timeline.

---

## 9. The seven system states

Every screen needs all seven designed. Implemented as shared components (`EmptyState`,
`LoadingList`, `MissingData`, `ErrorState`, `Stale`, `PermissionNotice`, `PartialSuccess`) — the
shapes exist, the visual design of each is worth a pass.

| State | What it must say |
|---|---|
| **Loading** | The actual step and scope, with the shell stable. Stop, where cancelling is safe. Long work becomes a Job so the person can leave. Step counts only when genuinely known. |
| **Empty** | Why nothing is here, and one useful next step. A new brokerage sees setup actions — **never sample business presented as real records**. |
| **ASAP is working** | What it is doing, on what. |
| **Waiting on a third party** | Who, what is expected, when waiting began, the last follow-up, the next check. Changing a next-check date never hides a policy expiry or resets a legal clock. |
| **Missing data** | A short checklist with Add · Request information · Enter manually. Distinguish Unknown, Not applicable and Confirmed missing. |
| **Uncertainty / conflict** | Both values, both sources, and the decision to make. |
| **Error / partial** | What failed, what succeeded, and whether anything changed. Retry, reconnect or manual handoff. An unknown execution outcome must be *checked* before repeating. Partial import, posting and assignment failures are itemised. |
| **Permission denied** | Explain safely, preserve navigation, and never leak restricted snippets, counts or another brokerage's context. |
| **Stale** | Last successful update and affected scope. New evidence invalidates dependent approvals if material. |

---

## 10. Money, and the rules that govern showing it

Premium is **not one number**. Every premium figure must declare which component it is:

| Component | Who receives it |
|---|---|
| Base premium | Insurer |
| Training levy (% of base) | Regulator, via insurer |
| PCF contribution (% of base) | Fund, via insurer |
| Stamp duty (fixed per policy) | Government |
| **Gross premium payable** — all of the above | Collected by the broker |
| **Commission basis** — base premium, **not** gross | — |

Commission is **three numbers**:

- **Gross commission** — basis × agreed rate from the insurer agreement
- **Withholding tax** — deducted at source, paid to KRA on the brokerage's behalf
- **Net commission received** — what lands in the bank

Withheld tax is **the brokerage's money**, recoverable only against a certificate. It is never
treated as a cost and never netted away silently. A design test from the screen map: *a finance
person shown a commission number can say which of the three it is, from the screen alone.*

**The reconciliation rule:** a comparison may only run between two figures of the same declared
component. If either side's component is unknown, the row is an **exception** with the reason
*component not stated* — never quietly matched, and never counted as a mismatch either. Without this
a levy-inclusive statement compared against base-premium commission produces a mismatch on every
row, burying three real problems under forty-four false ones.

**No rate, deadline or legal value is ever a constant.** Levy rates, stamp duty, WHT rate, the
commission deadline, the document clock — all are per-brokerage versioned rules with a source and a
verified-at date (C06). When a rate changes, existing policy periods keep the version they were
rated under.

---

## 11. Design tokens

`packages/ui/src/styles.css` is the single source; nothing else declares a colour, radius or shadow.
Consumed through Tailwind v4's `@theme`.

```
Fonts     Body: Figtree.  Headings: Outfit, letter-spacing -0.02em.
          System stack behind both — the app must be legible before the webfont lands.

Ink       #102a43 primary · #334e68 secondary · #66788a muted · #5b6e7d done
Navy      #102a43 as a surface · #173b5d hover
Surfaces  #ffffff paper · #f6f8f9 wash (page background) · #e7ecef sunken
Lines     #dfe6ea strong · #edf1f3 soft · #b8c6ce hover

Green     #0f7b5a · soft #e7f5ef · ink #096348      running, active, "ASAP is working"
Gold      #d9a62e · soft #fbf4dc · ink #755509 · line #ead490    waiting, attention
Red       #b94a48 · soft #fff0ef · ink #963b3a      needs review, error
Blue soft #eef5ff
Dot       #91a0aa neutral

Radius    18px cards · 12px controls · 10px compact · 99px pills
Shadow    card  0 14px 44px rgba(16,42,67,.09)
          lift  0 6px 22px rgba(16,42,67,.06)
          dock  0 12px 40px rgba(16,42,67,.13)
Sidebar   224px (shell implements 228px), bottom bar under 900px
```

**A card at rest is a hairline border and an 18px radius — never a drop shadow.** Shadows are for
things that float.

**Status colour is semantic and fixed:** green = running or active, gold = waiting, red = needs
review, grey = done. Do not re-map per screen, and never let colour be the only carrier.

Other token guidance from the screen map: 16px body, 24–32px headings, controls around 44px high,
strong text contrast, restrained colour, generous spacing, clear focus rings.

---

## 12. What exists today

Twenty-six routes, all behind two guards — a live session, then a resolved brokerage membership.
**There is no demo mode and no fixtures.** Every board reads the brokerage's own rows.

| Route | Screen | Reads |
|---|---|---|
| `/sign-in` `/sign-up` `/forgot-password` `/reset-password` `/auth/callback` `/invite/$token` | Getting in | — |
| `/onboarding` `/onboarding/create` | Create or join a brokerage | — |
| `/discover` | Discover | `GET /attention` |
| `/ask` | Ask ASAP in full | the gateway |
| `/work?view=` | Work | `GET /work` |
| `/jobs` `/jobs/$jobId` | Jobs | `GET /runs` |
| `/automations` `/automations/$id` | Automations | `GET /automations` |
| `/r/$recordId?panel=&view=` | A record, as composed panels | records + UI plans |
| `/search?q=` | Search | `GET /search` |
| `/files?view=` `/files/$clientId` | Client files (K01, K02) | clients + file state |
| `/settings/agreements` `/settings/agreements/$id` | Insurer agreements (G01, G02) | agreements |
| `/settings/members` | Members (C02) | memberships |
| `/settings/connections` | Data and connections (C03) | connections |
| `/documents` `/documents/$documentId` | Documents, and what ASAP read | documents + extractions |
| `/email` `/email/$threadId` | Email beside the work it belongs to | `GET /email/threads` |
| `/audit` | Audit history (C05) | `GET /audit` |
| `/import` | Import your book | import batches |
| `/new` | + New | — |

Behind the scenes and relevant to what you can design against: documents upload to private storage,
an event fires, a Python service reads the PDF and proposes every field with the rectangle it was
read from. AI column-mapping on import sees **headings only**, never data.

**Known gaps in what is built:** Files, Members, Agreements and AgreementVersion still use
first-generation tokens inside. The extraction review interface — the document viewer with page
highlights — is the Phase 3 gate and is **not designed**. Nothing in the money story exists.

---

## 13. Sequencing

Phases 1–3 are ordinary application screens; the generative layer comes later, because the component
registry depends on decisions not yet made.

| Phase | UI scope | State |
|---|---|---|
| 1 | Sign-in, create brokerage, invite, switcher, members | done |
| 2 | Import, duplicate resolution, mailbox connection | import and contacts done; mailbox can start, not finish |
| 3 | **Extraction review — document viewer with page highlights.** Required, not optional. | backend done, interface not designed |
| 4 | The permanent shell, component registry, UI-plan renderer, streaming, system states | shell done, registry 9 of 45 |
| 5 | Ask ASAP surface, citation → page → highlight, read-only Work screens | Ask exists; citation chain not built |
| 6 | Approval surface with frozen payloads (X01) | not started |
| 7+ | Per-slice components and recipes, shipped with their slice | — |

---

## 14. Open questions

Two of these **block** the money design; they are business decisions, not design ones, but the
design needs to know they are unresolved.

1. **Levy and duty rates** — the percentages and the duty amount must be confirmed against current
   law before anything is rated. **Blocking.**
2. **Withholding tax rate and scope** — getting this wrong misstates every commission figure.
   **Blocking.**
3. **Screening data source** — K03 assumes a sanctions and PEP list. Which one, refreshed how often,
   at whose cost. Without it K02 can collect a file but cannot screen it.
4. **Certificate system integration** — whether ASAP reads the regulator-backed issuance system
   directly or records references a person enters. The design works either way; the operational load
   differs enormously.
5. **Due diligence backfill policy** — 1,400 clients land Not started. Completed at next renewal, by
   risk band, or on a deadline? The register is built to support any of the three.

### Deliberately out of scope, so nobody assumes coverage

Regulatory returns and the brokerage's own licensing · co-insurance and split placements · premium
financing · introducer and sub-agent commission sharing · group scheme members · handover when
someone leaves · life and investment business · insurers' own portals.

---

## 15. How to know the design worked

From the screen map's own tests, which are worth designing against:

1. Someone who has never seen the product can tell, from Discover alone, what deserves their
   attention today and why.
2. A finished Job never reads as though a policy renewed, a claim was accepted or money arrived.
3. **The gate reads as a reason, not a refusal.** A broker blocked from approving a placement can
   say in their own words why, and what would unblock it, without asking anyone.
4. **Three commission figures.** A finance person shown a commission number can say which of the
   three it is from the screen alone.
5. **Unaccounted is understood as a problem.** Someone shown certificate stock understands that
   *Unaccounted* is a live problem to chase, not a tidy-up state.
6. A person can find the document, page and region behind any figure they doubt, in one action.

The honest caveat: these prove the screens are *legible*. They do not prove someone can conduct due
diligence properly or spot a commission arrangement being applied wrongly. That is professional
skill, and no interface supplies it.

---

## 16. Where to read further

| Source | What it holds |
|---|---|
| `docs/ASAP-Architecture-v3.1.md` | Controlling. §18 generative UI · §34 permissions · §36 system states · §37 responsive · §25–27 experience model |
| `docs/ui/screen-map-v3.md` | What the screens know about — compliance, agreements, certificates, money |
| `docs/ui/screen-map-v1-catalogue.md` | Per-screen detail: purpose, fields, actions, approvals, evidence, failure behaviour, for all 48 original surfaces |
| `docs/DECISIONS.md` | Every decision and its reason. D-064 the shell · D-069 no demo mode · D-070 import · D-072 extraction |
| `docs/skill-map.md` | The intents and skills behind each surface |
| `packages/ui/src/styles.css` | The tokens, authoritative |
| `apps/web/src/shell/` | The implemented shell |
