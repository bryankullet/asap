# ASAP Main Browser Acceptance

Status date: 13 Oct 2026 · live on `main` at `b00daa0` · owner instruction of 12 Oct 2026.

**Result so far: 0 of 83 scenarios PASS. Final recommendation: NO-GO.**
Nothing below has been exercised in a main visible browser yet. The automated suites (§6) are
supporting evidence only and are not counted as acceptance.

## 1. Environment status (updated 13 Oct 2026)

The owner decided to test on the live site, not staging. The release is live: the database is at 0091,
and the API, web and worker run `main` at `b00daa0` with `APP_ENV=production`.

| Requirement | Status | Detail |
|---|---|---|
| Main visible browser | **BLOCKED for Claude** | The development session is a cloud container with no visible browser. The owner tests directly on https://asap-web.onrender.com; a Claude session on the owner's computer (Claude Desktop, or `claude remote-control`) can drive a visible browser there. |
| Application environment | **Ready** | Live site, production database with RLS, the owner's real brokerage (owner's choice: test actions become real audit history). |
| Real AI gateway | **Ready** | Live API boot: `provider=anthropic configured=true keyPresent=true`. |
| Document processing | **Ready** | Live extractor (`asap-extractor`), healthy. |
| Email | **BLOCKED** | Mailbox connection can start but not finish (known limit); nothing is sent to insurers or clients. |

## 2. How results are recorded

Each scenario below moves to PASS or FAIL only after it is exercised in a visible browser on the live
site, by the owner or by a Claude session with a visible browser. Automated suites never count.

## 3. Journey inventory

Statuses: PASS (verified in the main browser) · FAIL · BLOCKED (exact reason) · NOT TESTED. Only PASS
counts. Each scenario follows the method in the instruction: act through visible controls, observe,
check the authoritative state, refresh, interrupt and recover, repeat at 390 px where applicable.

### A Authentication and onboarding

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| A1 | Sign in on the live site | BLOCKED | Not yet exercised in a visible browser on the live site |
| A2 | Sign out; protected address redirects to sign-in | BLOCKED | Not yet exercised in a visible browser on the live site |
| A3 | Create a brokerage (first-run setup) | BLOCKED | Not yet exercised in a visible browser on the live site |
| A4 | Invite a member; accept the invitation in a second browser profile | BLOCKED | Not yet exercised in a visible browser on the live site; invitation email goes through Resend |
| A5 | Revoke an invitation; revoked link refused | BLOCKED | Not yet exercised in a visible browser on the live site |
| A6 | Change a member's role; new role takes effect after refresh | BLOCKED | Not yet exercised in a visible browser on the live site |
| A7 | Switch brokerage (member of two); no data from the other visible | BLOCKED | Not yet exercised in a visible browser on the live site |
| A8 | Session expiry: expired token returns to sign-in, then back to the same address | BLOCKED | Not yet exercised in a visible browser on the live site |

### B Home and navigation

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| B1 | Home: what needs me, ASAP is handling, changes since last visit | BLOCKED | Not yet exercised in a visible browser on the live site |
| B2 | Work: Needs me · ASAP is handling · Waiting on others · Upcoming · Done | BLOCKED | Not yet exercised in a visible browser on the live site |
| B3 | Work row opens its workflow, never chat | BLOCKED | Not yet exercised in a visible browser on the live site |
| B4 | Automations surface: standing instructions and firing history | BLOCKED | Not yet exercised in a visible browser on the live site |
| B5 | Activity surface | BLOCKED | Not yet exercised in a visible browser on the live site |
| B6 | Search palette finds a client, policy and work item | BLOCKED | Not yet exercised in a visible browser on the live site |
| B7 | New palette starts a conversation or work | BLOCKED | Not yet exercised in a visible browser on the live site |
| B8 | Recent lists conversations, workflows and records; survives refresh and a second device | BLOCKED | Not yet exercised in a visible browser on the live site |
| B9 | Pin and unpin work; pin survives refresh | BLOCKED | Not yet exercised in a visible browser on the live site |
| B10 | Browser Back and Forward across surfaces | BLOCKED | Not yet exercised in a visible browser on the live site |
| B11 | Refresh on every surface reopens the same surface | BLOCKED | Not yet exercised in a visible browser on the live site |
| B12 | Deep link pasted into a new tab opens the surface after sign-in | BLOCKED | Not yet exercised in a visible browser on the live site |
| B13 | Mobile: bottom bar, More sheet, Work tabs scroll | BLOCKED | Not yet exercised in a visible browser on the live site |

### C Ask ASAP

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| C1 | Normal question answered from records with citations | BLOCKED | Not yet exercised in a visible browser on the live site |
| C2 | Ambiguous request asks a clarification | BLOCKED | Not yet exercised in a visible browser on the live site |
| C3 | Request composes a workspace | BLOCKED | Not yet exercised in a visible browser on the live site |
| C4 | Portfolio filtering, grouping and compare in plain language | BLOCKED | Not yet exercised in a visible browser on the live site |
| C5 | Evidence request opens document, page and highlight | BLOCKED | Not yet exercised in a visible browser on the live site |
| C6 | Natural-language refinement of the current view | BLOCKED | Not yet exercised in a visible browser on the live site |
| C7 | Real AI fallback: a request no rule matches is read by the model | BLOCKED | Not yet exercised in a visible browser on the live site |
| C8 | Unsupported request is declined plainly | BLOCKED | Not yet exercised in a visible browser on the live site |
| C9 | Unsafe action request (send, bind, decide cover) refused | BLOCKED | Not yet exercised in a visible browser on the live site |
| C10 | Context retained across follow-ups and after refresh | BLOCKED | Not yet exercised in a visible browser on the live site |
| C11 | Live model-fallback evaluation thresholds met through the browser | BLOCKED | Not yet exercised in a visible browser on the live site; thresholds in §5 |

### D Clients and documents

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| D1 | Create a client; edit it; change persists after refresh | BLOCKED | Not yet exercised in a visible browser on the live site |
| D2 | Import clients and policies from a file; resolve duplicates | BLOCKED | Not yet exercised in a visible browser on the live site |
| D3 | Upload a document | BLOCKED | Not yet exercised in a visible browser on the live site |
| D4 | Extraction runs on the ASAP extractor | BLOCKED | Not yet exercised in a visible browser on the live site |
| D5 | Extraction review: accept and correct fields | BLOCKED | Not yet exercised in a visible browser on the live site |
| D6 | Citation opens the document at the page with the highlight | BLOCKED | Not yet exercised in a visible browser on the live site |
| D7 | Client investigation workspace | BLOCKED | Not yet exercised in a visible browser on the live site |

### E Insurance operations

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| E1 | Renewal: start from Work | BLOCKED | Not yet exercised in a visible browser on the live site |
| E2 | Quotation request prepared, approved, delivery recorded | BLOCKED | Not yet exercised in a visible browser on the live site |
| E3 | Insurer response recorded; revised quotation recorded | BLOCKED | Not yet exercised in a visible browser on the live site |
| E4 | Quotation comparison | BLOCKED | Not yet exercised in a visible browser on the live site |
| E5 | Client decision recorded | BLOCKED | Not yet exercised in a visible browser on the live site |
| E6 | Placement request approved and submission recorded | BLOCKED | Not yet exercised in a visible browser on the live site |
| E7 | Issuance request approved and submission recorded | BLOCKED | Not yet exercised in a visible browser on the live site |
| E8 | Issued policy checked; cover verified only by the server's check | BLOCKED | Not yet exercised in a visible browser on the live site |
| E9 | Renewal reaches verified outcome; stage nine shows cover in force | BLOCKED | Not yet exercised in a visible browser on the live site |
| E10 | Claim: register, request and receive documents, notes, clock | BLOCKED | Not yet exercised in a visible browser on the live site |
| E11 | Endorsement: create, record instruction, item decided, applied | BLOCKED | Not yet exercised in a visible browser on the live site |
| E12 | Workflow exception surfaces in Work and is resolved | BLOCKED | Not yet exercised in a visible browser on the live site |
| E13 | Hand over work to a colleague; colleague acknowledges | BLOCKED | Not yet exercised in a visible browser on the live site |
| E14 | Follow-up now, move follow-up, escalate, pause, resume | BLOCKED | Not yet exercised in a visible browser on the live site |
| E15 | Communication states: prepared, approved, copied, sent recorded | BLOCKED | Not yet exercised in a visible browser on the live site |

### F Intelligent UI

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| F1 | Composition changes with the renewal's real state | BLOCKED | Not yet exercised in a visible browser on the live site |
| F2 | Progressive disclosure: collapsed context expands | BLOCKED | Not yet exercised in a visible browser on the live site |
| F3 | Relevant context and consequence statements from records | BLOCKED | Not yet exercised in a visible browser on the live site |
| F4 | Progress opportunities and responsibility/obligations | BLOCKED | Not yet exercised in a visible browser on the live site |
| F5 | Exploration of up to three alternatives, labelled hypothetical | BLOCKED | Not yet exercised in a visible browser on the live site |
| F6 | Save a proposal; v1 then v2; survives refresh | BLOCKED | Not yet exercised in a visible browser on the live site |
| F7 | Continuity: arrangement kept per person across refresh and devices | BLOCKED | Not yet exercised in a visible browser on the live site |
| F8 | Polling update arrives while a form has typed text; text preserved | BLOCKED | Not yet exercised in a visible browser on the live site; needs a second session or worker to change the record |
| F9 | Governed command from a block runs and shows the endpoint's receipt | BLOCKED | Not yet exercised in a visible browser on the live site |
| F10 | Read-only member is offered no commands | BLOCKED | Not yet exercised in a visible browser on the live site |
| F11 | Responsive layout at 1440 and 390 | BLOCKED | Not yet exercised in a visible browser on the live site |
| F12 | Loading, unavailable, refused and not-connected states | BLOCKED | Not yet exercised in a visible browser on the live site |

### G Automations and communications

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| G1 | Create and manage a supported automation | BLOCKED | Not yet exercised in a visible browser on the live site |
| G2 | Scheduled execution fires and is recorded, including a no-op firing | BLOCKED | Not yet exercised in a visible browser on the live site |
| G3 | Automation history | BLOCKED | Not yet exercised in a visible browser on the live site |
| G4 | Connect a mailbox (Gmail / Microsoft 365) | BLOCKED | Not yet exercised in a visible browser on the live site; known limit: can start but not finish connecting (CLAUDE.md, D-070) |
| G5 | Inbound email classified and read into a proposal | BLOCKED | Not yet exercised in a visible browser on the live site; needs a connected staging mailbox |
| G6 | Draft prepared from records | BLOCKED | Not yet exercised in a visible browser on the live site |
| G7 | Draft approved and authorised send recorded | BLOCKED | Not yet exercised in a visible browser on the live site; sending needs a connected mailbox; must not reach real insurers |
| G8 | Delivery failure shown and recovered | BLOCKED | Not yet exercised in a visible browser on the live site |

### H Roles and permissions (UI and independently at API/RPC)

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| H1 | Owner/admin | BLOCKED | Not yet exercised in a visible browser on the live site |
| H2 | Broker / account handler | BLOCKED | Not yet exercised in a visible browser on the live site |
| H3 | Claims handler | BLOCKED | Not yet exercised in a visible browser on the live site |
| H4 | Read-only member: no commands offered; direct API and RPC writes refused | BLOCKED | Not yet exercised in a visible browser on the live site |
| H5 | Member of another brokerage: no rows, no addresses | BLOCKED | Not yet exercised in a visible browser on the live site |

### I Visual acceptance in the running app

| ID | Scenario | Status | Reason / extra dependency |
|---|---|---|---|
| I1 | Every major surface at 1440 and 390: cards, type, shadows, spacing, no overflow | BLOCKED | Not yet exercised in a visible browser on the live site |
| I2 | Keyboard-only pass with visible focus | BLOCKED | Not yet exercised in a visible browser on the live site |
| I3 | Contrast and reduced motion | BLOCKED | Not yet exercised in a visible browser on the live site |
| I4 | Layout stable during polling updates | BLOCKED | Not yet exercised in a visible browser on the live site |

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

1. Visible-browser execution of every scenario (owner on the live site, or a Claude session on the owner's computer).
2. Mailbox connection cannot finish yet (G4–G7).
3. Live AI evaluation: no real model calls recorded yet.

## 9. Recommendation

**NO-GO.** The Intelligent UI is not production-ready or locked until main-browser acceptance is complete.
