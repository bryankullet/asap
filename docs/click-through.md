# Click-through: what a seeded deploy must show

The acceptance document for every deploy. Sign in as each user below and check what you see against
what is written here. A difference is a defect in the deploy, the seed or the code — not a variation.

Two brokerages, seven people, one deliberate consultant who belongs to both. Passwords and roles are
in `docs/staging-users.md`. The data is `supabase/seed.sql`, applied to hosted; every row named here
was read back from hosted through RLS as the user named.

Ranking is not a preference. Discover (renamed from Today by D-060, at `/discover`) shows **Needs
you** (task status `needs_you`) and **Checks due** (`with_party` whose next check has passed), in
that order. Everything else lives in Work.

**Inside a section the order is the deterministic signal score** from `apps/api/src/attention/signals.ts`,
not recency: a blocked step, a run that could not finish and an overdue check outrank an item that
is merely recent. Every card's "Why here?" lists the signals that ranked it, each naming the row it
came from, so the order can be checked against the record. No model produces a score or a fact.

---

## 1. What Discover shows, per user

### Amina Otieno — `admin@acme-brokers.test` — Acme Insurance Brokers, brokerage administrator

Five cards. Four under **Needs you**, one under **Checks due**.

| # | Section | Card | Status word | Now | Why is this here? |
|---|---|---|---|---|---|
| 1 | Needs you | Jane Wanjiku — claim, incident 2 September | Needs you | Matched to a policy period (you) | The incident came in by email and is still a draft. Choose the policy period that covers 2 September before anything is sent to Jubilee. |
| 2 | Needs you | Acme Motors — add KDC 900T to the Motor commercial policy | Needs you | Policy updated (you) | Jubilee has answered every item: one vehicle accepted, one rejected. Applying the answer writes a new policy version. |
| 3 | Needs you | Acme Motors — Motor commercial placement with Jubilee | Needs you | Placement approved (you) | Approval is blocked until Acme Motors' client file is cleared. |
| 4 | Needs you | KDA 482A — motor certificate | Needs you | Allocate a number (you) | Cover is confirmed but no certificate number has been allocated for this vehicle. |
| 5 | Checks due | Acme Motors — renewal terms from Jubilee | With Jubilee since *(5 days ago)* | Terms received (insurer) | Terms were requested from Jubilee five days ago and the check was due yesterday. |

Card 4 also carries a red footer: **ASAP could not finish: Check this file.** That is run
`40000000-…-000000000003` (Certificate extraction), which stopped and left the item needing a person.

Not on Discover, by design: **Acme Motors — Q2 statement reconciled** (done, in Work → Done).

### Brian Kamau — `ae@acme-brokers.test` — Acme, account executive

The same five cards. He owns every one of them. He cannot override the placement gate (card 3):
only a brokerage administrator can.

### Cynthia Wanjiru — `finance@acme-brokers.test` — Acme, finance officer

The same five cards. Discover is the brokerage's work, not a personal queue; ownership shows on the
record, not by hiding rows.

### David Mwangi — `admin@beta-risk.test` — Beta Risk Partners, brokerage administrator

One card, under **Needs you**:

| Card | Status word | Now | Why is this here? |
|---|---|---|---|
| Otieno household — new business quote | Needs you | Choose and recommend (you) | Three quotes are back; a recommendation is waiting for you. |

**Beta Risk — CIC premium statement** is `with_party` CIC with its next check a month out, so it is
in Work → With others, not on Discover. Nothing of Acme's is visible anywhere, at any time.

### Esther Njeri — `ae@beta-risk.test` and Felix Odhiambo — `finance@beta-risk.test`

The same single Beta card as David.

### Grace Achieng — `shared@consultant.test` — both brokerages

She signs in to **Acme Insurance Brokers** (read-only) and sees Amina's five cards. The profile
control at the bottom of the sidebar offers both brokerages; switching to **Beta Risk Partners**
(account executive) replaces Discover with David's single card. She is the isolation counterexample:
one session, two brokerages, never both at once, and a different role in each. As read-only in Acme
she can open everything and change nothing; the action buttons are absent, not merely disabled.

---

## 2. What each item does when opened

Every card links to `/r/:recordId`. The record shows the full step list, what is done, what is now,
and what is still to come; the current step carries its actions.

- **Jane Wanjiku — claim.** Ten steps (Part 6.6). *Incident captured* is done. *Matched to a policy
  period* is now: the panel offers Jane's Motor private period 1 March 2026 – 28 February 2027 as
  the only candidate, because it is the only period that contains 2 September. Choosing it registers
  the claim, by a person. Below the steps: two outstanding documents, **Police abstract** (police)
  and **Repair estimate** (garage), each naming who holds it. Settlement offered, client accepted and
  payment received are three separate rows and never merge. The notification clock reads *not
  started* with the reason, because no wording clause and no verified start event are on record.
- **Acme Motors — endorsement.** Six steps (Part 6.3). Classify, requirements, request and response
  are done; the response carries **Jubilee email, 8 September**. *Policy updated* is now. The panel
  shows both items: **KDC 900T Isuzu FRR** accepted, **KDD 111A Nissan Caravan** rejected, with the
  insurer's reason. Applying writes policy version 2 effective 1 October 2026, ends version 1 on 30
  September, and keeps the rejected vehicle on the new version marked uncovered.
- **Acme Motors — placement.** Seven steps. *Placement prepared* is done, *Placement approved* is
  now and blocked. Pressing **Approve** produces exactly this, in a gold "Not yet" notice:

  > **Not yet:** We cannot instruct cover for a client whose file is not complete. The file is not
  > started. Open the client's file at /files/70000000-0000-4000-8000-00000000000a.

  For Amina only, a second panel appears offering an override in her own words, because she is the
  principal officer. Overriding writes a permanent audit entry and puts an exception item on her
  Discover. Brian sees the block and no override.
- **KDA 482A — certificate.** *Allocate a number* is now. The stopped run is named on the record with
  its next step.
- **Acme Motors — renewal.** *Terms received* is with Jubilee. The record offers a draft chaser; a
  send is only recordable with evidence of what was actually sent.

---

## 3. The twelve steps

Run these in order as **Amina**. Each step says what must happen.

1. **Sign in** at `/sign-in` with `admin@acme-brokers.test`. You land on `/today`. You are never
   asked which brokerage: you belong to one, so the server chose it. The profile control at the
   bottom of the sidebar reads **Acme Insurance Brokers / Amina Otieno**, never "Choose a brokerage".
2. **Read Discover.** Five cards, in the two sections and the order in §1. Not an empty state.
3. **Press "Why here?"** on the placement card. It reveals: *Approval is blocked until Acme Motors'
   client file is cleared.* Every card has this control and every one gives a reason.
4. **Open the placement** (`/r/30000000-0000-4000-8000-000000000005`). Seven steps, *Placement
   approved* marked as now.
5. **Press Approve.** The gold "Not yet" notice appears with the exact wording in §2, including the
   link to the client's file. Nothing is approved.
6. **Follow that link** to `/files/70000000-0000-4000-8000-00000000000a`. Acme Motors, file **not
   started**, corporate, so it needs an identity document and a beneficial-ownership declaration.
7. **Record both documents**, then **clear the file** with a typed reason. The file becomes
   **cleared**. A clearing with no reason, or with a document missing, is refused.
8. **Return to the placement and press Approve.** It succeeds. *Placement approved* becomes done and
   *Jubilee instructed* becomes now.
9. **Draft the instruction.** A draft appears with a subject and body you can copy. Press **I sent
   this** with the evidence box empty: it is refused. Type what you sent, and it is recorded.
10. **Open the claim** (`/r/30000000-0000-4000-8000-000000000003`). Choose the 1 March 2026 policy
    period. The claim moves from draft to registered and names you as the person who registered it.
11. **Open the endorsement** (`/r/30000000-0000-4000-8000-000000000006`) and apply the confirmed
    changes. Open the policy afterwards: version 2 is in force from 1 October, version 1 is kept and
    ended 30 September, and KDD 111A appears on version 2 as **not covered**, with Jubilee's reason.
12. **Sign out from the profile control.** Sign back in as `shared@consultant.test`: Grace lands in
    Acme, and the profile control offers both brokerages. Switch to Beta Risk Partners: Discover becomes
    the single Otieno card and no Acme row is reachable, by link or by search.

---

## 4. Notes for whoever maintains this

- **Every figure here came from hosted, read as the named user through RLS.** Regenerate rather than
  edit from memory.
- **`apps/web/src/views/today.acceptance.test.tsx`** holds Amina's five rows as fixtures and fails if
  the ranking, the status words, the reasons or the stopped-run footer change. It is the automated
  half of §1; this document is the half a person checks.
- **The seed's timestamps are relative to when it runs.** A check meant to stay in the future needs
  real distance (Beta's CIC statement is 30 days out for that reason); a check meant to be overdue is
  written in the past. A card that changes section as days pass is a seed defect.
- **Steps 7 to 11 change the data.** After a full click-through the brokerage no longer matches §1.
  Re-run the seed before using this document again.
