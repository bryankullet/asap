# Autonomous work map

How ASAP becomes an operations worker instead of a screen a person drives:

**detect → plan → do the safe internal steps → ask for approval only where it is required →
carry on after approval → watch the outside party → record evidence → close or escalate.**

This map was written from the code as it stands on `main` at `e1818d0`, and its "Missing" lines were brought up to date after the autonomy build (D-139 – D-148): the migrations, the API
routes, the worker, the event consumers, the Ask tools and the action contracts. Roadmap documents
were not taken as evidence. "Exists" means there is a table, a route or a function that does it
today.

## The approval line (applies to every workflow)

| ASAP may do it alone (reversible, internal) | A person must approve it |
|---|---|
| Read records, documents and accepted extracted values | Anything that leaves the brokerage: email, letter, portal upload, message |
| Detect due dates, gaps, conflicts and overdue parties | Anything that binds, changes or cancels **cover** |
| Create, assign (by rule) and date Work; set next checks | A **client instruction** or confirmation recorded as the client's |
| Prepare packs, drafts, comparisons and recommendation evidence | Treating an **uncertain** extracted or model-read value as authoritative |
| Record what it did, with evidence, in the audit log | Anything that moves, invoices, allocates or writes off **money** |
| Raise a precise exception when it cannot continue | Declaring a claim covered or declined (never ASAP's decision at all) |

The model may explain, rank and draft. It never sets a status, a state or a value (§45 rules 8–10).

## Current execution machinery (what exists)

| Capability | Where it lives today | Gap |
|---|---|---|
| Semantic events and an idempotent dispatcher | `events`, `event_deliveries` (0010, 0042); `apps/workers/src/events/dispatcher.ts` → `POST /internal/events/:id/dispatch` | Only `document.received` and `mailbox.sync_requested` are emitted |
| Step-based Work items | `work_items.steps` (0023); recipes in `packages/schema/src/recipes/*` | Steps advance only when a person presses a verb |
| Runs with streamed progress | `runs`, `run_events` (0022–0024); `apps/api/src/runs/executor.ts` | In-process and one step at a time; no retry, no schedule, no resumption after a person acts |
| Automations | `automations`, `automation_runs` (0036); registry (D-125) | Prepare one verb on one step; no multi-step plan, no waiting |
| Approval of exact content | `quote_request_approvals` (0049), `issuance_request_approvals` (0058), `prepared_actions` (0059) | One approval per item; no bundled approval |
| Provider-neutral sending | `apps/api/src/mailbox/send.ts` (idempotency key, approver, provider id required for "sent") | No mailbox is connected (Gmail deliberately unconfigured) |
| Manual delivery with evidence | `quote_request_deliveries` (0060) | Quotation requests only |
| Server-derived next action | `work_item_set_state` (0060), `workNext`, `quotationNext` (D-120) | — |
| Brokerage rules with source | `company_rules` (0052), `apps/api/src/rules.ts` | No renewal or follow-up rules |
| A schedule | — | **None.** The worker only polls events |

So what was missing was not the parts, but the thing that strings them together: a durable,
resumable, multi-step run that the system advances on a schedule, that waits for a person or a
party without forgetting, and that never repeats itself. That is the execution foundation built
with this document (D-129).

## The workflows

Scores: **F**requency, **V**alue (economic), **R**isk if wrong, **D**ifficulty to build — each 1
(low) to 5 (high).

### 1. Enquiry intake
- **Ask:** "New enquiry from Tausi for fleet cover." · "What came in today?"
- **Trigger:** an email or document arriving that names an unknown or known client with a cover need (`document.received`, mailbox sync).
- **Sequence:** classify the message → match or propose the client → extract the need → open quotation work → list missing requirements → assign → acknowledge (prepared).
- **Automatic:** classification, matching candidates, need extraction (proposed), Work creation, requirement list from `requirement_templates`.
- **Approval:** creating a new client from an ambiguous match; the acknowledgement to the client.
- **Evidence / success:** an opportunity linked to the source email/document; requirements listed; owner set.
- **Reusable:** `email_messages`, `documents`, `POST /opportunities`, `requirement_templates`, client matching in `/clients` preview.
- **Missing (after D-144):** ASAP proposes a pasted or synced enquiry as new work (`new_enquiry`) on an Unsorted item; a person opens the quotation. Need extraction into the opportunity and the client acknowledgement are still to build.
- **F5 V4 R2 D3**

### 2. Client onboarding and file (KYC) completeness
- **Ask:** "Is Tausi's file complete?" · "Chase the missing KYC."
- **Trigger:** a client created or imported; `refresh_due_at` reached.
- **Sequence:** read file status and held documents → list missing items → create Work → prepare the request to the client → track receipt → mark cleared only by a person.
- **Automatic:** gap list, Work, reminders, re-check on document arrival.
- **Approval:** the request to the client; the decision that the file is cleared (already a person's, 0026).
- **Evidence / success:** each required document held; `file_status = cleared` decided by a named person.
- **Reusable:** `clients.file_status`, `client_file_documents`, agreements (0026).
- **Missing:** a per-brokerage required-documents rule; scheduled refresh detection.
- **F4 V3 R4 D2**

### 3. Quotation to comparison
- **Ask:** "Get quotes for Tausi's fleet." · "Where are the quotes?"
- **Trigger:** an opportunity opened.
- **Sequence:** requirements → insurers → prepare requests → **approve** → deliver (manual today) → watch for replies → chase overdue → record terms → compare → present.
- **Automatic:** request drafting, chase scheduling, overdue detection, comparison when ≥2 quotes, staleness detection.
- **Approval:** each request's exact text (bundle-able); presenting to the client.
- **Evidence / success:** delivery evidence per insurer; responses with source; comparison generated from recorded terms.
- **Reusable:** all of 0048–0053, 0057, 0060; `quotationNext`; comparison routes.
- **Missing (after D-141, D-144, D-147):** nothing in the chase loop — runs start on `opportunity.opened`, chase per insurer on `quote.chase`, file each insurer's reply to the run and send routine chasers under a standing approval. Still missing: reading quoted terms straight into a proposed insurer response (a person records the reply).
- **F5 V5 R3 D2** (most parts exist)

### 4. Placement (client instruction to bound cover)
- **Ask:** "Tausi chose Jubilee — place it."
- **Trigger:** a client instruction recorded on an opportunity.
- **Sequence:** instruction captured → placement request prepared → **approve** → submitted → insurer confirmation awaited → cover match checked → conditions resolved.
- **Automatic:** request preparation, cover matching, condition lists, chasing.
- **Approval:** the client's instruction; the submission; any change accepted on the client's behalf.
- **Evidence / success:** insurer confirmation matched to the instruction with no unresolved difference.
- **Reusable:** 0054–0056 (`placements`, `placement_requests`, `cover_match_*`, conditions).
- **Missing (after D-142):** placement runs on the engine from `client.instruction_recorded`, prepares its request as ASAP, chases on `placement.chase` and runs the cover check. Still a person's: approval, sending without a mailbox, accepting differences, conditions.
- **F3 V5 R5 D3**

### 5. Policy issuance
- **Ask:** "Has Jubilee issued Tausi's policy?"
- **Trigger:** placement confirmed.
- **Sequence:** issuance request → **approve** → submit → receive policy document → read it → person reviews readings → check against instruction → **apply** to the policy record.
- **Automatic:** reading, checking, difference list, chasing.
- **Approval:** the request; accepting each reading; applying to the record.
- **Evidence / success:** an issued policy document whose checked values match, applied with a key.
- **Reusable:** 0058–0059, document extraction, `policy_issuance_apply`.
- **Missing (after D-142):** issuance runs from `cover.confirmed`, chases on `issuance.chase`, files the insurer's document itself when exactly one placement fits, runs the issued-policy check. Still a person's: approval, reviewing readings, applying.
- **F3 V4 R5 D2**

### 6. Servicing requests (certificates, documents, small changes)
- **Ask:** "Send Tausi a copy of the motor certificate."
- **Trigger:** a client email asking for something.
- **Sequence:** classify → find the document → prepare the reply → **approve** → send.
- **Automatic:** finding the document, preparing the reply.
- **Approval:** the reply.
- **Reusable:** documents, `drafts`, `sendThroughMailbox`.
- **Missing (after D-144, D-145):** inbound classification exists (`servicing_request` goes to a person as Unsorted); approved replies send through a connected mailbox. Still missing: a servicing workflow on the engine.
- **F5 V2 R2 D2**

### 7. Endorsements
- **Ask:** "Add KDC 900T to Tausi's fleet from Monday."
- **Trigger:** a client request.
- **Sequence:** classify the change → check who asked (policyholder rule) → list requirements → request from insurer → **approve** → confirmation → apply the change and its premium adjustment.
- **Automatic:** classification, requirement list, chasing.
- **Approval:** the request to the insurer; applying the change; any premium adjustment.
- **Reusable:** `endorsements` (0028), `endorsementSteps`, `endorsement_apply`, `TRANSFER_NEEDS_POLICYHOLDER`.
- **Missing (after D-143):** endorsement runs from `endorsement.requested`, prepares the insurer request as one approval, chases on `endorsement.chase`. Still missing: premium-adjustment money records.
- **F4 V3 R4 D3**

### 8. Renewals — **built first (Renewal Autopilot)**
- **Ask:** "What renewals are coming up?" · "Prepare Tausi's renewal." · "Where is the renewal?"
- **Trigger:** schedule — a policy period ending within the brokerage's renewal window.
- **Sequence:** detect → de-duplicate → check client/policy/document completeness → read the schedule and confirmed values → list what is missing → create and assign Work → prepare the renewal pack → prepare the client and insurer messages → **one approval bundle** → continue after approval (request recorded as approved, deliverable) → watch for terms, chase on a schedule → prepare comparison and recommendation evidence when terms arrive → hand to a person to present, or raise an exception.
- **Automatic:** everything except the approval and the delivery itself.
- **Approval:** the bundle (both messages, exact text); presenting options; any instruction to renew.
- **Evidence / success:** terms from every approached insurer (or a written decline) with comparison evidence, before expiry; every step audited.
- **Reusable:** `renewalSteps`, `work_items_one_open_per_source_reason`, quotation tables, `quotationNext`, `company_rules`, `recommendationRule`.
- **Missing (now built):** schedule, durable runs and steps, bundle approval, resumption, follow-ups.
- **F5 V5 R3 D3**

### 9. Claims through resolution
- **Ask:** "Report a claim for yesterday's accident." · "What's outstanding on the claim?"
- **Trigger:** a client report; schedule for the notification clock and document chases.
- **Sequence:** draft claim → match policy → collect documents → notify insurer → **approve** → register → assessor and insurer responses → settlement figure → client acceptance → payment received.
- **Automatic:** policy matching candidates, document list, clocks, chasing, overdue detection.
- **Approval:** notifying the insurer; registering; any acceptance on the client's behalf; never the cover decision.
- **Reusable:** 0028, 0042 (`claims`, `claim_documents`, `claim_notes`, clock), claim recipe.
- **Missing (after D-143):** claim runs from `claim.reported` with the notification clock (`claim.notification_days`, or the wording's clause), document chasing (`claim.document_chase_days`) and registration chasing. Still missing: the prepared claim notice (D-123, needs its own approval flow), settlement and payment records.
- **F4 V5 R5 D4**

### 10. Premium collection
- **Ask:** "Who hasn't paid?"
- **Trigger:** a policy issued or renewed; schedule for due dates.
- **Sequence:** invoice → reminders → payment received → allocate → remit to insurer.
- **Automatic:** reminders (prepared), matching suggestions.
- **Approval:** every invoice, reminder sent, allocation and remittance.
- **Reusable:** premium figures on `policy_periods`; `work_items.money_status` vocabulary.
- **Missing:** invoices, payments, allocations, remittances — **no money tables exist**.
- **F5 V5 R5 D5**

### 11. Commission
- **Ask:** "What commission is Jubilee owing?"
- **Trigger:** premium remitted; insurer statement received.
- **Sequence:** expected commission from agreed rates → statement read → matched → WHT certificate tracked → differences raised.
- **Automatic:** expectations, statement reading (proposed), matching suggestions.
- **Approval:** accepting a statement; writing off a difference.
- **Reusable:** `agreements`, `agreement_rates` (0026), `commission_amount` on periods.
- **Missing:** commission ledger, statements, WHT records; Kenyan WHT rate as a `company_rule`.
- **F3 V5 R4 D5**

### 12. Reconciliation
- **Ask:** "Reconcile September."
- **Trigger:** month end; bank statement imported.
- **Sequence:** import → match → explain differences → **approve** adjustments.
- **Missing:** everything below the import mechanism; depends on 10–11.
- **F2 V4 R5 D5**

### 13. Documents
- **Ask:** "What does this schedule say?" · "File this."
- **Trigger:** `document.received`.
- **Sequence:** store → extract → propose values → person reviews → apply to a record (identity-checked).
- **Automatic:** extraction, filing suggestions, identity-conflict detection.
- **Approval:** accepting values; applying them.
- **Reusable:** 0034, 0043; extractor service; apply-preview with identity block.
- **Missing (after D-142, D-144):** a read policy document is filed to the issuance run waiting for it when exactly one fits; email attachments are filed through the upload path. Still missing: routing renewal terms and claim forms by document alone.
- **F5 V4 R4 D2**

### 14. Communications
- **Ask:** "What has Jubilee said?" · "Draft a chaser."
- **Trigger:** mailbox sync; workflow steps needing a message.
- **Sequence:** thread → link to record → draft → **approve** → send through the provider → record the provider id.
- **Reusable:** 0035, 0044, 0045, `sendThroughMailbox`.
- **Missing (after D-145, D-147):** the boundary is live: approved messages send through a connected mailbox to verified addresses; routine insurer chasers send under a standing approval (off by default). Connecting Gmail or Microsoft 365 is still deliberately out of this build.
- **F5 V4 R4 D2**

### 15. Compliance
- **Ask:** "Which client files need refreshing?"
- **Trigger:** schedule.
- **Sequence:** refresh due → request → re-clear by a person; licensing and regulator returns.
- **Reusable:** client file refresh columns (0026), audit log.
- **Missing:** regulator return definitions (an insurance-business decision per brokerage).
- **F2 V3 R5 D3**

### 16. Reporting and management
- **Ask:** "How are renewals going?" · "What's overdue?"
- **Trigger:** schedule (weekly) and on demand.
- **Sequence:** gather from records → summarise with counts the database computed → highlight exceptions.
- **Reusable:** `/attention`, `/work`, `/audit` (Activity, D-124), workflow runs (0062).
- **Missing:** a reports surface; money metrics need 10–12.
- **F3 V3 R2 D2**

## Ranked build sequence

Ranked by value × frequency, discounted by risk and difficulty, with a bonus where most parts
already exist:

| Rank | Workflow | Why now |
|---|---|---|
| 1 | **Renewal Autopilot** | Highest frequency × value; scheduled by nature; proves every part of the foundation (schedule, wait, approval bundle, resume, chase, exception). **Built.** |
| 2 | **Quotation chasing and comparison** | Tables, delivery and comparison exist; needs only the foundation's follow-up and resume. Renewal already reuses it for terms. |
| 3 | **Claim document and notification clock** | High value and risk; the claim records and clock exist; scheduled chasing is the missing piece. |
| 4 | Document routing to waiting workflows | Turns arriving schedules and terms into progress without a person filing them. |
| 5 | Client file completeness and refresh | Simple, frequent, compliance value. |
| 6 | Placement and issuance chasing | Records exist; adds resumption and chasing. |
| 7 | Endorsements | Moderate; premium adjustments wait on money. |
| 8 | Enquiry intake | Needs a mailbox and a classifier contract. |
| 9 | Servicing replies | Needs a mailbox. |
| 10 | Reporting | Cheap once runs exist; better after money. |
| 11–13 | Premiums, commission, reconciliation | Highest value but **no money records exist**; they need their own schema and per-brokerage rules (WHT, remittance terms) first. |

The next two to build: **Quotation chasing** (rank 2) and the **claim clock** (rank 3).
