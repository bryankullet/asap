# Operator validation — hypotheses, thresholds and legal values

The Economic State Machine report labels every claim *observed fact*, *strong inference* or *hypothesis*, and says operator validation with several Kenyan brokerages is required before the model is treated as complete. This document keeps that distinction alive in the repository. Nothing here becomes a constant in code or SQL.

Handling classes:

- **CONFIG** — a per-organization value in `company_rules` with `source`, `effective_from`, `verified_at` (Architecture §22, D-027). ASAP ships the report's value as an *unverified proposal*.
- **MEASURE** — ASAP collects the measurement and proposes a value from the observed distribution; until then the field is empty and dependent figures render as estimates.
- **LABEL** — ASAP shows the figure with `basis: estimated` and a confidence band; never as a fact.
- **ASK** — a question for operator interviews; no system behaviour depends on it yet.

## 1. Legal and market values (observed facts today; laws change)

| Value | Report | Source | Handling | Used by |
| --- | --- | --- | --- | --- |
| Commission payment deadline after insurer receives premium | 30 days | S3 Insurance Act | CONFIG `commission_payment_deadline_days` | commission clock, `money.commission_aging` |
| Policy document to be issued when not supplied at inception | 14 days | S5 Market Conduct Guidelines 2022 | CONFIG `policy_document_clock_days` | `policy.document_overdue` |
| Withholding tax on resident broker commission | 5% | S8 KRA | CONFIG `wht_rate_percent` | M7 net commission, `commission.check_wht_evidence` |
| Commission caps by class (motor 10%, marine 17.5%, personal accident 20%, group life 8%, medical 10%, fire higher) | S4, S12 | Insurance Regulations Reg. 22, Eleventh Schedule | CONFIG `commission_cap_percent` per class; expected commission uses the *agreement rate*, capped | `commission.expected`, variance |
| Claims settlement reference after complete documents | 90 days | S15 Insurance Act s.203 | CONFIG `claim_settlement_reference_days` | claim clock |
| Broker licensing: paid-up capital, bank guarantee, PI minimum | KSh 1M / 3M / 10M | S7 IRA | CONFIG (informational; compliance calendar) | compliance detectors (Phase 13) |
| Premium before risk, subject to prescribed exceptions | rule | S3, S10 | CONFIG `premium_before_risk_exceptions` (list) | `money.check_payment_condition` |

## 2. Hypotheses about how brokerages actually work

| Hypothesis | Report section | Handling |
| --- | --- | --- |
| Conversion rate lead → qualified opportunity → paid policy | §20 Q1–2 | MEASURE (opportunities, decisions) |
| Staff hours per quote, placement, endorsement, claim, renewal | §20 Q3, Q5–6; §4.3 KSh 70k illustration | MEASURE via `effort_records`; LABEL contribution |
| Client types usually rejected as unprofitable | §20 Q4 | ASK; feeds `opportunity.qualify` defaults |
| Which insurers create the most correction and follow-up work | §20 Q7 | MEASURE (rework effort by insurer) |
| Which clients consume more service cost than commission | §20 Q8 | MEASURE + LABEL (`analysis.contribution`) |
| Average days from insurer premium receipt to commission cash | §20 Q9 | MEASURE (money chain M4 → M7) |
| Share of commission statements with differences | §20 Q10 | MEASURE (variance detector) |
| Commission older than 30 / 60 / 90 days | §20 Q11 | MEASURE (aging buckets against CONFIG deadline) |
| WHT certificates missing or wrong | §20 Q12 | MEASURE |
| Cancellations creating clawbacks | §20 Q13 | MEASURE (`commission_adjustments`) |
| Retention by class and account manager | §20 Q14 | MEASURE |
| When renewal work actually starts by class (the 45-day scenario is not a rule) | §20 Q15 | CONFIG `renewal_lead_time_days` per class (already an operating rule in §22) + MEASURE actual |
| Top reasons clients leave | §20 Q16 | ASK; loss reason captured by `renewal.record_client_choice` |
| Expected commission sitting in renewals with no client response or terms | §20 Q17 | MEASURE (Discover card) |
| How often client lists disagree with schedules | §20 Q18 | MEASURE (`document.detect_conflict`) |
| Share of policy documents later than the document clock | §20 Q19 | MEASURE |
| Active policies lacking written client instruction | §20 Q20 | MEASURE (compliance evidence detector) |
| Compliance failures that caused complaints or PI notifications | §20 Q21 | ASK |
| Whether Kenyan brokers charge separate client fees, and for what | §20 Q22 | ASK; affects revenue equation and disclosure copy |
| How commission is shared with agents, introducers, account executives | §20 Q23 | ASK; affects contribution |
| Capital tied in guarantees, deposits, receivables | §20 Q24 | ASK |
| Economics by segment (corporate, SME, retail, medical, life, specialist) | §2, §20 Q25 | ASK; medical and life need adjusted service-load defaults |
| "Acceptable" waiting time per state (client documents, insurer quotation, underwriting question, client choice, payment, confirmation, document, endorsement, claim document, assessor, statement) | §13 | CONFIG per waiting type, seeded empty; MEASURE distributions; Discover `waiting_duration` uses CONFIG when set, else the observed median |
| Service-load threshold that means "abnormal" | §9, §19 S7 | CONFIG per class, seeded empty; MEASURE; LABEL |
| Normal insurer response times | §13 | MEASURE per insurer |
| Economic leakage scores (impact, frequency, recoverability, visibility, time sensitivity) | §14 | LABEL as directional defaults for Discover `recoverability` and `severity`; replaced by measured values |
| Broker channel share and market size figures | §16 | informational only; not used by the product |

## 3. What ASAP does with an unverified value

- A `regulatory` rule without `verified_at` renders as "unconfirmed" wherever it drives a clock, a calculation or a card.
- A threshold with no configured or measured value disables the detector that depends on it and surfaces one Discover card per organization: "ASAP needs a value for X before it can watch Y."
- Contribution, service load and probability of loss always carry `basis` and a confidence band.
- Fixture tests in `docs/evaluation/SCENARIOS.md` must pass with different configured values, proving nothing is hardcoded.

## 4. Validation programme

Before Phase 7 (renewals slice) ships to a brokerage: interviews with at least three Kenyan brokerages covering §2 questions 1–4, 14–17, 22–23; confirmation of every §1 legal value against the current statute or guideline; and collection of one month of measured waiting times and effort for the pilot brokerage. Record outcomes in this document with dates and sources.
