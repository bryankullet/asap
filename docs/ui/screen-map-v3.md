# ASAP — Space and Screen Map, version 3

**This replaces version 2 entirely.** Read it alongside the v1 catalogue, which still holds the detailed entries, the evidence rules, the component library and the field lists. Where v3 and v1 disagree, v3 wins.

Version 2 fixed how the product is *navigated and labelled*. Version 3 fixes what it *knows about*. Six things the plan could not represent are now modelled:

1. Client due diligence, and the gate it puts in front of a placement
2. Agency agreements as versioned objects, so commission has a source of truth
3. Motor certificates as controlled stock rather than documents
4. Premium as several numbers, not one — levies, stamp duty, and withholding tax
5. Money that arrives with no reference and belongs to nobody
6. Money owed *to* insurers, aged, with the brokerage's own regulatory exposure

The count goes from 48 surfaces to 60. **The shell does not change.** There are still three destinations. Nothing below becomes a fourth. *(D-060 renamed destination 1 from Today to Discover. The count is what this rule fixes, and it is unchanged; Jobs is still not a destination.)*

---

# Part 1 — Carried forward from v2, unchanged

## 1.1 The shell

| Position | Label | Screen |
|---|---|---|
| 1 | **Discover** | H01 |
| 2 | **Work** | H03 |
| 3 | **Automations** | A01 |

Below: **+ New** (H05), **Search** (H04). **Profile** (C01) at the bottom. Ask ASAP (H02) is persistent and is not a destination. Runs live in an **Activity** chip beside the Ask composer, never in navigation.

Unchanged rules: a run may never be the only place something important lives; a run that pauses or fails creates an item in Work first; S16 is merged into H03; the word "Space" appears in this specification and in code, never on screen; items are titled as themselves.

## 1.2 Status vocabulary

Four visible layers. **No word appears in two layers.**

| Layer | Words |
|---|---|
| **Task** | Needs you · With ⟨named party⟩ · In progress · Done |
| **Run** | Working · Paused · Finished · Couldn't finish · Stopped |
| **Cover** | Draft · Requested · Submitted · Confirmed · Active cover · Expired · Cancelled |
| **Money** | Not invoiced · Unpaid · Part paid · Paid · Received · Reconciled · Disputed |

"Waiting" is not used anywhere. Position carries the layer: task status in the card headline, cover status on the policy period line, money status in the money row.

---

# Part 2 — What v3 adds to the vocabulary

Two new sets of words. Both are **scoped**, which is the only reason the four-layer rule survives.

### 2.1 The client file (compliance)

| Words | Meaning |
|---|---|
| Not started · Incomplete · In review · Cleared · Refresh due | How far the due diligence file has got |

**Scoping rule.** These words appear only on the client record header and on the due diligence screens (K01–K03). They never appear on a work card. On a work card, an incomplete file shows as a blocked task with its reason: *Blocked — client file incomplete*. That keeps card grammar at four layers.

No collisions: "Cleared" is used nowhere else; "In review" is distinct from the task layer's "In progress".

### 2.2 Certificate stock

| Words | Meaning |
|---|---|
| Allocated · Issued · Voided · Unaccounted | Where a controlled certificate is |

**Scoping rule.** Certificate stock words appear only on T01 and T02. Note **Voided**, not "cancelled" — the cover layer already owns Cancelled, and a spoiled certificate is not cancelled cover.

### 2.3 Money, extended for money going out

The money layer gains two words for the outbound direction: **Due to insurer** and **Settled**. Same layer, same position rules, so nothing new is learned.

---

# Part 3 — Premium is not one number

This is the model change everything else in the money story rests on. It is not a screen; it is a correction to what a premium *is*.

## 3.1 The components

Every premium figure in the system must declare which of these it is:

| Component | What it is | Who receives it |
|---|---|---|
| **Base premium** | The risk premium the insurer rated | Insurer |
| **Training Levy** | Statutory percentage of base premium | Regulator, via insurer |
| **PCF contribution** | Policyholders Compensation Fund, percentage of base premium | Fund, via insurer |
| **Stamp duty** | Fixed amount per policy | Government |
| **Gross premium payable** | What the client actually pays — all of the above | Collected by the broker |
| **Commission basis** | The figure commission is calculated on. **Base premium, not gross.** | — |

The rates and the duty amount are configured once in business rules (C06), versioned with effective dates, never hard-coded. When a rate changes, existing policy periods keep the version they were rated under.

## 3.2 Commission is three numbers, not one

| Figure | Meaning |
|---|---|
| **Gross commission** | Commission basis × agreed rate (from G02) |
| **Withholding tax** | Deducted at source by the insurer, paid to KRA on the brokerage's behalf |
| **Net commission received** | What actually lands in the bank |

Withheld tax is **the brokerage's money**, recoverable only against a certificate. It is never treated as a cost and never netted away silently.

## 3.3 The rule that fixes reconciliation

> **A comparison may only run between two figures of the same declared component.**
>
> If either side's component is unknown, the row is an exception with the reason *component not stated* — it is never quietly matched, and it is never counted as a mismatch either.

Without this rule, a levy-inclusive statement compared against a base-premium commission produces a mismatch on every row, and the feature built to surface three real problems buries them under forty-four false ones.

## 3.4 X08 — What makes up this premium

**Shared panel.** Opens wherever a premium figure is shown: a policy, an invoice, a quote comparison, a statement row.

- Shows every component, its rate or amount, its version, and the total
- Names the commission basis explicitly
- Every line traces to its source: the rating, the rule version, the invoice
- Read-only. Changing a component happens in business rules, not here.

**Failure behaviour:** where a component was never captured (imported policies, mostly), it shows as *not stated* — never as zero.

---

# Part 4 — New surfaces

## 4.1 Client due diligence — K01, K02, K03

*User-facing name: **Client files**. Reached from Ask, from the client record, and from Discover when a file blocks live work. Not a destination.*

### K01 — Client files register
- **Purpose:** every client, the state of their file, and what is blocking what.
- **Views:** Blocking live work · Incomplete · Refresh due · Cleared · Not started
- **Shows:** client, file state, who owns it, what it is currently blocking (a placement, a renewal, a claim payment), and how long it has been in that state.
- **Import behaviour, and this matters:** all 1,400 imported clients land as **Not started**. An imported client is never assumed Cleared. The register shows the size of the backlog on day one rather than hiding it.
- **Failure behaviour:** a client with no identifying documents at all is still listed, with *nothing on file* stated plainly.

### K02 — A client's file
- **Purpose:** collect, verify and decide, in one place.
- **Shows:** identity documents held and missing; beneficial ownership for corporate clients; the source of funds question where it applies; screening results; the decision, its date, and who made it; the refresh date.
- **Actions:** request documents from the client (drafted, human-sent); record a document received; run screening; record the decision; set a refresh interval.
- **Approval:** clearing a file is a named human decision with a recorded reason. ASAP prepares; it never clears.
- **Evidence:** every document links to what was actually received, with its date.
- **Restricted:** ASAP may never infer identity from a name match alone.

### K03 — Screening match review
- **Purpose:** decide whether a screening hit is actually this person.
- **Shows:** the hit, the list it came from, what matches and what does not, and the reviewer's options: not a match · possible match, escalate · confirmed match.
- **Approval:** a confirmed match escalates to the principal officer and blocks the client. It is never auto-decided.
- **Audit:** the reasoning is stored. Screening decisions get looked at years later.

### The gate

> **A placement instruction cannot be approved while the client's file is Not started, Incomplete or Blocked.**

Enforced at X01 (approval), not in the interface alone — the check runs again at the moment the action executes. The approval screen shows the block with a direct link to K02, and the reason is written in plain words: *We cannot instruct cover for a client whose file is not complete.*

An override exists for the principal officer only, requires a written reason, and creates a permanent audit entry that appears on Josphat's Discover.

**New skills:** `kyc.check`, `kyc.collect`, `kyc.verify`, `kyc.screen`, `kyc.review_match`, `kyc.decide`, `kyc.refresh_due`, `kyc.gate`, `kyc.backfill`.

---

## 4.2 Agency agreements — G01, G02

*User-facing name: **Insurer agreements**. Lives in company settings (C01). Reached from an insurer record, from a commission dispute, and from Ask.*

### G01 — Insurer agreements register
- **Purpose:** one row per insurer, showing whether an agreement is on file, its current version, and when it expires or renews.
- **Shows:** insurer, agreement status, effective dates, classes covered, whether any live commission depends on a rate with no agreement behind it.
- **The number that matters:** how much commission is currently being expected against **no documented rate**. On day one this will be most of it. That is the point of showing it.

### G02 — An agreement version
- **Purpose:** the source of truth `commission.expected` reads from.
- **Shows:** commission rate by class of business, effective from and to, payment terms, any sliding scale or profit-share arrangement, and the clause each rate came from with a link to the page.
- **Extraction:** ASAP reads the agreement and proposes the rates. A person confirms each one before it becomes live. An unconfirmed rate is never used in a comparison.
- **Versioning:** a new agreement creates a new version. Policies rated under the old version keep it. History is never rewritten — a rate change next March does not retrospectively make last August's statement wrong.
- **Failure behaviour:** where no rate is documented for a class, `commission.expected` returns *no agreed rate on file* and the reconciliation row becomes an exception, not a mismatch.

**New skills:** `agreement.load`, `agreement.extract_rates`, `agreement.confirm_rate`, `agreement.find_rate`, `agreement.version`, `agreement.expiring`, `agreement.coverage_gaps`.

---

## 4.3 Certificates as controlled stock — T01, T02

*User-facing name: **Certificates**. Reached from a policy, from servicing work, and from company settings.*

A motor certificate is closer to a cheque book than to a document. Numbers are allocated to the brokerage, must be accounted for, and a spoiled one must be voided properly rather than thrown away.

### T01 — Certificate stock
- **Purpose:** account for every number.
- **Views:** Allocated · Issued · Voided · **Unaccounted**
- **Shows:** number ranges held per insurer, what has been issued against what, and the count of anything unaccounted for.
- **Unaccounted is the important view.** A number that was allocated and cannot be shown as issued or voided is a live problem, and it stays on this screen until it is resolved.
- **Reconciliation:** stock is reconciled against the insurer's own issuance record. Differences are exceptions, never adjusted away.

### T02 — A certificate
- **Purpose:** one certificate, its whole life.
- **Shows:** number, insurer, policy and period, the insured item, issue date, current state, and — if voided — who voided it, when and why.
- **Actions:** issue against a policy; void with a reason; reprint (which records a reprint, and never issues a second number).
- **Restricted:** ASAP may not issue or void. It prepares the request and records the outcome.
- **Integration:** where the insurer issues through a regulator-backed digital system, T02 records the reference from that system and states plainly whether ASAP holds confirmation or only a request.

**New skills:** `certificate.allocate`, `certificate.issue`, `certificate.void`, `certificate.reprint`, `certificate.account_stock`, `certificate.reconcile_stock`, `certificate.unaccounted`.

`certificate.request` from v1 remains, but now feeds T02 rather than producing a loose document.

---

## 4.4 Money that belongs to nobody — N01

*User-facing name: **Money we can't place**. Reached from the reconciliation work item (S13), from Discover when the balance grows, and from Ask.*

### N01 — Unidentified receipts
- **Purpose:** hold money that has arrived and cannot yet be attributed.
- **Shows:** the receipt, amount, date, channel, whatever reference text came with it (often nothing), and any candidate matches ASAP can suggest with the reason for each.
- **Actions:** attribute to a client, policy or invoice; split across several; ask the client which invoice it was for (drafted, human-sent); leave it held with a note.
- **The total is shown prominently.** Unattributed money in the bank is a real liability, not a rounding item.
- **Restricted:** ASAP may propose a match but may never attribute a receipt on its own. Attributing money to the wrong client is worse than leaving it unattributed.
- **Ageing:** receipts held over a threshold appear on the finance owner's Discover with how long they have been sitting there.
- **Failure behaviour:** where a receipt cannot be identified at all, it stays here indefinitely. It is never written to a suspense line and forgotten.

**New skills:** `money.unidentified`, `money.suggest_attribution`, `money.attribute_receipt`, `money.split_receipt`, `money.hold_receipt`, `money.aged_unidentified`.

---

## 4.5 Money going out — N02, N03, N04

*User-facing name: **What we owe** and **Tax certificates**. Reached from an insurer record, from Ask, and from Discover when a settlement is due.*

### N02 — Insurer account
- **Purpose:** the whole two-way position with one insurer.
- **Shows, kept separate and never netted on screen:** premium due to the insurer, commission due from the insurer, unidentified receipts that may belong to them, and disputes open in either direction.
- **Ageing:** what is due out, by age band, against that insurer's credit terms from G02.
- **Regulatory exposure:** premium collected from clients and held beyond its terms is shown as a named figure with its age. This is the brokerage's own exposure, and the plan previously had nowhere to put it.

### N03 — Settlement run
- **Purpose:** prepare a payment to an insurer.
- **Shows:** which policies and periods are being settled, the base premium, levies and duty being passed on, the commission being deducted, and the net payable — every component named per Part 3.
- **Actions:** prepare the run; review line by line; approve; record the payment made; record the insurer's acknowledgement.
- **Approval:** X01. Preparing a run is not paying. Approving is not payment. Payment is recorded only against evidence that money moved.
- **Restricted:** ASAP never moves money and never initiates a payment.
- **Failure behaviour:** a line whose commission basis is unknown blocks that line, not the whole run.

### N04 — Tax certificates
- **Purpose:** recover withheld tax.
- **Shows:** per insurer, per period — tax withheld, certificates received, certificates outstanding, and the total value sitting unrecoverable.
- **Actions:** chase an outstanding certificate (drafted, human-sent); record one received; link it to the periods it covers.
- **Closure link:** a policy year cannot close while a tax certificate is outstanding. That check already exists; N04 is where it is resolved.

**New skills:** `settlement.due_to_insurer`, `settlement.age`, `settlement.prepare_run`, `settlement.record_payment`, `settlement.regulatory_exposure`, `tax.wht_expected`, `tax.wht_certificate_received`, `tax.wht_outstanding`, `levy.compute`, `levy.explain`, `tax.stamp_duty`.

---

# Part 5 — Master surface list

**60 surfaces** (48 from v2, plus 12).

| ID | Screen | Surface | Shown as |
|---|---|---|---|
| K01 | Client files register | Reached from Ask, client record, Discover | Client files |
| K02 | A client's due diligence file | Opens from K01 and the client record | The client's own name |
| K03 | Screening match review | Panel from K02 | — |
| G01 | Insurer agreements register | Company settings | Insurer agreements |
| G02 | An agreement version | Opens from G01 and from a commission dispute | The insurer's name |
| T01 | Certificate stock | Company settings and policy servicing | Certificates |
| T02 | A certificate | Opens from T01 and from a policy | The certificate number |
| N01 | Unidentified receipts | Reached from S13, Discover, Ask | Money we can't place |
| N02 | Insurer account | Reached from an insurer record and Ask | The insurer's name |
| N03 | Settlement run | Opens from N02 | What we owe ⟨insurer⟩ |
| N04 | Tax certificates | Reached from N02, closure checks, Ask | Tax certificates |
| X08 | Premium breakdown | Shared panel, opens on any premium figure | What makes up this premium |

None of these is a destination. All are reached from Work items, from records, from Ask, or from settings — which is what keeps the shell at three.

---

# Part 6 — Guards added to existing screens

| Screen | New guard |
|---|---|
| X01 Approval | A placement cannot be approved while the client file is Not started, Incomplete or Blocked. Principal-officer override requires a written reason and is audited. |
| X01 Approval | A settlement run cannot be approved where any line's commission basis is unknown. |
| S13 Reconciliation | Rows may only be compared where both sides declare the same premium component. Unknown component becomes an exception, not a mismatch. |
| S13 Reconciliation | Where no agreed rate exists in G02, the expected figure reads *no agreed rate on file*. |
| Economic closure | Blocked while a tax certificate is outstanding or certificate stock is unaccounted for. |
| Import review | Every imported client lands as **Not started**. Never inferred as Cleared. |
| Policy servicing | Issuing a certificate goes through T02. A certificate cannot be issued twice against one number; a reprint is recorded as a reprint. |

---

# Part 7 — Day-three test, extended

The six checks from v2 stand. Three are added, and they are role-specific because these areas are.

7. **The gate reads as a reason, not a refusal.** A broker blocked from approving a placement can say in their own words why, and what would unblock it, without asking anyone.
8. **Three commission figures.** A finance person shown a commission number can say which of the three it is — gross, withheld, or net — from the screen alone.
9. **Unaccounted is understood as a problem.** Someone shown the certificate stock screen understands that *Unaccounted* is a live problem to chase, not a tidy-up state.

The honest caveat from v2 still applies, and applies harder here. These checks prove the screens are legible. They do not prove someone can conduct due diligence properly or spot a commission arrangement being applied wrongly. That is professional skill.

---

# Part 8 — Open decisions

The v2 items stand. Five are added, and the first two block build.

**11. Levy and duty rates.** The percentages and the duty amount must be confirmed against current law before anything is rated. They go into C06 as versioned rules, never into code. **Blocking.**

**12. Withholding tax rate and scope.** Confirm the rate applied to brokerage commission and whether any counterparty falls outside it. Getting this wrong misstates every commission figure in the product. **Blocking.**

**13. Screening data source.** K03 assumes a sanctions and PEP list to screen against. Which one, refreshed how often, and at whose cost, is not decided. Without it K02 can collect a file but cannot screen it.

**14. Certificate system integration.** Whether ASAP reads the regulator-backed issuance system directly, or records references entered by a person. The design works either way; the operational load is very different.

**15. Due diligence backfill policy.** 1,400 clients land as Not started. Are files completed at next renewal, by risk band, or on a deadline? This is a business decision with regulatory consequences, and the register is built to support any of the three.

---

# Part 9 — What is still not in the plan

Named honestly, so nobody assumes coverage that does not exist. These were identified and deliberately not closed in v3:

- **Regulatory returns and the brokerage's own licensing** — IRA returns, licence renewal, the professional indemnity cover the brokerage must itself hold.
- **Co-insurance and split placements** — a risk shared across three insurers changes the policy record, claims leadership and commission three ways.
- **Premium financing** — a lender paying the insurer directly is a third money party.
- **Introducer and sub-agent commission sharing.**
- **Group scheme members** — 86 people on a medical scheme who are not clients and are not modelled.
- **Handover when someone leaves**, and placement authority scaled by sum insured.
- **Life and investment business** — decided in scope, with no intents anywhere in the map.
- **Insurers' own portals**, where a significant share of the real conversation happens.

Version 3 closes the six that money and compliance depend on. This list is what version 4 is for.
