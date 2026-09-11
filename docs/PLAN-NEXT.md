# What is left — the plan after D-069

**Written 2026-09-11, after the demonstration was removed.** This is a survey of what a real
brokerage still cannot do, in the order that unblocks the most, with the decisions that need a
person named rather than guessed.

---

## The honest summary

ASAP is a well-built shell over a book that can only be typed in one record at a time, and nothing
in it runs by itself.

Everything a *person* can click is real: sign up, create a brokerage, add a client, record a policy,
open a record, act on a step, approve a draft, search, read the audit history. What is missing is
everything that should happen **without** a person: no book arrives in bulk, no email comes in, no
document gets read, no automation ever fires.

Seven gaps, found by reading the code rather than the screens:

| # | Gap | Evidence |
|---|---|---|
| 1 | **No bulk import of any kind.** Zero CSV machinery anywhere. | `clients.source` already allows `'imported'` — the concept was designed and never built. |
| 2 | **A client has no contact details.** No email, no phone, no contact person. | `clients` is name, kind, file status. The only `email_address` in 42 tables is the brokerage's own mailbox. |
| 3 | **Ask has no model configured.** | It is otherwise complete: a gateway, five declared tools (`find_clients`, `find_work`, `get_policy_periods`, `get_record_evidence`, `get_runs`) and an OpenAI adapter. `asap-api` boots with `ai gateway disabled: OPENAI_API_KEY, AI_MODEL`. |
| 4 | **Mailbox connect cannot finish.** The OAuth callback that exchanges the code was never written. | `POST /mailboxes/connect` builds the authorize URL and stores the state; nothing receives the redirect. |
| 5 | **No mail ever arrives.** The provider adapters only send. | `apps/api/src/mailbox/` is `send.ts` plus two providers. There is no fetch, no sync, no cursor advance. |
| 6 | **Extraction never starts.** A filed document sits at `queued` forever. | The extractor service and its API client both exist; `routes/documents.ts` never calls it. |
| 7 | **Automations never fire.** | `fireAutomationsFor()` is written and imported by nothing. `apps/workers` logs `no consumers registered yet`. |

And one more, which decides how much of the import is worth building: **there is no money model.**
No premium, commission, invoice or receipt column exists anywhere. "Money Work" is a work-item kind
with nothing behind it.

---

## The order, and why

Sequenced by what unblocks the most per unit of work. A brokerage with an empty book sees an empty
product no matter how good the screens are, so the book comes first — but Ask is nearly free and is
the thing you cannot currently see working, so it goes first of all.

### Phase 1 — Ask, actually answering (smallest, most visible)

1. **Configure a model on `asap-api`.** `AI_MODEL` plus a provider key. Ask then answers from the
   five declared tools, grounded, with citations, and abstains when the evidence is not there.
2. **Add a Claude provider adapter** beside the OpenAI one. §45 rule 3 says retrieval must not be
   tied to one vendor, and today there is exactly one adapter. Same `AiProvider` interface, chosen
   by env, so neither is special.
3. **An evaluation run before it ships** (§45 rule 11) against `docs/evaluation/SCENARIOS.md`, which
   already holds ten economic stress tests. A routing or prompt change without one is a defect.

*Result: Ask ASAP works. Nothing else changes.*

### Phase 2 — Get the book in

This is the unlock. A brokerage joining ASAP has its book in a spreadsheet, and today the only way
in is one client at a time.

4. **`client_contacts`** — a table, not columns on `clients`: a corporate client has several people.
   Name, role, email, phone, primary flag, `organization_id`, RLS, audit. This is where "their
   email" goes, and it is what makes "email this client" possible at all.
5. **Minimal premium on a policy period** — gross premium, currency, commission (rate *or* amount),
   marked `source='import'` and **unverified until a document backs it**. Not the full money machine;
   just somewhere for the premium column of their spreadsheet to land without being dropped. See the
   open questions below — I will not guess this one.
6. **`POST /imports` — CSV, server-side, in four moves:**
   - **Upload and parse.** One wide CSV, because that is the shape a brokerage's export actually has:
     client name, contact, email, policy number, insurer, class, start, end, premium, commission.
   - **Preview, per row.** Every row shows what it would create, what it would match to an existing
     record, and what is wrong with it. Nothing is written yet.
   - **Duplicate review**, reusing `matchClientName` — the same path `POST /work-items` and
     `POST /policies` already use, so an import cannot create twins the manual path would have caught.
   - **Commit, transactionally, with one audit row per record created**, and idempotent on a hash of
     the file so the same spreadsheet twice is recognised rather than imported twice.

   v1 is synchronous with a row cap (~2,000) because the worker tier does not exist yet. The screen
   says the cap rather than truncating silently.
7. **The import screen** — Phase 2 of the UI plan, in the approved visual language, reachable from
   `+ New` and from Discover's "Nothing is on file yet".

*Result: a brokerage's real book is in ASAP in one sitting, with contacts, and Discover has something
true to rank.*

### Phase 3 — Make ASAP do something on its own

8. **Wake the worker tier.** `apps/workers` gets its first real consumers, an event dispatcher, and
   the idempotency the architecture requires (`processed_at` per consumer; a duplicated webhook must
   not create two claims).
9. **Trigger extraction on upload** — file lands, job queued, extractor reads it, `document_fields`
   appear for review. The extraction review UI already exists and currently has nothing to show.
10. **Call `fireAutomationsFor`** from the event dispatcher, so an automation that is switched on
    actually watches. Every firing is already recorded, including the ones that decide to do nothing.

*Result: filing a document produces proposed values; switching an automation on makes it watch.*

### Phase 4 — The inbox

11. **The OAuth callback** — exchange the code, encrypt and store the tokens, mark the mailbox
    connected. Finishes what `POST /mailboxes/connect` starts.
12. **Mail sync** — a worker that pulls new messages per mailbox, advances `sync_cursor`, writes
    `email_threads` / `email_messages`, and links a thread to a client by matching the sender against
    `client_contacts` (which is why Phase 2 comes first).
13. **Attachments become documents**, so evidence arrives without anyone typing it — the whole point
    of connecting a mailbox.

*Result: the Email screen fills with the brokerage's own correspondence, and documents arrive on
their own.*

### Phase 5 — Money

14. The real model: premium, levies, commission, WHT and its certificate, invoices, receipts,
    reconciliation. This is a domain of its own and deserves its own work order, with the Kenyan
    values as per-organization `company_rules` carrying a source and a verified-at date — never
    constants (D-027).

### Carried, not forgotten

- **Drizzle schema is 15 tables behind** migrations 0032–0038. Only workers use it, which is why it
  has not bitten — and Phase 3 is exactly when it will. Regenerate before writing a consumer.
- **`pnpm test:rls` needs a freshly rebuilt database** (the API mutates seeded runs on boot). Every
  phase above adds tables and therefore policies; each one is incomplete without them.

---

## Decisions I will not guess

Insurance behaviour, per CLAUDE.md — getting these wrong is more expensive than asking.

1. **Premium at import: gross or total payable?** A Kenyan brokerage's spreadsheet column called
   "premium" may be the gross premium before levies (training levy, PCF) or the total the client
   actually pays. They differ, and storing one as the other quietly corrupts every later commission
   and reconciliation figure.
2. **Commission: rate or amount?** Brokerages record one or the other, sometimes both, and the rate
   is not always recoverable from the amount once levies are in the mix. Which does yours have?
3. **One CSV or several?** I have assumed one wide file, because that is what an export from an old
   system looks like. If your book is actually separate client and policy sheets, the importer should
   take them separately rather than making you join them by hand first.
4. **Which model provider for Ask?** Claude or OpenAI — this decides which adapter gets written
   first, not which is possible; the point of the gateway is that both work.

## What I would cut if you want this shorter

Phases 1 and 2 alone make ASAP usable by a real brokerage: Ask answers, and the book is in. Phases
3–5 are what make it *work while nobody is watching*, which is the actual product — but they are not
required for a brokerage to start.
