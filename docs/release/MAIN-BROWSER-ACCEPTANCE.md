# ASAP Main Browser Acceptance

Status date: 12 Oct 2026 · branch `claude/living-interface` at `646fa78` · owner instruction of 12 Oct 2026.

**Result so far: 0 of 83 scenarios PASS. Final recommendation: NO-GO.**
Nothing below has been exercised in a main visible browser yet. The automated suites (§6) are
supporting evidence only and are not counted as acceptance.

## 1. Environment status

| Requirement | Status | Detail |
|---|---|---|
| Main visible browser | **BLOCKED** | The development session runs in a cloud container. It has headless Chromium (used by the automated suites) and no visible browser, remote browser or computer-use tool. Main-browser runs need a session on the owner's own computer: Claude Desktop, or `claude remote-control` in the repository folder, which then appears in the Claude Code app. |
| Staging frontend | **BLOCKED — needs approval** | Render deploys `main` only (`asap-web`, `asap-api`, `asap-worker`, `asap-extractor`). No staging service exists for this branch. |
| Staging database (Supabase, RLS) | **BLOCKED — needs approval** | The only hosted project is production, at 0078. 0079–0091 must not go there before approval. Proposal: a Supabase branch of production, which is billed while it exists, or a separate staging project. |
| Real AI gateway | **BLOCKED — needs a key in staging** | Production API has it (`provider=anthropic configured=true`). Staging needs its own `AI_DEFAULT_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`, entered in the Render dashboard, never in chat. |
| Document processing | **BLOCKED — needs approval** | Staging extractor service plus a private Storage bucket on the staging database. |
| Email | **BLOCKED** | Mailbox connection can start but not finish (known limit). Staging needs OAuth apps registered for its domain. Sending must never reach real insurers or clients. |
| Test accounts and data | **Ready to create** | The two-brokerage seed fixture (`supabase/seed.sql`) gives synthetic brokerages, people in several roles, clients and policies. |

## 2. Staging plan (needs the owner's approval before anything is created)

1. **Database:** create a Supabase branch of `Asap`, or a new staging project. Apply 0001–0091 and the
   synthetic seed. Never use production rows.
2. **Services:** create Render services from `claude/living-interface`, mirroring the production four:
   web (static), API, worker and extractor. Point them at the staging database. Give them their own
   secrets: Supabase URL and keys for staging, the AI gateway variables, and `RESEND_API_KEY` with a
   test sender, or leave mail off.
3. **Auth:** add the staging web address to the staging Supabase project's allowed redirect URLs.
4. **Accounts:** one owner, one broker, one claims handler and one read-only member per brokerage,
   with passwords held by the owner.
5. **Browser:** run the session from the owner's computer so the visible browser is available. Then
   execute §3 in order, recording each result with a screenshot from the running application.
6. **Teardown:** delete the staging branch or project and the staging services afterwards.

Cost: the Supabase branch and four Render services are billed while they exist.

## 3. Journey inventory

Statuses: PASS (verified in the main browser) · FAIL · BLOCKED (exact reason) · NOT TESTED. Only PASS
counts. Each scenario follows the method in the instruction: act through visible controls, observe,
check the authoritative state, refresh, interrupt and recover, repeat at 390 px where applicable.

### A Authentication and onboarding

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| A1 | Sign in with a staging test account | BLOCKED | No visible browser; no staging environment |
| A2 | Sign out; protected address redirects to sign-in | BLOCKED | No visible browser; no staging environment |
| A3 | Create a brokerage (first-run setup) | BLOCKED | No visible browser; no staging environment |
| A4 | Invite a member; accept the invitation in a second browser profile | BLOCKED | No visible browser; no staging environment; needs Resend credentials in staging, or the invitation link copied from the UI |
| A5 | Revoke an invitation; revoked link refused | BLOCKED | No visible browser; no staging environment |
| A6 | Change a member's role; new role takes effect after refresh | BLOCKED | No visible browser; no staging environment |
| A7 | Switch brokerage (member of two); no data from the other visible | BLOCKED | No visible browser; no staging environment |
| A8 | Session expiry: expired token returns to sign-in, then back to the same address | BLOCKED | No visible browser; no staging environment |

### B Home and navigation

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| B1 | Home: what needs me, ASAP is handling, changes since last visit | BLOCKED | No visible browser; no staging environment |
| B2 | Work: Needs me · ASAP is handling · Waiting on others · Upcoming · Done | BLOCKED | No visible browser; no staging environment |
| B3 | Work row opens its workflow, never chat | BLOCKED | No visible browser; no staging environment |
| B4 | Automations surface: standing instructions and firing history | BLOCKED | No visible browser; no staging environment |
| B5 | Activity surface | BLOCKED | No visible browser; no staging environment |
| B6 | Search palette finds a client, policy and work item | BLOCKED | No visible browser; no staging environment |
| B7 | New palette starts a conversation or work | BLOCKED | No visible browser; no staging environment |
| B8 | Recent lists conversations, workflows and records; survives refresh and a second device | BLOCKED | No visible browser; no staging environment |
| B9 | Pin and unpin work; pin survives refresh | BLOCKED | No visible browser; no staging environment |
| B10 | Browser Back and Forward across surfaces | BLOCKED | No visible browser; no staging environment |
| B11 | Refresh on every surface reopens the same surface | BLOCKED | No visible browser; no staging environment |
| B12 | Deep link pasted into a new tab opens the surface after sign-in | BLOCKED | No visible browser; no staging environment |
| B13 | Mobile: bottom bar, More sheet, Work tabs scroll | BLOCKED | No visible browser; no staging environment |

### C Ask ASAP

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| C1 | Normal question answered from records with citations | BLOCKED | No visible browser; no staging environment |
| C2 | Ambiguous request asks a clarification | BLOCKED | No visible browser; no staging environment |
| C3 | Request composes a workspace | BLOCKED | No visible browser; no staging environment |
| C4 | Portfolio filtering, grouping and compare in plain language | BLOCKED | No visible browser; no staging environment |
| C5 | Evidence request opens document, page and highlight | BLOCKED | No visible browser; no staging environment |
| C6 | Natural-language refinement of the current view | BLOCKED | No visible browser; no staging environment |
| C7 | Real AI fallback: a request no rule matches is read by the model | BLOCKED | No visible browser; no staging environment; needs the AI gateway configured in staging |
| C8 | Unsupported request is declined plainly | BLOCKED | No visible browser; no staging environment |
| C9 | Unsafe action request (send, bind, decide cover) refused | BLOCKED | No visible browser; no staging environment; model path needs the AI gateway |
| C10 | Context retained across follow-ups and after refresh | BLOCKED | No visible browser; no staging environment |
| C11 | Live model-fallback evaluation thresholds met through the browser | BLOCKED | No visible browser; no staging environment; needs the AI gateway; thresholds in §5 |

### D Clients and documents

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| D1 | Create a client; edit it; change persists after refresh | BLOCKED | No visible browser; no staging environment |
| D2 | Import clients and policies from a file; resolve duplicates | BLOCKED | No visible browser; no staging environment |
| D3 | Upload a document | BLOCKED | No visible browser; no staging environment; needs staging Supabase Storage bucket |
| D4 | Extraction runs on the ASAP extractor | BLOCKED | No visible browser; no staging environment; needs a staging extractor service |
| D5 | Extraction review: accept and correct fields | BLOCKED | No visible browser; no staging environment |
| D6 | Citation opens the document at the page with the highlight | BLOCKED | No visible browser; no staging environment |
| D7 | Client investigation workspace | BLOCKED | No visible browser; no staging environment |

### E Insurance operations

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| E1 | Renewal: start from Work | BLOCKED | No visible browser; no staging environment |
| E2 | Quotation request prepared, approved, delivery recorded | BLOCKED | No visible browser; no staging environment |
| E3 | Insurer response recorded; revised quotation recorded | BLOCKED | No visible browser; no staging environment |
| E4 | Quotation comparison | BLOCKED | No visible browser; no staging environment |
| E5 | Client decision recorded | BLOCKED | No visible browser; no staging environment |
| E6 | Placement request approved and submission recorded | BLOCKED | No visible browser; no staging environment |
| E7 | Issuance request approved and submission recorded | BLOCKED | No visible browser; no staging environment |
| E8 | Issued policy checked; cover verified only by the server's check | BLOCKED | No visible browser; no staging environment |
| E9 | Renewal reaches verified outcome; stage nine shows cover in force | BLOCKED | No visible browser; no staging environment |
| E10 | Claim: register, request and receive documents, notes, clock | BLOCKED | No visible browser; no staging environment |
| E11 | Endorsement: create, record instruction, item decided, applied | BLOCKED | No visible browser; no staging environment |
| E12 | Workflow exception surfaces in Work and is resolved | BLOCKED | No visible browser; no staging environment |
| E13 | Hand over work to a colleague; colleague acknowledges | BLOCKED | No visible browser; no staging environment |
| E14 | Follow-up now, move follow-up, escalate, pause, resume | BLOCKED | No visible browser; no staging environment |
| E15 | Communication states: prepared, approved, copied, sent recorded | BLOCKED | No visible browser; no staging environment |

### F Intelligent UI

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| F1 | Composition changes with the renewal's real state | BLOCKED | No visible browser; no staging environment |
| F2 | Progressive disclosure: collapsed context expands | BLOCKED | No visible browser; no staging environment |
| F3 | Relevant context and consequence statements from records | BLOCKED | No visible browser; no staging environment |
| F4 | Progress opportunities and responsibility/obligations | BLOCKED | No visible browser; no staging environment |
| F5 | Exploration of up to three alternatives, labelled hypothetical | BLOCKED | No visible browser; no staging environment |
| F6 | Save a proposal; v1 then v2; survives refresh | BLOCKED | No visible browser; no staging environment |
| F7 | Continuity: arrangement kept per person across refresh and devices | BLOCKED | No visible browser; no staging environment |
| F8 | Polling update arrives while a form has typed text; text preserved | BLOCKED | No visible browser; no staging environment; needs a second session or worker to change the record |
| F9 | Governed command from a block runs and shows the endpoint's receipt | BLOCKED | No visible browser; no staging environment |
| F10 | Read-only member is offered no commands | BLOCKED | No visible browser; no staging environment |
| F11 | Responsive layout at 1440 and 390 | BLOCKED | No visible browser; no staging environment |
| F12 | Loading, unavailable, refused and not-connected states | BLOCKED | No visible browser; no staging environment |

### G Automations and communications

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| G1 | Create and manage a supported automation | BLOCKED | No visible browser; no staging environment |
| G2 | Scheduled execution fires and is recorded, including a no-op firing | BLOCKED | No visible browser; no staging environment; needs the staging worker running |
| G3 | Automation history | BLOCKED | No visible browser; no staging environment |
| G4 | Connect a mailbox (Gmail / Microsoft 365) | BLOCKED | No visible browser; no staging environment; known limit: can start but not finish connecting (CLAUDE.md, D-070); needs OAuth apps for a staging domain |
| G5 | Inbound email classified and read into a proposal | BLOCKED | No visible browser; no staging environment; needs a connected staging mailbox |
| G6 | Draft prepared from records | BLOCKED | No visible browser; no staging environment |
| G7 | Draft approved and authorised send recorded | BLOCKED | No visible browser; no staging environment; sending needs a connected mailbox; must not reach real insurers |
| G8 | Delivery failure shown and recovered | BLOCKED | No visible browser; no staging environment |

### H Roles and permissions (UI and independently at API/RPC)

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| H1 | Owner/admin | BLOCKED | No visible browser; no staging environment |
| H2 | Broker / account handler | BLOCKED | No visible browser; no staging environment |
| H3 | Claims handler | BLOCKED | No visible browser; no staging environment |
| H4 | Read-only member: no commands offered; direct API and RPC writes refused | BLOCKED | No visible browser; no staging environment |
| H5 | Member of another brokerage: no rows, no addresses | BLOCKED | No visible browser; no staging environment |

### I Visual acceptance in the running app

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| I1 | Every major surface at 1440 and 390: cards, type, shadows, spacing, no overflow | BLOCKED | No visible browser; no staging environment |
| I2 | Keyboard-only pass with visible focus | BLOCKED | No visible browser; no staging environment |
| I3 | Contrast and reduced motion | BLOCKED | No visible browser; no staging environment |
| I4 | Layout stable during polling updates | BLOCKED | No visible browser; no staging environment |

## 4. Known capability limits (stated, not simulated)

- **Mailbox connection** can start but not finish (D-070). G4–G7 stay BLOCKED until it is completed.
- **Commission and premium reconciliation workspaces** are not built; there are no records to compose
  them from (D-167). They are excluded from the inventory and are not claimed.
- **Demo mode** has no server-composed surfaces. It is not part of acceptance.

## 5. Live AI evaluation in the browser

Not run, and no real model calls have been made. These thresholds apply when it runs (the same ones as
`pnpm eval:workspace:live`):
- 0 unsafe action, cover or choice outcomes;
- 0 actions aimed at records outside the workspace;
- model-path intent at least 85%;
- model-path target at least 80%;
- latency and provider failures recorded.

In the browser it runs as C7, C9 and C11, using requests from
`docs/evaluation/workspace-model-fallback.json` typed into Ask inside the workspace.

## 6. Supporting automated evidence (not acceptance)

Final gate at `646fa78`, headless and harness-based, so it is **not** counted:
- typecheck, lint and build clean;
- unit tests: api 937, web 194, schema 118, workers 25, db 3;
- offline evaluations 47;
- connected tests 251 + 1 skipped, and the isolated timing tests 24;
- row-level security tests (pgTAP) 1,261;
- 14 browser-harness suites all passing.

The Postgres 17.6 release rehearsal is described in `RELEASE-0079-0091.md` §2a.

## 7. Defects, fixes and regressions

None recorded yet from main-browser execution.

## 8. Remaining blockers

1. A session with a visible browser, run from the owner's computer.
2. Approval to create the staging database and services (§2).
3. AI gateway variables entered in the staging API's settings.
4. Mailbox OAuth for the staging domain, and the known connection limit.

## 9. Recommendation

**NO-GO.** The Intelligent UI is not production-ready or locked until main-browser acceptance is complete.
