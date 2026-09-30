# Conversational shell — Musters interaction model mapped onto ASAP

Decision: D-118. Ask ASAP in the centre, the live Space on the right, one set of records and action
contracts under both. Borrowed from `Musters (2).html`: the interaction model only — none of its
contractor records, terminology, styling, browser store or domain logic.

Musters is built on the same template dialect as ASAP's approved interface, so most of its
conversational behaviour already has an ASAP counterpart. The work is arrangement and hardening,
not a second application.

| Musters / reference behaviour | Current ASAP implementation | Existing API / action contract | Decision | Safety concern | Test required |
|---|---|---|---|---|---|
| Central conversation | Ask was docked right of the Space | `POST /ask`, `POST /conversations/turns` | **Extend** — Ask moved to the centre, Space to the right; width resizable and remembered (interface state only) | Must not become a dashboard; no business state in the browser | Desktop 1360/1440 layout, no overflow |
| Context chips | One chip for the active client, removable | Ask `scope` (client / record) resolved server-side | **Extend** — chip from the active Space; explicit identifiers in the message win (`policyCoverAnswer`) | A chip must never substitute a record the message did not name | Explicit id overrides context; removing the chip clears scope |
| Short clarification | `clarify` options in the thread | Server `clarify` state with real row ids | **Reuse** — one question, options from real rows; policy cover asks "Which policy?" | Never pick the first candidate | "Is cover active on this policy?" with nothing open asks, opens nothing |
| Suggested actions | Chips under the composer | `LIVE_CHIPS`, server `suggestions` | **Reuse**; live chips only, demo names stripped | No fictional records in live | Live chips contain no demo names |
| Pending action card | `plan` preview with Confirm in the thread | Same `records.act` → `LIVE[...]` → API | **Reuse** — every chat plan runs the same handler a Space button runs | No write without confirmation; consequential actions stay drafts | Plan → confirm → one API call |
| Confirmation | Confirm in the plan card; forms in Spaces | Same handlers, idempotent ledger key | **Reuse** | Double click must not write twice | Duplicate returns "Already done" |
| Progress | "Saving…" flash while a write runs | — | **Reuse**; document confirm now re-reads one record so feedback is immediate | No permanently disabled control | Confirm updates the Space at once |
| Receipts | Receipt line in the thread + toast | Audit row per write | **Reuse**; thread keeps the newest turn in view | Success must not be off-screen | Scroll pins to newest unless user scrolled up |
| Retry | Failure messages say "Nothing was changed" and allow resend | Idempotency keys server-side | **Reuse** | Retry must not duplicate | Retry after failure writes once |
| Opening / updating a Space | `nav` from results, `openRef` | Workspace refs `{ws, clientId, policyYearId, …}` | **Reuse** | Must open the named record, never a neighbour | Search and cover answers open the right policy |
| Tab identity | Tabs keyed by reference identity (`ident`) | — | **Reuse** — two clients / policies stay separate tabs | A second record must not replace the first | Two clients open independently |
| Conversation history | Server conversation, History sheet | `GET /conversations`, messages | **Reuse** | Transcript is never treated as records (§45 rule 14) | Refresh restores the thread |
| Attachments | Upload block in Spaces; composer attach control | `POST /documents` signed upload | **Reuse** | A file picked in one Space never appears in another | Upload progress is per Space |
| Work assignment | `work.assign` from Work Space | `POST /work/:id/act` verb `assign` | **Reuse** — same contract from chat or Space; same-owner recognised | No duplicate on retry | Same-owner message; assign writes once |
| Activity / audit | Audit rows hydrated to Activity | `GET /audit` | **Extend later** — actor and record naming (open item) | Human actions must not read as `system` | Open |
| Phone layout | Space and Ask stacked | — | **Build** — Ask first; Space full screen; "Back to the conversation" | Switching must not lose thread or record | 390 px: open Space, return, turns kept |
| Consequential drafts | Engine drafts could carry demo recipients | Email send not connected in live | **Build** — live guard removes any draft without a real recorded recipient and any send control | No placeholder recipient, no `undefined` | Guard strips `@insurer.demo`, `undefined`, `null` |
| Document identity | Mismatch not flagged | `GET /documents/:id/apply-preview`, `POST …/apply` | **Build** — server blocks apply on insured/client conflict; Space warns first | Values must not land on the wrong client | API: conflict → 409, preview blocked; suffix-only difference not a conflict |

Not yet done in this slice (named, not hidden): Activity actor/record naming; quotation
"Not asked" → prepare/review/approve request path; Work next step derived from full workflow
state for every kind; a dedicated Kifaru-style add-client preview card (today the plan card);
Playwright end-to-end suite against the deployed app.
