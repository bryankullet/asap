# ASAP — UI Build Specification v1

**For Claude Code.** This is how the interface described in Screen Map v3 gets built on the actual stack. It replaces the prototype's implementation entirely while keeping the rules the prototype proved.

**Read with:** Screen Map v3 (what the screens are), the v1 catalogue (detailed screen entries), the Intent & Skill Map (the 163 skills), and Architecture v3.1 (the backend).

**Assumption to confirm before the first commit:** the web app is React + Vite + TypeScript as a PWA. Everything below assumes that. If it's something else, Parts 1, 3 and 11 change; the rest doesn't.

---

# Part 0 — What we are keeping from the prototype, and what we are not

The v4 prototype got the *rules* right and the *runtime* wrong.

**Keep — port these first, before any UI exists:**

| From the prototype | Where it goes |
|---|---|
| `docs/interaction-contract.md` | `docs/ui-contract.md`, updated to v3 vocabulary |
| The no-shared-status-word test | `packages/schema/src/status.test.ts` |
| The stopped-run-creates-work test | `apps/api/src/runs/runs.test.ts` |
| The draft-without-evidence-stays-unsent test | `apps/web/src/features/drafts/draft.test.ts` |
| The nav-order assertion | `apps/web/src/shell/shell.test.tsx` |
| The enum-constrained AI response shape | Part 3 below, generalised |

**Do not keep:** the Workers-style `fetch` handler, `oai-authenticated-user-id` auth, the OpenAI Responses call, asset inlining at build time, `localStorage` as the store of record, `innerHTML` rendering.

Commit the ported tests **before** the components they test. Most will fail on day one. That failing list is the build checklist.

---

# Part 1 — Where the UI sits

## 1.1 Layout

```
apps/
  web/                 React + Vite PWA. The only thing a broker opens.
    src/
      shell/           Today, Work, Automations, Ask, Activity chip
      features/        one folder per Part 6 workflow
      components/      the registry (Part 3)
      lib/             query client, supabase client, sse
  api/                 Hono on Node. SSE for runs. Skill dispatch.
workers/
  extract/             Python. Document extraction with bounding boxes.
packages/
  schema/              Zod. Shared by web, api and workers. Single source of truth.
  ui/                  Design tokens and primitives only. No domain logic.
supabase/
  migrations/          SQL in git, via Supabase CLI
```

## 1.2 What the web app may and may not do

| | Rule |
|---|---|
| Reads | `supabase-js` with the user's JWT, through RLS. The web app never holds a service-role key. |
| Writes | Domain writes go to the API, never direct table writes. The API enforces guards; RLS is the floor, not the ceiling. |
| Realtime | Supabase realtime on `work_items`, `runs`, `records` the user can already see. RLS filters the channel. |
| Run streams | SSE from Hono at `GET /runs/:id/stream`. This is why the API is Node and not an edge function. |
| Local storage | UI preferences only — last Work view, sidebar collapsed, dismissed hints. **Never domain data.** The prototype stored records in `localStorage`; that must not survive. |
| Server state | TanStack Query. Every domain read is a query key derived from record id, so realtime invalidation is mechanical. |

## 1.3 Routes

| Route | Screen |
|---|---|
| `/` → `/today` | H01 |
| `/work?view=needs\|with\|recent\|done` | H03 |
| `/automations`, `/automations/:id` | A01, A03 |
| `/r/:recordId` | any record or work item, titled as itself |
| `/r/:recordId?panel=...` | shared panels X01–X08 |
| `/settings/...` | C01–C06, G01–G02, T01 |
| `/files`, `/files/:clientId` | K01, K02 |
| `/money/unidentified`, `/money/:insurerId`, `/money/tax` | N01, N02, N04 |

Every panel is a URL. A person must be able to send a colleague a link to the exact approval they are looking at. Modals that trap state in memory are a defect.

---

# Part 2 — Status as a typed contract

## 2.1 The enums

`packages/schema/src/status.ts` is the only place these exist.

```ts
export const TaskStatus  = z.enum(['needs_you','with_party','in_progress','done']);
export const RunStatus   = z.enum(['working','paused','finished','could_not_finish','stopped']);
export const CoverStatus = z.enum(['draft','requested','submitted','confirmed','active','expired','cancelled']);
export const MoneyStatus = z.enum(['not_invoiced','unpaid','part_paid','paid','received',
                                   'reconciled','disputed','due_to_insurer','settled']);
export const FileStatus  = z.enum(['not_started','incomplete','in_review','cleared','refresh_due']);
export const StockStatus = z.enum(['allocated','issued','voided','unaccounted']);
```

Labels live beside them in one map. **A label string never appears anywhere else in the codebase.**

## 2.2 The invariant

```ts
test('no label appears in two layers', () => {
  const all = [...TASK_LABELS, ...RUN_LABELS, ...COVER_LABELS,
               ...MONEY_LABELS, ...FILE_LABELS, ...STOCK_LABELS];
  expect(new Set(all).size).toBe(all.length);
});
```

Plus a banned-string test over rendered output: `Waiting`, `Failed`, `Success`, `Space`, `Job`, and `Completed` outside the task layer.

## 2.3 Position is enforced by component, not by discipline

Six components, each of which throws in development if rendered in the wrong slot:

| Component | Only valid inside |
|---|---|
| `<TaskStatus>` | `<CardHeadline>`, `<RecordHeader.Task>` |
| `<CoverStatus>` | `<PolicyPeriodLine>` |
| `<MoneyStatus>` | `<MoneyRow>` |
| `<RunStatus>` | `<ActivityPanel>`, `<RunDetail>` |
| `<FileStatus>` | `<ClientHeader>`, `/files` screens |
| `<StockStatus>` | `/settings/certificates` screens |

`<TaskStatus>` takes `{status, party?, since?}` and refuses to render `with_party` without a party and a since date. The prototype validated this in a modal; make it impossible to construct instead.

## 2.4 Compliance and stock never reach a work card

On a work card an incomplete client file renders as a blocked step with a reason, not as a file status. One test asserts `FileStatus` never appears inside `<WorkCard>`.

---

# Part 3 — Money is never a number

## 3.1 The type

```ts
export const PremiumComponent = z.enum([
  'base','training_levy','pcf','stamp_duty','gross_payable','commission_basis'
]);
export const Amount = z.object({
  minor: z.number().int(),          // cents. never floats.
  currency: z.literal('KES'),
  component: PremiumComponent.nullable(),   // null = genuinely not stated
  ruleVersion: z.string().nullable()        // which levy rule version produced it
});
```

`number` is not an acceptable premium type anywhere in `packages/schema`. The prototype's `amount: 1296000` is the exact shape this forbids.

## 3.2 The comparison guard

```ts
export function comparable(a: Amount, b: Amount) {
  if (a.component === null || b.component === null) return { ok:false, reason:'component_not_stated' };
  if (a.component !== b.component)                  return { ok:false, reason:'component_mismatch' };
  return { ok:true };
}
```

Every reconciliation row, every variance, every "why did this go up" runs through this. A `false` result produces an **exception row**, never a match and never a mismatch. This single function is what stops the reconciliation screen producing forty-four false problems.

## 3.3 Commission is three figures

```ts
export const CommissionFigure = z.enum(['gross','wht','net']);
```

Any commission amount carries one. `<CommissionAmount>` renders the figure name beside the number, always. Day-three check 8 depends on this being unavoidable.

---

# Part 4 — The generative UI contract

## 4.1 The model returns an intent, never markup

The prototype's best structural idea, generalised. Ask returns:

```ts
export const UiIntent = z.object({
  type:   z.enum(['answer','open_record','work_list','draft','automation','panel']),
  target: z.string().nullable(),               // must resolve to a record the user can read
  panel:  ComponentId.nullable(),              // must exist in the registry
  view:   z.enum(['summary','blocker','comparison','money','documents','timeline']),
  answer: z.string(),
  suggestions: z.array(z.string()).max(4)
});
```

Strict JSON schema, generated from the Zod type via `zod-to-json-schema`. The model cannot return HTML, cannot name a component that doesn't exist, and cannot name a record the caller can't read.

## 4.2 Validation pipeline

Every generated response passes all seven or it is discarded:

1. **Parse** against `UiIntent`. Fail → generic fallback, logged.
2. **Component exists** in the registry at the requested version.
3. **Target resolves** and the caller can read it *under RLS, checked server-side*. A target the user can't see is a fabrication, not a permission error — return the fallback, don't reveal it exists.
4. **Props bind** to real data. No prop may carry a value the model invented; every value is fetched by id.
5. **Evidence present.** Any component that displays a fact requires a source reference. No source → the component renders the fact as *no source on file*, never silently.
6. **Action vocabulary.** Any action the intent proposes must be one of the finite verbs in Part 5. Anything else is dropped.
7. **Permission.** Actions the caller lacks authority for render as disabled with the reason, not hidden.

## 4.3 What Ask is not allowed to do

It cannot send, bind, pay, clear a file, issue or void a certificate, or approve anything. It opens things and prepares things. The system prompt says so and step 6 enforces it regardless of what the prompt produced.

---

# Part 5 — The work item engine

Everything in Part 6 is data over one engine. Build the engine once.

## 5.1 Shape

```ts
WorkItem {
  id; title; kind; clientId; policyPeriodId?; ownerId;
  task: { status: TaskStatus; party?: string; since?: Date; nextCheck?: Date };
  cover?: CoverStatus; money?: MoneyStatus;
  steps: Step[]; pinned: boolean;
}
Step {
  id; label; actor: 'asap'|'you'|'insurer'|'client'|'bank'|'finance'|'regulator';
  state: 'done'|'now'|'blocked'|'todo';
  guards: GuardId[];            // must all pass before this step can complete
  evidence: EvidenceReq[];      // what must exist for it to be done
  actions: Action[];
}
```

## 5.2 The finite action vocabulary

Nothing outside this list may appear as a button. This is the click contract.

| Verb | What it does | Never |
|---|---|---|
| `prepare` | Starts a run. Reads, extracts, compares, drafts. | Sends anything |
| `open` | Navigates to a record or panel | Changes state |
| `draft` | Opens a draft for the person to copy | Creates a sent event |
| `record_send` | Records that the person actually sent it, with evidence | Sends |
| `approve` | Permits one specific action once | Performs the business outcome |
| `record_evidence` | Records what an outside party did, with the document | Infers it |
| `resolve` | Settles a conflict between two sources | Picks the newer one automatically |
| `assign` | Changes owner | Grants data access |
| `complete` | Closes the item after its exit checks | Overrides a failing check |
| `exception` | Records lapse, loss, cancellation, complaint, no-bid | Deletes anything |

## 5.3 Guards

Guards are named, server-evaluated, and re-evaluated **at execution time**, not only at render. A stale approval is one whose underlying version moved between render and execute.

| Guard | Blocks | Message shape |
|---|---|---|
| `client_file_cleared` | placement approval | "We cannot instruct cover for a client whose file is not complete." |
| `authority_sufficient` | placement, refund, settlement | names the limit and who can |
| `version_current` | any approval | names what superseded it and when |
| `component_declared` | any money comparison, settlement line | "This figure does not say what it is." |
| `agreed_rate_exists` | commission expectation | "No agreed rate on file for this class." |
| `evidence_present` | record_send, record_evidence, complete | names the missing evidence |
| `no_duplicate_open` | automation create | names the existing item |
| `certificate_unissued` | certificate issue | prevents a second issue on one number |

## 5.4 Two invariants the engine must guarantee

1. **Asking twice reopens the same item.** `no_duplicate_open` is checked on creation from Ask, from an automation, and from an inbound email detector.
2. **A run is never the only place something lives.** On `paused` or `could_not_finish`, the run creates a work item in the same transaction. Test this by disabling the Activity panel entirely and asserting nothing becomes unreachable.

---

# Part 6 — Every workflow

Format: step, who acts, what must be true, what gets recorded, what happens when it doesn't.

## 6.1 New business and quote

| # | Step | Actor | Guard | Evidence | Failure |
|---|---|---|---|---|---|
| 1 | Client file started | you | — | identity docs | file stays Not started; placement blocked later |
| 2 | Capture the requirement | you | — | client's own words, attached | missing facts become an X03 panel |
| 3 | Select insurers | you | `agreed_rate_exists` warns only | selection reason | proceeds with a warning |
| 4 | Prepare and send requests | you | — | `record_send` per insurer | draft copied ≠ sent |
| 5 | Terms return | insurer | — | the quotation document | a decline is recorded as a decline, with reason |
| 6 | Compare | asap | `component_declared` on every premium | both documents | mismatched components become exception rows |
| 7 | Present options | you | — | what was actually sent | — |
| 8 | Client chooses | client | — | their instruction, dated | ASAP may never supply this |

## 6.2 Placement

| # | Step | Actor | Guard | Evidence | Failure |
|---|---|---|---|---|---|
| 1 | Prepare placement | asap | — | quote version id | — |
| 2 | Approve | you | `client_file_cleared`, `authority_sufficient`, `version_current` | approval record | blocked with reason and a link to K02 or the new version |
| 3 | Instruct the insurer | you | — | `record_send` | cover stays Requested |
| 4 | Underwriting requirements | insurer | — | each requirement and its response | outstanding requirements block issuance, not cover |
| 5 | Cover confirmed | insurer | — | **cover note or written confirmation** | cover moves to Confirmed only here |
| 6 | Inception | — | date reached | — | Confirmed → Active cover at inception, by date, not by anyone clicking |
| 7 | Documents received and checked | asap → you | — | comparison against the chosen quote | differences become a work item, cover unaffected |

**Principal-officer override** on step 2 requires a typed reason, creates a permanent audit entry, and surfaces on the MD's Today.

## 6.3 Servicing — endorsement

| # | Step | Actor | Guard | Evidence | Failure |
|---|---|---|---|---|---|
| 1 | Classify the request | asap | — | the request as received | ambiguous → asks |
| 2 | Check requirements | asap | — | — | missing → X03 |
| 3 | Request from insurer | you | `authority_sufficient` | `record_send` | — |
| 4 | Insurer responds | insurer | — | their written response | **partial acceptance is itemised per item**; rejected items stay uncovered and visible |
| 5 | Update the policy | you | — | new policy version | old version retained |
| 6 | Additional premium | finance | `component_declared` | invoice | money track, separate |

## 6.4 Servicing — TOR

Step 1 is `business_rule_exists('tor_meaning')`. If absent, every later step is `blocked` and the only available action opens the business rule. **No rate, no minimum duration and no form is guessed.** Once set in C06 it is never asked again.

## 6.5 Servicing — certificate

| # | Step | Actor | Guard | Evidence |
|---|---|---|---|---|
| 1 | Look for a valid existing certificate | asap | — | the one found and why it can't be reused |
| 2 | Allocate a number | you | stock available | T01 allocation |
| 3 | Request or issue | you/insurer | `certificate_unissued` | insurer or regulator-system reference |
| 4 | Deliver | you | — | recipient's acknowledgement |
| 5 | Void if spoiled | you | typed reason | who, when, why |

A reprint records a reprint. It never consumes a second number.

## 6.6 Claims

| # | Step | Actor | Guard | Evidence | Failure |
|---|---|---|---|---|---|
| 1 | Capture the incident | asap | — | the client's own report | from email = **draft claim**, never registered |
| 2 | Match to a policy period | you | — | the schedule | two candidates → the person chooses |
| 3 | Check cover on the incident date | asap | — | policy period + wording | phrased as *looks right*, never *is covered* |
| 4 | Notification clock | asap | wording clause extracted | the clause and its page | a breach is never asserted without a clause and a verified start date |
| 5 | Collect documents | you/client | — | each document | outstanding named with who holds it |
| 6 | Submit | you | `evidence_present` | `record_send` | — |
| 7 | Insurer responds | insurer | — | their email, not a call note | a call note is stored as a note, never as their words |
| 8 | Settlement offered | insurer | — | discharge voucher | offer ≠ acceptance |
| 9 | Client accepts | client | — | signed acceptance | separate fact |
| 10 | Payment received | bank | — | the receipt | third separate fact |

Steps 8, 9 and 10 are three rows. They are never merged into one status.

## 6.7 Renewal

Nine steps, as in the prototype, with two additions: step 0 checks `client_file_cleared` and warns early rather than at approval; and **the lapse path is loud** — if the period end passes with no instruction, cover goes to Expired, a warning notice pins to the client, and the item cannot be completed. It can only be resolved by placing cover or by an `exception` of type `lapse`, which requires a typed reason and a record that the client was told in writing.

## 6.8 Compliance

| # | Step | Actor | Guard | Evidence |
|---|---|---|---|---|
| 1 | Identify | you | — | ID or registration documents |
| 2 | Beneficial ownership (corporate) | you | — | ownership declaration |
| 3 | Screen | asap | screening source configured | the hit list and its date |
| 4 | Review matches | you | — | reasoning stored |
| 5 | Decide | you | named human | decision, reason, date, who |
| 6 | Refresh | — | interval reached | file returns to Refresh due |

A confirmed screening match escalates to the principal officer and blocks the client. `kyc.decide` is never automated. Imported clients land at Not started — a migration test asserts no imported row is ever Cleared.

## 6.9 Money in

| # | Step | Actor | Guard | Evidence |
|---|---|---|---|---|
| 1 | Invoice | finance | `component_declared` on all six components | the invoice, with X08 breakdown |
| 2 | Receipt arrives | bank | — | bank or mobile-money line |
| 3 | Attribute | you | — | what it was matched to and why |
| 4 | If unattributable | — | — | goes to N01 and **stays there** |
| 5 | Cancellation clock | asap | wording clause | days until the insurer may cancel for non-payment |

Step 3 may be *suggested* by ASAP and never performed by it. Step 5 is the number that matters more than the days overdue.

## 6.10 Money out

| # | Step | Actor | Guard | Evidence |
|---|---|---|---|---|
| 1 | Age what is due | asap | credit terms from G02 | — |
| 2 | Flag regulatory exposure | asap | terms exceeded | premium held, and for how long |
| 3 | Prepare the run | asap | `component_declared` per line | line-by-line breakdown |
| 4 | Approve | you | `authority_sufficient` | approval record |
| 5 | Record payment | finance | evidence of actual movement | bank reference |
| 6 | Insurer acknowledges | insurer | — | their confirmation |

A line with an unknown component blocks **that line**, not the run.

## 6.11 Reconciliation

| # | Step | Actor | Guard | Evidence |
|---|---|---|---|---|
| 1 | Import the statement | asap | — | source rows kept with references |
| 2 | Expected commission | asap | `agreed_rate_exists` | the agreement clause from G02 |
| 3 | Match | asap | `comparable()` per row | — |
| 4 | Resolve exceptions | you | — | per-row decision |
| 5 | Post | finance | approval | — |

A shortfall stays open as a disputed amount with the clause attached. **Posting does not clear it.** There is no bulk "accept all differences" action anywhere in the product.

## 6.12 Withholding tax

Withheld amounts are recorded when the statement is imported. N04 shows tax withheld, certificates received, certificates outstanding, and the unrecoverable total. Closure is blocked while any certificate is outstanding.

## 6.13 Import

Ready items save. Exceptions wait. Failures are retried or handed off. Three counts on screen at all times, never one progress bar. Every imported client gets `file_status = 'not_started'`. Duplicate candidates go to a person. Conflicting values go to X03 and **both values are retained** whichever is chosen.

## 6.14 Exceptions and closure

Exception types: no-bid, lost, lapse, cancellation, complaint. Each requires a typed reason and preserves history. A cancellation records that *we requested it*; the insurer's confirmation is a separate fact that alone moves cover to Cancelled.

Closure runs its checks: claims clear, service clear, delivery clear, complaints none, commission reconciled, tax certificates received, certificate stock accounted. Failing checks are named. A closed year reopens if a claim arrives against it, and the closure is flagged for review with nothing overwritten.

---

# Part 7 — Draft and send

```ts
Draft { id; workItemId; to; subject; body; copiedAt?: Date; sentAt?: Date; sentEvidence?: string; }
```

- `copiedAt` is set when the person copies the draft. It advances nothing.
- `sentAt` may only be set together with `sentEvidence` — a message id, a sent-folder reference, or a typed confirmation.
- Any code path that sets `sentAt` without evidence is a defect. One test asserts it directly, ported from the prototype.
- The only automatic external messages are scheduled, approved-template, informational ones the brokerage explicitly turned on. Everything else is drafted.
- Send outcome unknown → retry is **disabled** until an outcome check runs. Blind retry risks a duplicate submission.

---

# Part 8 — Runs and the Activity chip

- `POST /runs` starts one; `GET /runs/:id/stream` is SSE with `step`, `paused`, `finished`, `error` events.
- The chip renders only when a run is working, paused, or finished this session.
- A run's completion message names its actual output ("Renewal pack prepared"). It may never name a business outcome ("Policy renewed"). Enforce with a banned-phrase test over run titles.
- `paused` and `could_not_finish` create a work item in the same database transaction as the status change. Not in a callback, not best-effort.

---

# Part 9 — Permissions

- RLS is the floor. The UI never decides visibility by hiding a rendered element.
- **Hidden rows must not appear in counts, totals, search result counts or chart aggregates.** This is a query-level rule, tested with pgTAP per role.
- A restricted field renders as "Not available to your role" with the role named. Never blank, never zero.
- Ownership is not access. `assign` changes accountability and grants nothing.
- Authority limits are per class and per sum insured, evaluated server-side at execution.

---

# Part 10 — The states every screen owes

| State | Requirement |
|---|---|
| Empty | Name the scope and its freshness. No sample data pretending to be real. One useful next action. |
| Loading | Skeleton matching final layout. Never a spinner over a blank page. |
| Stale | Show the time the data is from, in words. |
| Offline | Read-only. Every action disabled with one reason. Nothing pretends to save. |
| Permission denied | Explained, per Part 9. |
| Conflict | Both values, both sources, the person chooses, both retained. |
| Partial success | Itemised. Never averaged into a percentage. |
| Unknown outcome | Named as unknown. Retry disabled until checked. |

---

# Part 11 — Tests

| Layer | Tool | What it proves |
|---|---|---|
| Schema invariants | Vitest | no shared status word; `Amount` has no bare-number path; comparison guard behaviour |
| Engine | Vitest | guards block; paused/failed runs create work in-transaction; duplicate prevention |
| Components | Vitest + Testing Library | status components refuse wrong slots; banned strings absent from rendered output |
| RLS | pgTAP | per role, hidden rows excluded from reads **and from counts** |
| Flows | Playwright | one spec per Part 6 workflow, driven through the UI, asserting the guard failures fire |
| Day-three | manual | the nine checks in Screen Map v3 Part 7. Not automatable, and saying so is part of the spec. |

The Playwright suite needs a scenario fixture set. Port the prototype's 32 scenarios as seed fixtures — they are the closest thing to a written list of what the product must survive.

---

# Part 12 — Build order

Each phase ends somewhere previewable on Render.

| Phase | Ships | Previewable |
|---|---|---|
| 0 | `packages/schema` — status, Amount, UiIntent, guards. Ported tests, all failing. | No. This is the contract. |
| 1 | Shell: three destinations, Work's four views, record routes, Ask that only searches. Real Supabase reads, RLS on. | **Yes.** Navigable with seeded data. |
| 2 | Work item engine + one workflow end to end: renewal. Draft/send. Runs and the chip. | Yes. One complete story. |
| 3 | Money: X08 components, invoicing, receipts, N01. Reconciliation with the comparison guard. | Yes. The reconciliation demo now means something. |
| 4 | Compliance (K01–K03) and the placement gate. Agreements (G01–G02). | Yes. |
| 5 | Claims, servicing, TOR, certificates and stock. | Yes. |
| 6 | Money out (N02–N04), closure, exceptions. | Yes. |
| 7 | Automations, import, investigation and team screens. | Feature complete against v3. |

**Do not build phase 3 before phase 0.** The `Amount` type has to exist before any premium is written to the database, because retrofitting a component onto live rows means guessing which figure historical numbers were.

---

# Part 13 — Decisions still open

1. **Levy and duty rates** — confirm against current law; versioned in C06, never in code. *Blocks phase 3.*
2. **Withholding tax rate and scope.** *Blocks phase 3.*
3. **Screening data source** for K03. *Blocks phase 4.*
4. **Certificate system integration** — direct read, or references typed by a person. *Blocks phase 5.*
5. **Due diligence backfill policy** for imported clients. *Blocks phase 4.*
6. **Which model powers Ask**, and whether the component registry in Architecture v3.1 collapses into the narrower `UiIntent` in Part 4. These are two different contracts and only one should survive. *Blocks phase 1's Ask beyond search.*
7. **Frontend framework confirmation.** *Blocks everything.*
