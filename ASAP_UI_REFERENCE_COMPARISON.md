# ASAP — UI reference comparison

Date: 2026-09-10
Commit: `a35d295` on `claude/awaiting-files-md15v3`
Reference: `docs/ui/prototype/dist/` (the v4 prototype), served and driven at the same sizes as the real application.

**How this was produced.** Both were run and driven in the same Chromium build, at 1360×900 and 390×844, side by side:

- The real application — the real Hono API and the real React bundle, with `VITE_PUBLIC_RENEWAL_SPACE=on`.
- The prototype — its own `dist/`, entered through **Explore demo** so it reaches its sample Today.

Screenshots are in `docs/audit/space/`. The goal is not pixel matching. It is the same simplicity, hierarchy, behaviour and cognitive load.

**One limitation, stated up front.** The application ran against a stubbed Supabase serving rows copied from hosted (the same harness as `ASAP_CURRENT_BUILD_AUDIT.md`). The API, the validator, the registry lookup and the React bundle are all real; Postgres, RLS and Supabase Auth are not exercised in this path. RLS is proven separately on hosted — see `ASAP_SPACE_FOUNDATION_REPORT.md`.

---

## 1. What now matches

| | Prototype | Real application | Evidence |
|---|---|---|---|
| Sidebar order | Today · Work · Automations, then + New, Search, Profile | The same, with Search and + New in the same place | `01-today.png`, `20-prototype-today-desktop.png` |
| Ask | Docked at the foot of the workspace, present on every screen | The same | both Today shots |
| Activity | A pill, near the dock, never in navigation | A chip, top-right, never in navigation | `01-today.png` |
| Insurance modules in nav | None | None | shots above |
| Record page leads with a focus panel | "Next step" eyebrow, headline, one sentence, one primary button, ghost "Why here?" | The same five parts, in the same order | `03-renewal-space-summary.png`, `21-prototype-renewal-desktop.png` |
| Focus panel styling | Hairline border, 4px green left border, generous padding, ~1.45rem headline | The same | both renewal shots |
| Insurer terms panel | Rows of `insurer → On file · date` / `Not on file` | The same rows, from the record's own recorded evidence | both renewal shots |
| Record footer | Source chip · Activity · History | Evidence on record (4) · Activity · History | both renewal shots |
| Task status pill | Leading dot, gold for a third party, named party and since date | The same, from our own enum through the slot components | both |
| Cover on its own line | "Active cover", never in the headline | The same | both |
| Draft is never shown as sent | — | "Draft — you send it" pill on the prepared draft | `03-renewal-space-summary.png` |
| Cards at rest | Hairline border, 18px radius, no drop shadow | The same | all shots |
| Fonts and palette | Figtree body, Outfit headings, navy/green/gold | The same tokens, ported in D-056 | all shots |
| Follow-up changes the blocks | "Compare terms" swaps the panel set without leaving the record | The same, and the URL is unchanged | `04`, `05`, `06` |

## 2. What remains visually different, and why

Ordered by how much it costs a person. **Nothing here was left undone by oversight; each line says which.**

| # | Difference | Prototype | Ours | Why it remains |
|---|---|---|---|---|
| 1 | **Today has no page head** | "Good morning, Grace." then "Here is what matters today." | Starts straight at the "Needs you" section heading; the page has no `h1` | Not built. A greeting needs the signed-in person's display name, which `/attention` does not return. Small, and it costs a person the page's top-level heading — worth doing next. |
| 2 | **Today's rows are one card, not many** | One "Your priorities" card, hairline-separated rows, count pill in the card head | One card per item, section heading plus count above | A deliberate deviation, and I think ours is wrong: five cards is five borders and more scrolling for the same information. Changing it is layout only. |
| 3 | **No per-row action on a Today card** | Each row carries "Continue" / "Review" on the right | The card title is the only way in; "Why here?" sits under it | Not built. Our actions come from the record's current step and its guards, and `/attention` returns the step but not its actions. It is a real gap: the prototype lets a person act from Today. |
| 4 | **The reason is hidden until asked** | The one-line reason is always visible under the title | Behind "Why here?" | Deliberate. Screen Map v3 makes "Why is this here?" a control; the prototype shows both. Ours is quieter but costs a click on every card. Worth revisiting with a real new hire, per the day-three checks. |
| 5 | **No owner or next-check line on a card** | "Next check 6 Sep · James Mwangi" | Neither is shown on the card | Not built. `work_items` carries `owner_id` and `task_next_check`; `/attention` does not return the owner's name. |
| 6 | **Cover status on every Today card** | Not shown on Today at all | "Cover · Active cover" on every card, and Money where present | Ours is noisier than the reference. It is correct by the slot rules, and it is not what the prototype judged worth the space. |
| 7 | **No "ASAP noticed" strip, no quick actions** | An observation strip, and Add records / Connect email / View all work | Neither | Not built, by phase. The observation strip is Architecture §27's detectors (architecture Phase 4); the quick actions are import and mailbox connection (architecture Phase 2/3). |
| 8 | **Record page has no back link, Pin or ⋯** | "← Back  Acme Ltd" breadcrumb, ☆ Pin, ⋯ menu | None | Not built. Pinned is a personal marker Screen Map v3 defers; the ⋯ menu has nothing to put in it yet. The back link is browser-back only, which is a genuine small loss. |
| 9 | **Title does not carry the expiry** | "Acme motor renewal — expires 14 Oct" | "Acme Motors — renewal terms from Jubilee" | Ours is the record's own title from the engine. The prototype's is composed for the page. Both name the record rather than the recipe, so both satisfy the contract; the prototype's is more useful. |
| 10 | **Task pill sits below the title, not above** | Pill above the `h1` | Pill inside the client block under the `h1` | Ours puts the client and the task status in one registered `ClientHeader` block; the prototype puts the pill in the page head. Layout only. |
| 11 | **Cover period is a card, not a summary line** | One line: "Policy period · 15 Oct 2025 – 14 Oct 2026" … "Active cover" | A "Current cover period" card with four rows | Ours is heavier. The card exists because `PolicyCard` must carry its evidence; the prototype shows the same facts in a line and puts the source in the footer chip. |
| 12 | **Supporting panels stack; the reference uses two columns** | "Insurer terms" and "Prepared for you" side by side | Stacked, full width | Layout only. The two-column grid reads as less work at desktop width. |
| 13 | **The focus eyebrow is uppercase** | "Next step", sentence case, quiet grey | "NEXT STEP", uppercase, letterspaced | Ours is louder than the reference. One line of CSS. |
| 14 | **The primary button is green, not navy** | Navy fill | Green fill | Ours reads green as "ASAP is working"; the prototype uses navy for the page's one primary action and reserves green for status. The reference is more consistent with our own status semantics. |
| 15 | **No context chip above the Ask dock** | "Acme motor renewal — expires 14 Oct ⌄" — the dock says what it is asking about | The dock carries no context indicator | Not built. `ContextChip` is in the component library and in no Space yet. It matters: Ask always carries context and never says so. |
| 16 | **Ask placeholder is narrower in promise** | "Tell ASAP what you need…" | "Find a client, vehicle or item…" | Deliberate and honest: today Ask only searches titles. The prototype's wording would promise more than the code does. |
| 17 | **No keyboard hint** | "Ctrl / ⌘ K to ask" | None, and no shortcut | Not built. |
| 18 | **"Prepared for you" is a checklist there, a draft here** | A tick list of what ASAP did, plus "Review client options" | The prepared draft itself, with its to/subject/body | Different content, not different styling: our renewal's prepared thing at this step *is* a draft. The tick list exists in our focus block under "What is done, and what is not". |

## 3. Screenshots

| File | What it shows |
|---|---|
| `01-today.png` | Today, real application, through `GET /attention` |
| `02-work-needs.png` | Work → Needs you, through `GET /work` |
| `03-renewal-space-summary.png` | **The Renewal Space**, summary view |
| `04-renewal-space-comparison.png` | After "Compare the terms" |
| `05-renewal-space-policy.png` | After "Show me the current policy" |
| `06-renewal-space-blocker.png` | After "What is outstanding?" |
| `07-claim-unchanged-flag-on.png` | A claim, flag on: the existing record page, unchanged |
| `08-mobile-renewal-space.png` | The Renewal Space at 390×844 |
| `09-mobile-today.png` | Today at 390×844 |
| `10-renewal-flag-off-rollback.png` | The same renewal with the flag off — the rollback |
| `11-space-scrolled-to-footer.png` | Scrolled to the footer, proving the Ask dock does not cover it |
| `20-prototype-today-{desktop,mobile}.png` | The prototype's Today |
| `21-prototype-renewal-{desktop,mobile}.png` | The prototype's renewal page |

## 4. Component-by-component mapping

| Prototype element | Registered component | Status |
|---|---|---|
| `.focus-card` (`next()`) | `RenewalReadiness` | Built, styled to match |
| "Insurer terms" panel | `InsurerResponseTracker` | Built |
| "Compare terms" view | `TermComparison` | Built, but only the facts actually on file — see §5 |
| "Prepared for you" tick list | folded into `RenewalReadiness` ("What is done, and what is not") | Built, as a disclosure |
| Draft summary (`draftSummary()`) | `DraftEmail` | Built |
| `source(...)` chip under a fact | the `Sources` element inside each block, plus `SourceEvidence` | Built |
| Activity modal | `ActivityFeed` | Built as a page block, not a modal |
| Step list | `Checklist` | Built |
| Client line / relationship links | `ClientHeader` | Built; the prototype's "4 policies / open claim / outstanding" links are not |
| Policy period line | `PolicyCard` | Built as a card |
| Context chip above the dock | `ContextChip` | **In the library, in no Space** |
| `☆ Pin`, `⋯` menu, `← Back` | `ActionMenu` | **Not built** |
| Report bars (`investigation`) | `Chart` | Not built — architecture Phase 12 |
| `.progress`, `.confidence` | — | **Deliberately never ported** (D-056; banned by Screen Map v1 Part 1) |

## 5. Prototype interactions still missing

1. **Acting from Today.** The prototype's per-row "Continue" / "Review". Ours needs the step's actions in `/attention`.
2. **The context chip on the dock.** Ask carries context and does not say so.
3. **A real term comparison.** Ours compares only what is recorded — one row, "Terms on file", per insurer. The prototype compares premium, excess and cover differences. Those are figures nobody has recorded yet: there is no quotes table (architecture Phase 9) and no money components (build spec Phase 3). The block says so in its own note rather than filling the table.
4. **Pin, the ⋯ menu, and a back link.**
5. **The keyboard shortcut.**
6. **The "ASAP noticed" observation strip** — detectors, architecture Phase 4.
7. **Quick actions on Today** — Add records and Connect email, which are import and mailbox connection.
8. **"Review client options"** — recorded client decisions, architecture Phase 9.

## 6. One defect found while comparing, and not fixed

**Every screen overflows horizontally by 11px at 390px wide.** Measured, not eyeballed: `document.documentElement.scrollWidth` is 401 against a 390 viewport on Today, on Work, on the Renewal Space and on a claim. The culprit is the profile control in the mobile bar — `div.ml-auto` → the profile `button`, right edge at 401.

It is **pre-existing and not caused by the Space**: it is identical with the flag off, and it is on Today and the claim page too. It also corrects `ASAP_CURRENT_BUILD_AUDIT.md`, which said there was no horizontal overflow at 390px — that was from looking at screenshots rather than measuring.

It is not one of the six defects this task named, so it has not been fixed. It belongs at the top of the next list.
