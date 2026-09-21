# ASAP component rebuild → production repository: integration map

Branch `claude/ui-integration`, cut from `claude/awaiting-files-md15v3` @ `8d81851` (0 behind `main`).
Written before any code change, as required.

## Correction to the brief's premise

The extractor and worker **code** is already on `main` (`e0f918d`, `586fa85`). The four commits the
branch is ahead by are: the Render blueprint entries for `asap-extractor` and `asap-worker`
(`9bf643b`), D-073 (`e41431b`), and two design documents (`50ca02a`, `8d81851`). So "bring in the
four commits" is one blueprint file plus documentation — nothing to port, nothing at risk.

`ASAP - offline.html` is **not in the ZIP**. Present are `ASAP.dc.html`, `asap-store.js`,
`asap-intent.js`, `asap-adapters.js`, `support.js`, `source/dist/*` (older, to be ignored on
conflict), `FIX-REPORT.md` and `GAP-TEST-REPORT.md`.

---

## 1. Shell and navigation

| ZIP screen or action | Existing React screen | Existing API | Existing DB record | Decision | Missing backend |
|---|---|---|---|---|---|
| Sidebar: Today · Work · Automations, then + New, Search, Profile at the bottom | `shell/Shell.tsx`, `shell/nav.ts` — currently **five** destinations (Discover · Ask ASAP · Work · Jobs · Automations) | `GET /me` | `organizations`, `organization_memberships`, `roles` | **Extend** — reduce to three, rename Discover → Today, drop Ask and Jobs from nav | — |
| Persistent Ask, every surface, collapsible | `shell/AskComposer.tsx`, `shell/AskThread.tsx` | `POST /conversations`, `GET /conversations/:id/messages` | `conversations`, `conversation_messages` | **Reuse** — already docked and persisted | Model provider not configured |
| Activity chip near Ask; run detail opens from it | `shell/ActivityChip.tsx`, `views/RunDetail.tsx` | `GET /runs`, `GET /runs/:id`, `GET /runs/:id/events`, `GET /runs/:id/stream` | `runs`, `run_events` | **Reuse** — chip exists; remove `/jobs` from nav, keep the route reachable from Activity | — |
| Workspace tabs, pin, close, More, Recent | `pages/Work.tsx` (filters), `components/PinButton.tsx` | `GET /work?view=`, `PUT /work-items/:id/pin`, `GET /pins` | `work_items`, `work_item_pins` | **Extend** — tab strip is new; pinning exists | Tab set is interface state → `localStorage` (permitted: no business data) |
| Role switcher | — (role comes from membership) | `GET /me`, `PATCH /organizations/current/members/:id` | `organization_memberships`, `roles`, `permissions` | **Discard** — the ZIP calls it a test affordance. Real role is server-resolved (§45 rule 5) | — |

## 2. Onboarding and getting in

| ZIP | Existing React | Existing API | DB | Decision | Missing backend |
|---|---|---|---|---|---|
| Welcome → company details → add records → connect email → finish | `pages/SignIn/SignUp/ResetPassword/AcceptInvitation/Onboarding/CreateOrganization` | `POST /organizations`, `POST /invitations/:token/accept`, `GET /invitations/:token` | `organizations`, `users`, `invitations` | **Extend** — screens exist; the 4-step short flow does not | — |
| Setup workspace (brokerage, users, approval rules, connections) | `pages/Members.tsx`, `pages/Connections.tsx` | members/roles/invitations endpoints | as above | **Reuse** | Approval-policy rules (C06) do not exist |

## 3. Records, imports, documents

| ZIP | Existing React | Existing API | DB | Decision | Missing backend |
|---|---|---|---|---|---|
| `records.import` — staged review, duplicate flag, one confirm | `pages/ImportBook.tsx` | `POST /imports`, `GET /imports`, `POST /imports/:id/commit` | `import_batches`, `import_rows`, `clients`, `policies`, `policy_periods` | **Reuse + extend** — reads any document type already; duplicate resolution UI is thin | Duplicate-resolution decisions are not recorded per row |
| `document.upload`, progress, cancel, failure | `pages/Documents.tsx` | `POST /documents`, `POST /documents/:id/filed` | `documents`, `document_pages`, `document_fields` | **Reuse** — real pipeline: storage → event → worker → extractor | Upload progress/cancel UI |
| Honest document states (Uploaded · Queued · Reading · Ready for review · Missing information · Conflict · Failed · Retry) | `pages/Documents.tsx`, `components/states.tsx` | `GET /documents/:id` | `documents.extraction_state`, `document_fields.state` | **Extend** — states exist in data; not all are drawn | Retry endpoint for a failed extraction |
| Extraction review, accept/correct per field | *(none — Phase 3 gate)* | `POST /documents/:id/fields/:fieldId/review` | `document_fields` (`proposed`/accepted) | **Build** — API exists, UI does not | Page-highlight viewer |
| `document.version`, version comparison | `pages/AgreementVersion.tsx` (agreements only) | — | `policy_versions`, `agreement_versions` | **Build** | Document versioning table + compare |

## 4. The insurance lifecycle

| ZIP action | Existing React | Existing API | DB | Decision | Missing backend |
|---|---|---|---|---|---|
| `opportunity.create` | — | — | — | **Build** | `opportunities` table |
| `quote.prepare`, `quote.reply`, `quote.choice`, compare | `views/RecordViews.tsx` partials; registry has `TermComparison`, `InsurerResponseTracker` | — | — | **Build** | `quotes`, `quote_versions`; choice requires client-decision evidence |
| `placement.create`, `placement.approve`, `approval.invalidate` | `views/RecordViews.tsx` | `POST /placements`, `POST /work-items/:id/actions` | `work_items`, `audit_log`; engine `apply.ts` + gate | **Extend** — engine has `placement`/`approval` kinds | `approvals` table with frozen payload + stale-on-material-change |
| `policy.issue` | `views/PolicyView.tsx` | `POST /policies` | `policies`, `policy_periods`, `policy_versions` | **Reuse** | Insurer-confirmation evidence requirement |
| `servicing.create`, `tor.request` | `views/EndorsementPanel.tsx`, `servicing.ts` | `POST /endorsements/:id/actions` | `endorsements`, `policy_versions` | **Extend** | `servicing_requests`, `tor_requests` |
| `cover.change` (endorsement, schedule v2, additional premium) | `views/EndorsementPanel.tsx` | `POST /endorsements/:id/actions` | `endorsements`, `policy_versions`, `policy_periods` | **Extend** | Additional-premium invoice on confirmation |
| `claim.register`, `claim.document`, `claim.update` | `views/ClaimPanel.tsx` | `POST /claims/:id/actions` | `claims`, `claim_documents`, `claim_notes` | **Reuse + extend** | Offer/settlement stages |
| `renewal.create` (new year beside old) | `spaces/RenewalSpace.tsx` (flag off) | `GET /spaces/:recordId` | `policy_periods` | **Extend** | Scheduled renewal/overdue sweep |

## 5. Money — the largest gap

| ZIP action | Existing React | Existing API | DB | Decision | Missing backend |
|---|---|---|---|---|---|
| Invoices, part payment, client balance | — | — | — | **Build** | `invoices`, `invoice_lines` + RLS |
| `payment.match`, partial payments | — | — | — | **Build** | `payments`, matching + idempotency |
| `reconcile.run`, `reconcile.resolve` (Matched / Explainable / Unresolved) | — | — | — | **Build** | `reconciliation_lines`; same-component comparison rule |
| Commission expected vs received, WHT | `pages/Agreements.tsx`, `AgreementVersion.tsx` (rates only) | `GET /agreements`, `POST /agreements/actions` | `agreements`, `agreement_versions`, `agreement_rates` | **Extend** | `commissions`, `wht_certificates`, insurer balances |
| `money.change` permission (Finance, Principal, Admin) | — | — | `permissions`, `role_permissions` | **Extend** | Money verbs in the permission matrix |

## 6. Email

| ZIP | Existing React | Existing API | DB | Decision | Missing backend |
|---|---|---|---|---|---|
| Connect / disconnect / last sync / visible errors | `pages/Connections.tsx` | `GET /mailboxes`, `POST /mailboxes/connect`, `DELETE /mailboxes/:id` | `mailboxes` | **Extend** — connect *starts*, cannot finish | **OAuth callback, token exchange, encrypted refresh-token storage** |
| Thread retrieval, linking to records | `pages/Email.tsx` | `GET /email/threads`, `GET /email/threads/:id` | `email_threads`, `email_messages`, `email_attachments` | **Reuse** | Initial controlled sync; attachments → document pipeline |
| `email.send` — human send only, one record per recipient | `features/drafts`, `pages/Email.tsx` | `POST /drafts/:id/copied` | `drafts`, `email_send_attempts` | **Extend** | Approved-send path through the approval surface |

## 7. Ask, intents and tools

| ZIP | Existing React | Existing API | DB | Decision | Missing backend |
|---|---|---|---|---|---|
| 40 deterministic intents | `pages/Ask.tsx`, `shell/AskThread.tsx` | `POST /conversations` (model), `GET /ask` (title search, **no model**) | `conversations`, `conversation_messages` | **Extend** — retire the search-only path from the composer | `AI_DEFAULT_PROVIDER=anthropic`, `AI_MODEL`, `ANTHROPIC_API_KEY` unset |
| 34 actions as the model's only tools | — | engine `apply.ts` | `audit_log`, `events` | **Build** — tool declarations over existing actions | Tool schema per action; idempotency key per call |
| Entity/pronoun/date resolution, one clarification, refusal | `shell/AskThread.tsx` | `POST /conversations` | — | **Reuse the behaviour, rebuild server-side** | Scope carried per turn (exists), pronoun resolution does not |
| Generated workspaces from intent | `spaces/blocks.tsx` (9 of 45 components), `GET /spaces/:recordId` | `GET /spaces/:recordId` | `component_definitions` | **Extend** — renewals only; flag `VITE_PUBLIC_RENEWAL_SPACE=off` | 36 registry components; recipes beyond renewal |

## 8. Discard outright

| ZIP | Why |
|---|---|
| `asap-store.js` as a store | Browser `localStorage` business state. §45 rule 14 and the brief both forbid it. Its **shape** informs migrations; its persistence is discarded. |
| `asap-adapters.js` env names (`RECORDS_API_BASE_URL`, `DOCUMENTS_API_BASE_URL`, `MAIL_API_BASE_URL`, `ASAP_AI_ENDPOINT`) | We have one API. These do not become real variables. |
| `source/dist/*` | Older compiled UI. Ignored where it conflicts. |
| Role switcher, reset button, demo bar | Test affordances. Role is server-resolved; there is no reset in production. |
| Seeded demo records (Acme, KDN 482Q, APA, CIC, Jubilee, `ASAP-MTR-2027-00512`) | No fictional client, policy or insurer enters this codebase. |

---

## Conflicts with recorded decisions — need your call, and I have assumed an answer

**1. The shell reverts from five destinations to three.** D-064 set Discover · Ask ASAP · Work ·
Jobs · Automations, and cited the approved interactive demo as controlling. Your instruction, and
this ZIP, set **Today · Work · Automations** with Ask persistent-but-not-a-destination and Jobs
reachable only through Activity — which is what D-058/D-060 said before D-064 overrode them.

*Assumed:* your instruction wins; I will record it as a new decision superseding D-064, update
`CLAUDE.md`, and change `nav.ts` and its tests rather than leave tests asserting the old shell.
Two tests currently assert the five-destination shell and that `Jobs` is a valid destination; both
change.

**2. "Today" vs "Discover".** D-060 renamed Today → Discover deliberately. Your shell says Today.
*Assumed:* Today, with `/discover` redirecting to `/today` so existing links survive.

**3. "Work" is both a destination and a status word.** Your status layers list human work as
`Work · With <named party> · In progress · Done`, but "Work" is also the sidebar item, and the
current product's Work filters include **Waiting** — which you now say not to use as a bare label.
*Assumed:* filters become `Active · With <party> · In progress · For review · Done · Pinned ·
Recent`, no bare "Waiting", no "Needs you". Say the word if you want different filter labels — this
is the one item above where I am least confident I have read you right.

**4. Cover layer loses "Draft".** Your list starts at Requested. The current enum includes `draft`.
*Assumed:* `draft` stays in the database and stops being rendered as a cover status.

---

## Sequence, and what one pass can honestly contain

This is not one change. In dependency order:

1. **Shell and vocabulary** — three destinations, Today, Activity-only runs, filter labels, the
   decision record, the tests. *Small, visible, safe.*
2. **Honest document states + extraction review** — the Phase 3 gate. API exists; UI does not.
3. **Onboarding short flow** — four steps to Today.
4. **Ask connected to the model** — provider config, tool declarations over the existing engine,
   scope and refusal server-side.
5. **Gmail OAuth callback** — token exchange, encrypted storage, controlled first sync, attachments
   into the document pipeline.
6. **Money** — invoices, payments, partial payments, reconciliation lines, commissions, insurer
   balances, WHT certificates. Migrations, RLS, pgTAP, routes, actions, audit. *This is the biggest
   single piece and it is where the same-component comparison rule and the three commission figures
   live.*
7. **Quotes, opportunities, approvals-with-frozen-payloads, servicing/TOR records.**
8. **Scheduled sweep** so `renewal.approaching` and `check.overdue` can fire.
9. **End-to-end browser tests** for the shell and onboarding → Ask.

I am starting at 1 and working down, reporting at each step. I will not describe any of it as
complete until the screen it serves reads from production records.
