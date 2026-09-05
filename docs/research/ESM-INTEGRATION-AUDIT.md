# Economic State Machine — integration audit

**Date.** 5 September 2026. **Inputs.** `ASAP-Kenyan-Insurance-Brokerages-Economic-State-Machine.pdf` (the report), `ASAP-Architecture-v3.0.md`, `docs/skill-map.md` (Intent & Skill Map), `CLAUDE.md`, `PHASE-1-WORK-ORDER.md`, `PHASE-1-SCHEMA.md`, `DECISIONS.md`, and the repository at commit `5d64ecb` (Phase 1 work items 1–4 complete).

**Outcome.** Documentation and design only. No code, no migrations. Phase 1 is unaffected (section O). The architecture becomes v3.1 (D-030). One decision is flagged for the operator before Phase 2 schema begins: the client-policy-year representation (D-029, section G).

---

## A. What the Economic State Machine changes

1. **A layer under the intelligence loop.** v3.0's loop starts at *user intent*. The report shows why the intent exists: an economic unit is somewhere in its lifecycle and something blocks it. The unified loop therefore starts at a *trigger* (intent, event, schedule or detector), identifies the economic unit, reconstructs its position, finds the blocker, and only then selects skills. It ends by *verifying evidence* and *confirming the transition*, not merely executing.
2. **A primary economic unit.** One client + one policy + one period of cover. Everything else (opportunity, quote request, endorsement, claim, premium item, commission receivable, renewal cycle, complaint) is a secondary unit attached to it.
3. **Economic position is multi-dimensional.** Not one status. Eleven linked dimensions (commitment, risk information, market response, client decision, premium, cover, policy evidence, active service, commission, renewal, risk), plus service load where measured.
4. **Evidence unlocks transitions.** Each transition has required facts, required evidence and a decision. A transition without its evidence is inferred, not proven.
5. **Money progresses separately from operations** (M0–M8). The biggest trapped-value gap is premium received → commission due → stated → paid and matched.
6. **Exceptions are the product's main job.** Fourteen exception loops; ASAP is most useful where the normal path breaks.
7. **Profitability is contribution per unit**, not premium or gross commission. Service load and rework can make a large account unprofitable.
8. **Management intelligence has a daily / weekly / monthly shape** and mostly asks where value is blocked, at risk, or missing.
9. **Evidence confidence travels with the research.** Observed fact, strong inference, hypothesis. Most numbers are hypotheses needing operator validation.

## B. What ASAP already gets right

The v3.0 architecture already has most of the machinery the report asks for; what it lacks is the *economic framing* that connects it.

| Report requirement | Already in v3.0 |
| --- | --- |
| The database owns status; AI recommends, never authors | §10 ownership rule, §24, §45 |
| Progress derived from steps | §25 `progress_percent`, `job_steps` |
| Evidence as first-class, resolvable to page + region, including record/email/calculation refs | §23 `evidence_refs` |
| Waiting on a third party as a state with `waiting_on` / `waiting_since` and escalation | §26, §36 |
| Deterministic, inspectable Discover ranking with `money_at_stake` already a factor | §27 scoring |
| Detector catalogue covering renewals, claims, money (commission variance, premium leakage), documents, work | §27 |
| Semantic events + idempotent consumers as the nervous system | §29 |
| Automations as TRIGGER + CONDITIONS + SKILLS + ACTIONS + APPROVAL + EXCEPTION HANDLING | §28 |
| `exceptions` table in the work engine; job failures raise exceptions | §8, §26 |
| Money and commission as data (`invoices`, `receipts`, `payments`, `commissions`, `commission_statements`, `commission_reconciliations`) with deterministic calculation refs | §8, §23 |
| Renewal cycles created from expiry + lead time | §8 |
| Interrupts for conflicting extractions (the vehicle-value scenario is literally §26's example) | §26 |
| Operating memory (`company_rules`) as the home for brokerage-configurable rules | §22 |
| Skills declare evidence, failure behaviour, approval, audit | §17 |
| Retrieval and routing evaluation sets as a release gate | §39 |
| Phase plan built one lifecycle at a time | §43 |

## C. What is missing

1. **No economic unit.** `policies` exist; a *period of cover* as the thing commission, claims, endorsements, documents and renewal attach to is implicit in dates. "What is the full economic story of this policy period?" is not answerable by a single anchor today.
2. **No economic context in the context envelope.** §33 carries entity, Space, selection; it does not carry position, blockers, value at stake, or missing evidence.
3. **No Economic State Service.** Nothing computes the state vector, available transitions, or blockers deterministically. Detectors approximate parts of it as independent queries.
4. **Jobs are not bound to a transition.** §10 `jobs` have `job_type`, `entity`, `status`; not *why the work matters economically* nor *what evidence proves it is done*.
5. **No transition log.** Verified transitions ("cover proven on date X with evidence Y") have no home other than `audit_log`, which is per-record, not per-unit-per-dimension.
6. **Money chain not reconstructable end to end.** Tables exist for the pieces; there is no defined projection from M0 possible premium to M8 settled, and no WHT evidence entity.
7. **Service load and contribution have no measurements.** Nothing records effort per unit; §32 analysis is about outcomes, not cost.
8. **Skill contracts lack economic purpose.** `skill_versions` has no notion of the states a skill applies to, the transition it serves, the blocker it resolves, or its money / retention / risk effect.
9. **Discover scoring is missing several deterministic inputs** the report names: expected commission, recoverability, professional/compliance risk, evidence completeness, service-cost deterioration, probability of loss.
10. **Kenyan legal and market values are not modelled** anywhere: 30-day commission deadline, 14-day policy document rule, 5% WHT, class commission caps, 90-day claim settlement reference.
11. **Exceptions are not enumerated** against the report's fourteen loops; several (bad-fit opportunity, quote expiry, wrong cover confirmation, cancellation clawback, complaint / professional error) have no detector or skill path.
12. **No evaluation fixtures** for end-to-end economic scenarios; §39's sets cover retrieval and routing only.
13. **Skill gaps** (section F): opportunity qualification, quote comparability and validity, cover-versus-instruction verification, payment-condition confirmation, policy evidence timeliness, service-load measurement, commission aging / WHT evidence, contribution per unit, economic closure.

## D. What is contradictory

Few outright contradictions; mostly under-specification.

1. **§8 "Every policy creates a renewal cycle"** treats the policy as the continuing thing and the renewal as a cycle *of* it. The report's unit is the *period*. Both are right; the model must say which row is the economic unit. Resolved by D-029.
2. **§27 scoring formula is multiplicative** (`severity × urgency × ownership × money_at_stake × staleness`). A zero in any factor zeroes the card. Money-at-stake is unknown for many units (bad-fit opportunity, compliance evidence). The formula needs to be a weighted composition with declared defaults for unknown inputs, or the report's leakage list can never surface.
3. **§24 work types** are activity names (Quotation, Placement, Renewal). The report's frame is *transition* names. Not contradictory, but the work item needs an economic reason or Discover cannot explain why it matters.
4. **§10 `spaces.state`** (`active | waiting | needs_you | completed`) is a *workflow* state. Nothing wrong, but it must not be confused with economic position; a Space can be `active` while the unit is economically blocked. Documented explicitly in v3.1.
5. **The report's §18 "eight irreducible states" read like a status enum.** The report itself says economic state is a vector (§1, §4). v3.1 states that the eight are a management summary derived from the vector and never stored as a column or shown in UI (D-028).
6. **`permissions.object_type` list** (Phase 1) has no `transition`/`unit` object. Not a contradiction: permissions attach to the underlying business objects, and the state service reads under RLS. No change.

## E. What should change in architecture (v3.1)

1. **Add the hierarchy of truth** as the document's frame: Economic model → Intelligence model → Experience model → Execution model → Evidence + audit.
2. **Add §3A — Economic operating model**: the unified loop (trigger → unit → position → blocker → outcome → skills → retrieval → reasoning → Space → Job → action → approval → execute → verify evidence → confirm transition → update Discover/money/risk → audit); the economic unit and secondary units; the eleven dimensions; the eight-state management view; the rule that state is computed, never authored or invented.
3. **Add the Economic State Service** (deterministic; SQL projections + a small TypeScript resolver in `apps/api`, reused by workers): inputs, outputs (state vector, blocked/available transitions, value at stake, next transition candidates, missing evidence), where it is called (context envelope §33, detectors §27, job binding §26, automation conditions §28, Space recipes §25), and what it may never do.
4. **Extend the context envelope (§33)** with `economic_position` (vector, blockers, value_at_stake, missing_evidence, clocks).
5. **Bind Jobs to transitions (§26)** with a `transition_goal` and `completion_requirements` / `completion_evidence_refs`; introduce an `economic_transitions` log (verified transitions per unit per dimension, with evidence).
6. **Spaces (§25)**: the nine questions a Space answers; plain-language rule; enrich existing recipes rather than add new ones (only the *Investigation* recipe gains an economic variant).
7. **Discover (§27)**: reframe as the economic attention engine; replace the multiplicative formula with a declared weighted composition and a documented input list; add value-blocked / deteriorating / at-risk / trapped / ready-to-unlock signal classes.
8. **Automations (§28)**: add the state-protecting automation candidates and the rule that "mark market-ready" style transitions are deterministic checks, not model judgements.
9. **Evidence (§23)**: add the evidence → transition map and the principle that a transition is verified only when its required evidence resolves.
10. **Money (§8 + new §8A)**: the M0–M8 chain as a defined projection; `commission_receivables`, `wht_certificates` and `commission_adjustments` as future tables; the trapped-value gap as a named detector.
11. **Profitability (new §8B)**: contribution per unit as a progressively-measured estimate; `effort_records` as the future measurement source; all values labelled estimate until operator-validated.
12. **Exceptions (new §24A)**: the fourteen loops mapped to signal → consequence → evidence → recovery → skills → Space → Job → resolution evidence.
13. **Management intelligence (§32)**: daily / weekly / monthly questions as parameterised analysis feeding Discover, Report and Investigation Spaces.
14. **Regulatory and market values (§22)**: `company_rules` gains a `regulatory` class with `value`, `source`, `effective_from`, `verified_at`; ASAP ships defaults from the report's sources as *proposals*, never constants.
15. **Evaluation (§39)**: add the ten scenarios as end-to-end evaluation fixtures.
16. **Phases (§43)**: annotate Phase 2 (policy periods decision), Phase 4 (state service skeleton, jobs transition binding), Phase 6 (transition verification), Phase 7 (first full state vector for the renewal slice), Phase 11 (money chain, WHT), Phase 12 (contribution, service load), Phase 13 (leakage patterns).

## F. What should change in the Intent & Skill Map

Keep all ~150 skills. Add economic metadata to the skill contract (section E.3 of `skill-map.md` addendum): applicable states, transition served, blockers resolved, required and success evidence, money / service-cost / retention / risk effect, failure consequence, detector and automation opportunities. Stored as columns on `skill_versions` in Phase 5, not now.

Gaps, and whether an existing skill covers them:

| Capability the report needs | Existing skill that covers it | Gap → proposed skill |
| --- | --- | --- |
| Is this opportunity worth pursuing? | none (`opportunity.create` records, does not judge) | **`opportunity.qualify`** |
| Information completeness before market | `quote.check_completeness`, `renewal.check_documents`, `document.check_missing` | covered |
| Conflicting risk information | `document.detect_conflict` | covered; extend contract to structured facts (list vs schedule) |
| Insurer-response delays | `quote.track_responses`, `renewal.track_terms`, `quote.follow_up` | covered |
| Quote comparability (exclusions, excesses, subjectivities present) | `quote.compare_cover` compares; nothing *checks comparability* | **`quote.check_comparability`** |
| Quote expiry | none | **`quote.track_validity`** |
| Client-decision delays | `quote.follow_up`, `renewal.follow_up` | covered; detector needed |
| Premium / payment confirmation as a cover condition | `money.match_payment`, `money.record_payment` | **`money.check_payment_condition`** (is the legal payment condition met for this unit?) |
| Cover confirmation matches client instruction | `placement.confirm` records; nothing compares | **`placement.verify_cover_match`** |
| Late or wrong policy evidence | `policy.documents`, `document.validate` | covered for *wrong*; **detector** for *late* (14-day clock) |
| Service-load measurement | `analysis.workload` (people), nothing per unit | **`analysis.service_load`** |
| Claims-support burden | `claim.timeline`, `analysis.claims` | covered for status; burden comes from `analysis.service_load` |
| Commission expectation | `commission.expected` | covered |
| Commission aging | `commission.outstanding` | extend contract with aging buckets (30/60/90); no new skill |
| Commission variance | `commission.reconcile` | covered |
| WHT / reconciliation evidence | none | **`commission.check_wht_evidence`** |
| Renewal-risk detection | `renewal.assess_risk` | covered |
| Profitability by unit | none | **`analysis.contribution`** |
| Exception detection | `claim.detect_blocker`, `work.blocked`, `email.detect_unhandled` | partial → **`unit.*` family** below |
| Trapped-value detection | none | `unit.blockers` + detectors |
| Economic closure | none | **`unit.close_check`** |

New family **`unit.*`** (the economic unit): `unit.position` (reconstruct the story and state vector), `unit.blockers` (what prevents the next transition, with missing evidence), `unit.next_transition` (candidates with value at stake), `unit.close_check` (can this policy-year close without hidden exposure). These are the skill surface of the Economic State Service; they compose existing skills and never author state.

Total new skills: 10 plus one family of 4. Everything else is metadata on existing skills.

## G. What should eventually change in schema

Nothing in Phase 1. Recommendations for later phases, in order of certainty:

1. **Client-policy-year (Phase 2, needs operator answer — D-029).** Recommendation: **B, a thin first-class `policy_periods` table**, introduced with `policies` in Phase 2. Reasoning below.
2. **Phase 4:** `jobs.transition_goal jsonb`, `jobs.completion_requirements jsonb`, `jobs.completion_evidence_refs jsonb`; `economic_transitions` (unit_ref, dimension, from_value, to_value, verified_at, evidence_refs, job_id, actor, automation_run_id); `work_items.economic_reason jsonb`.
3. **Phase 5:** `skill_versions` economic metadata columns (section F).
4. **Phase 6/7:** `client_instructions` as an explicit evidence entity if `client_decisions` proves insufficient; `cover_confirmations` (insurer confirmation compared to instruction).
5. **Phase 11:** `commission_receivables` (M5), `wht_certificates` (M7), `commission_adjustments` (M8: clawbacks, refunds), and the money-chain projection.
6. **Phase 12:** `effort_records` (user, unit, activity class, minutes, source: timer | estimate | inferred), and `regulatory` rows in `company_rules` with source references.
7. **Never:** an `economic_state` column or enum on any table (D-028).

### The client-policy-year recommendation (D-029, awaiting answer)

Options considered:

- **A. Existing model: `policies` + dates.** A renewal either creates a new `policies` row (losing the continuing client-policy identity that loss ratio and retention need) or extends the same row (losing the period as an anchor for commission, claims, endorsements, documents). Answering the economic story requires date-range joins that break on backdated endorsements, mid-term TOR, short-period covers and split instalments.
- **B. Thin first-class `policy_periods`.** One row per client-policy-year: `policy_id`, `sequence`, `inception_at`, `expiry_at`, `predecessor_period_id`, `origin` (new | renewal | replacement | tor), `outcome` (in_force | renewed | lapsed | cancelled | replaced — a *factual* outcome, not an economic state), `deleted_at`. Commission, claims, endorsements, documents, premium items and renewal cycles reference the period. The **economic state vector is a projection over the period**, not stored on it.
- **C. A view over existing records.** Cheapest now, but every downstream table would still need to know which period a claim or commission belongs to, so the view would be reconstructing a fact that should have been recorded at write time.

**Recommendation: B.** It is the smallest change that makes the unit real without turning it into a status. It matches the report's stress test that all ten scenarios fit one unit, and it keeps `policies` as the continuing relationship. Cost: one thin table and one FK on each Phase 2+ table that today would reference `policies`. This must be decided before Phase 2 schema begins, because retrofitting the FK later is a data migration across every business table.

## H. What should change in Spaces

- Every recipe answers the nine questions (what are we trying to accomplish; where is the unit; what prevents movement; what evidence is missing; who are we waiting on; what value is at stake; what risk if nothing happens; most useful next action; what proof resolves it) — via existing components: `Checklist`, `WaitingCard`, `ExceptionCard`, `Metric`, `Alert`, `SourceEvidence`, `RecommendationCard`.
- Plain language only. The eight states and S/M codes never appear in copy, tooltips or alt text (D-028). Copy comes from a per-dimension phrasebook in the recipe, not from the model.
- No new recipes except an economic variant of *Investigation* ("why is this account unprofitable?").
- `spaces.state` remains workflow state. The economic position is a block, not the Space's state.

## I. What should change in Jobs

- A Job binds to a transition goal: unit, dimension, from-snapshot, target, blockers, completion requirements. Progress is still step-derived; *completion* additionally requires the completion evidence to resolve (§23), otherwise the Job ends `needs_you`, never `completed`.
- Verification is a step (`unit.verify_transition`), which writes `economic_transitions` and emits `transition.confirmed`.
- Work items gain an `economic_reason` so a human to-do carries the "why" in plain language.

## J. What should change in Discover

- Reframed as the economic attention engine: signal classes *blocked, deteriorating, at risk, waiting, missing evidence, excessive effort, likely to be lost, ready to unlock*.
- Scoring: weighted composition of declared deterministic inputs (severity, deadline urgency, waiting duration, ownership, expected commission, value at risk, renewal value, recoverability, compliance risk, service-cost deterioration, evidence completeness, loss probability where measured), each with a default when unknown, weights per organization and inspectable on the card. The model may write the sentence; never the order.
- Detector catalogue gains the report's leakage list: commission aging beyond the configured deadline, premium paid but unlinked, client instruction missing, quote validity expiring, cover confirmation mismatch, policy document beyond the configured clock, endorsement past effective date, cancellation clawback unmatched, service load abnormal, renewal started late, compliance evidence missing, bad-fit pursuit consuming effort.

## K. What should change in Automations

Add the candidates in the report and the brief as **default automations shipped paused** (§7 already ships defaults paused): incomplete risk information near expiry; all risk evidence complete → deterministic market-ready + submission work; quote validity approaching; premium receipt → match, compute expected commission, wait for confirmation; cover confirmation → compare to instruction; policy document overdue; commission due beyond deadline → reconcile; abnormal service load → contribution investigation; renewal lead time → readiness + work. Rule: a transition an automation "marks" is a deterministic check by the state service, never a model judgement. Approval rules unchanged.

## L. What should change in evaluation / testing

- New `docs/evaluation/SCENARIOS.md`: the ten stress tests as end-to-end fixtures with expected state vectors at each step, expected blockers, expected detectors, expected skills and expected Spaces. Phase-tagged; none run in Phase 1.
- §39 adds an *economic evaluation set* to the retrieval and routing sets: for each fixture, the computed state vector and blockers must match the expected ones exactly (deterministic), and the router must select the expected skills.
- Phase 5 routing set gains utterances phrased economically ("what's stopping Acme from starting?", "who owes us commission?").

## M. What should NOT change

- The intelligence loop and the product principle: "tell ASAP what you need done". Intent stays the human interaction model.
- Generative UI contract, component registry, validator, no-model-values rule, versioned components.
- Database-owned status and progress; deterministic Discover ranking; approval engine defaults; §45 rules.
- The permanent shell and the refusal to build module navigation.
- All Phase 1 migrations, RLS design, worker role, audit design, event bus, seed.
- The existing skill catalogue and families.
- The phase order. The economic layer arrives with the phases that already own its parts.

## N. Operator-validation hypotheses (not facts)

Everything below is a hypothesis or strong inference in the report and is **configurable, measured, or labelled**, never hardcoded. Full list in `docs/research/OPERATOR-VALIDATION.md`.

- Conversion rates lead → qualified → paid.
- Staff hours per quote, placement, endorsement, claim, renewal; the KSh 70,000 cost illustration.
- Average days premium receipt → commission cash; share of statements with differences; commission aging distribution.
- Retention by class and account manager; when renewal work "should" start by class (45 days is the scenario, not a rule).
- Normal insurer response times; "acceptable" waiting times per state.
- Service-load thresholds that mean "abnormal".
- Whether Kenyan brokers charge separate fees and how commission is shared.
- The leakage scores (impact / frequency / recoverability / visibility / time sensitivity) — directional only.

**Legal and market values** (observed facts today, but laws change): 30-day commission payment, 14-day policy document, 5% WHT, class commission caps, 90-day claims reference, licensing capital and guarantee amounts. Per-organization configurable with a source reference and a verified-at date (D-027).

## O. Whether any current Phase 1 work is affected

**No.** Checked table by table:

- `organizations.settings` is already the home for brokerage configuration; regulatory values will live in `company_rules` (Phase 2+) with `settings` untouched.
- `audit_log.evidence` and `events` already carry what transition verification will need.
- `permissions` object types are business objects; the state service reads under RLS as the user or worker; no new permission needed now.
- `roles` / send_external matrix is unaffected.
- No Phase 1 migration is wrong under its contract. Nothing is rewritten.

Phase 1 exit review gains one item: the D-029 answer must exist before Phase 2 schema work starts.

---

## File-by-file change plan (documentation only)

| File | Action | Why |
| --- | --- | --- |
| `docs/ASAP-Architecture-v3.0.md` → `docs/ASAP-Architecture-v3.1.md` | rename; add "Changes from 3.0", hierarchy of truth, §3A economic operating model, §8A money chain, §8B contribution, §24A exceptions, §33/§26/§25/§27/§28/§23/§22/§32/§39/§43 additions | one authoritative architecture; filename carries version by repo convention (D-030) |
| `docs/skill-map.md` | append "Economic purpose addendum": contract metadata, gap table, `unit.*` family, transition coverage map | Intent & Skill Map connects to the economic model |
| `docs/research/ASAP-Kenyan-…-Economic-State-Machine.pdf` + `economic-state-machine.md` | add | the source and its greppable text |
| `docs/research/ESM-INTEGRATION-AUDIT.md` | add (this file) | the audit itself |
| `docs/research/OPERATOR-VALIDATION.md` | add | hypotheses, thresholds, legal values, and how each is handled |
| `docs/evaluation/SCENARIOS.md` | add | ten stress tests as evaluation fixtures |
| `docs/DECISIONS.md` | add D-026 (denied-audit gap), D-027 (regulatory values configurable), D-028 (eight states internal only), D-029 (client-policy-year, pending), D-030 (v3.1 rename), D-031 (hosted project unreachable from the build container) | decisions and known limitations |
| `CLAUDE.md` | reference v3.1; add the hierarchy of truth, the economic-layer rules, the research folder | working instructions match the model |
| `docs/PHASE-1-WORK-ORDER.md` | exit review: add the D-029 gate | phase discipline |
| `README.md` | architecture reference | link hygiene |
| `docs/PHASE-1-SCHEMA.md` | no change | Phase 1 schema is correct under its contract |
| `supabase/`, `apps/`, `packages/` | no change | documentation-only exercise |
