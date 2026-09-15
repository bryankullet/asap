# Prompt for Claude Design

Paste everything below the line. Attach `docs/ui/DESIGN-HANDOVER.md` — it is the full brief and
this prompt assumes you have read it.

---

You are designing the interface for **ASAP**, a multi-tenant AI operating system for insurance
brokerages in Kenya. Read the attached `DESIGN-HANDOVER.md` first — it is the controlling brief.
This prompt tells you what to make from it.

## What I want back

**One clickable prototype covering the whole product, from onboarding to the money screens**, that
five people in a brokerage can sit down and click through without me narrating. Every screen in the
path below, linked in order, with the back-links and panel-opens that make it feel like the real
thing rather than a slideshow.

Then I am bringing it back into the codebase and implementing it, so I need the design to be
buildable: real tokens, a named component per repeated element, and states rather than one happy
path.

## The product in one paragraph

A brokerage's whole book lives here. A person says what they need; ASAP assembles a workspace for
that piece of work and **prepares** actions a human approves. It is not a chatbot bolted onto
insurance software, and it is not a menu-driven CRM — there is no `Clients / Policies / Renewals /
Claims / Money` menu, and no insurance object is ever a navigation destination. If you find
yourself designing a list page for an entity type, that is the wrong product.

## The shell — settled, do not redesign the structure

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

228px sidebar, one main work area, the app does not scroll — the panes do. Ask ASAP is **both** a
destination and a composer docked on every surface, never covering content. Under 900px the sidebar
becomes a 58px bottom bar. Everything else in the product is reached from a Work item, a record,
Ask, or settings.

## The click path — in this order, start to finish

**Getting in**
1. Sign up · sign in · forgotten password
2. Create your brokerage — name, legal name, country, currency, time zone
3. Invite a colleague, and the invited person's accept screen
4. **Import your book.** Drop *any* document — CSV, spreadsheet, or a PDF policy schedule. ASAP
   reads the table out of it and **proposes** a column mapping a person confirms. Show: the drop
   state, reading, the proposed mapping, a row that could not be read and why, and the result —
   including that **every imported client lands as "Not started"** on their compliance file. Day one
   shows the size of that backlog; it does not hide it.
5. Connect email (Gmail / Microsoft 365), and the state where connecting cannot finish
6. **Discover, first use** — a brand-new brokerage with nothing in it. Setup actions, never sample
   business presented as real records.

**The daily product**
7. Discover, populated — what deserves attention now, and why
8. Ask ASAP in full: the conversation, the context chip, the generated Work panel, the evidence
9. Ask generates a workspace → the Work board (Active · Waiting · For review · Completed · Pinned ·
   Recent)
10. **A renewal workspace**, composed of blocks: one readable title, client and period, plain status,
    one short explanation, **one primary button**, at most two secondary controls
11. **Extraction review** — the document viewer with page highlights. A proposed value beside the
    rectangle it was read from, accept or correct per field. This one matters most: it is how a
    reading becomes a value.

**Compliance, and the gate**
12. Client files register — Blocking live work · Incomplete · Refresh due · Cleared · Not started
13. One client's file: documents held and missing, beneficial ownership, source of funds, screening,
    the decision and who made it, the refresh date
14. Screening match review — the hit, the list it came from, what matches and what does not, and
    three options: not a match · possible match, escalate · confirmed match
15. **The gate.** A placement approval blocked because the client's file is incomplete. It must read
    as a **reason, not a refusal** — plain words, and what would unblock it — with a link straight to
    the file. Then the principal officer's written override, and the audit entry it creates.

**Money — none of this exists yet, so it is the biggest piece of new design**
16. Insurer agreements register, and one agreement version with the rate per class and the clause
    each rate came from
17. **What makes up this premium** — a panel that opens on *any* premium figure: base premium,
    training levy, PCF, stamp duty, gross payable, and the **commission basis named explicitly**
18. Commission shown as **three separate numbers** — gross, withholding tax, net received. A finance
    person must be able to say which one they are looking at from the screen alone.
19. Reconciliation, where a row whose premium component is unknown is an **exception** with the
    reason *component not stated* — never quietly matched, never counted as a mismatch
20. **Money we can't place** — receipts that arrived and cannot be attributed. The total shown
    prominently, candidate matches with the reason for each, and no way for ASAP to attribute one
    itself.
21. Insurer account — premium due out, commission due in, disputes both ways, **never netted on
    screen** — plus the brokerage's own regulatory exposure as a named, aged figure
22. Settlement run, and tax certificates outstanding

**The rest of the loop**
23. Certificate stock — Allocated · Issued · Voided · **Unaccounted**. Unaccounted must read as a
    live problem to chase, not a tidy-up state.
24. Jobs, and a job that could not finish — what failed, what succeeded, whether anything changed
25. Automations: the list, creating one, and the history of every firing **including the ones that
    did nothing, and why**
26. Search · Audit history · Members and roles · Data and connections · Business rules (the levy
    rates, stamp duty, WHT rate — versioned, with a source and a verified-at date)
27. **Mobile**: Discover, Work, Ask and one approval. First-class layouts, not squeezes. Never hide
    approval evidence or a financial total to fit a phone.

## Typography — change this

Move the whole product to a **rounded** typeface. Today it is Figtree for body and Outfit for
headings; both are geometric but not rounded, and the product should feel calmer and less clinical
than it does.

- **Body: Nunito.** Rounded terminals, and it holds up at 13–15px in dense tables, which most
  rounded faces do not.
- **Headings: Baloo 2**, or **Quicksand** if Baloo reads too heavy at large sizes. Show me both on
  one screen so I can choose.
- Keep a system stack behind both — the app must be legible before the webfont lands, and if it
  never does.
- Rounded must not cost legibility in the money screens. If a rounded face makes a column of figures
  harder to scan, say so and use a tabular-figure fallback for numerals.

## The rest of the tokens — keep

```
Ink       #102a43 primary · #334e68 secondary · #66788a muted
Surfaces  #ffffff paper · #f6f8f9 wash · #e7ecef sunken
Lines     #dfe6ea strong · #edf1f3 soft
Green     #0f7b5a · soft #e7f5ef     running, active, "ASAP is working"
Gold      #d9a62e · soft #fbf4dc     waiting, attention
Red       #b94a48 · soft #fff0ef     needs review, error
Radius    18px cards · 12px controls · 99px pills
Shadow    0 14px 44px rgba(16,42,67,.09) — for things that float only
```

A card at rest is a hairline border and an 18px radius, **never a drop shadow**. Status colour is
fixed and semantic — green running, gold waiting, red needs review, grey done — never re-mapped per
screen, and never the only carrier of meaning.

## Rules that are defects if broken, not preferences

1. **Abstention is a state, not a blank.** A value never captured reads *not stated* — never zero,
   never an empty cell.
2. **A conflict never resolves itself on screen.** Two sources disagreeing shows **both**, with
   their sources. Picking a winner hides the thing the person needs to see.
3. **No confidence percentages.** Plain labels only: *Source confirmed* · *Check this value* ·
   *Not enough information*.
4. **Every cited figure opens its document, page and highlight region.** A citation you cannot open
   is not a citation.
5. **ASAP prepares; a person decides.** It may not clear a client file, issue a certificate,
   attribute money, move money, or decide a claim. Design the prepared-action-plus-approval shape,
   not an autonomous one.
6. **A finished Job never reads as a business outcome.** *Renewal pack prepared* — never "policy
   renewed".
7. **Status vocabulary is layered and no word appears twice.** Task: With ⟨party⟩ · In progress ·
   Done. Run: Working · Paused · Finished · Couldn't finish · Stopped. Cover: Draft · Requested ·
   Submitted · Confirmed · Active cover · Expired · Cancelled. Money: Not invoiced · Unpaid · Part
   paid · Paid · Received · Reconciled · Disputed. **"Needs you" is retired. "Space" never appears
   on screen — it is called Work.**
8. **Never colour alone for status.**

## Every screen needs its states

Not one happy path. For each screen in the path, design: **loading** (the actual step and scope, with
Stop where cancelling is safe) · **empty** (why, and one useful next step) · **ASAP is working** ·
**waiting on a third party** (who, what is expected, when waiting began, last follow-up, next check)
· **missing data** (a checklist: Add · Request information · Enter manually) · **conflict** ·
**error or partial** (what failed, what succeeded, whether anything changed) · **permission denied**
(explained safely, navigation preserved, nothing restricted leaked) · **stale** (last successful
update and affected scope).

Where the full set would be repetitive, design them once as a pattern and mark which screens use it.

## Deliverables

1. **The clickable prototype**, in the order above, with links working both ways and panels opening
   in place rather than stacking dialogs.
2. **A component inventory** — every repeated element named, with its variants and states. I need
   this to become real components, so a name per thing matters more than polish.
3. **The token file**, as final values: the rounded font stack, and anything you changed or added.
4. **A short note on what you changed and why**, especially anywhere you think the brief above is
   wrong. I would rather argue about it than receive a design that quietly disagrees.

If something in the path cannot be designed without a decision I have not made, design it under a
stated assumption and flag the assumption — do not stop.
