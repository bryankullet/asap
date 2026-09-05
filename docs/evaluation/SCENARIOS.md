# Economic evaluation scenarios

The ten stress tests from the Economic State Machine report (§19), turned into end-to-end evaluation fixtures for routing, skills, detectors, Jobs and Spaces. Architecture v3.1 §39 adds these to the retrieval and routing evaluation sets as the **economic evaluation set**.

**Status.** Specification only. No fixture runs in Phase 1. Each scenario is tagged with the phase in which it first becomes runnable (§43). Expected state vectors use the dimension names in Architecture §3A; the eight-state summary is listed for the analyst, never shown to a broker.

**How a fixture is judged.**
1. *State computation is exact.* Given the fixture's records and evidence, the Economic State Service must produce the expected vector at each step. No tolerance; this is deterministic.
2. *Blockers and missing evidence match exactly.*
3. *Detectors fire as listed*, and no unlisted detector fires for the fixture's organization.
4. *Routing selects the expected skills* for each utterance (superset allowed only where marked ⊇).
5. *The Space renders the nine answers* (§25) with plain language and no internal state codes.
6. *The Job completes only when the completion evidence resolves.*

Legal and market values in these fixtures (commission deadline, document clock, WHT rate, class cap) come from the fixture organization's `company_rules`, seeded from the report's sources as unverified proposals (D-027). Fixtures must pass with different configured values.

---

## S1 · Normal successful motor renewal — Phase 7

Acme Ltd, motor fleet, renewal started 45 days before expiry. Vehicle list and claims history received; three insurers quote; client chooses; premium reaches insurer before inception; cover confirmed; schedule checked; commission arrives within the configured deadline.

| Step | Trigger | Expected vector (changed dimensions) | Blockers | Detectors | Skills | Space / Job |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | renewal lead time reached (schedule) | renewal: started; commitment: mandated; risk_information: incomplete | vehicle list, claims history | `renewals.approaching_without_terms` | `renewal.prepare`, `renewal.check_documents`, `document.check_missing` | Renewal Space; renewal Job created with transition_goal → cover: confirmed |
| 2 | client documents ingested | risk_information: market_ready | — | — | `document.extract`, `document.detect_conflict` (no conflict) | Job step done |
| 3 | submission sent | market: awaiting | insurer terms | — | `renewal.request_terms`, `quote.select_insurers` | Job waiting_external |
| 4 | three quotes received | market: terms_usable | — | — | `renewal.extract_terms`, `quote.check_comparability` (pass), `renewal.compare`, `renewal.explain_change` | Space morphs to comparison |
| 5 | client instruction email | client_decision: instructed; premium: selected → due | premium receipt | `money.premium_due_near_inception` | `renewal.record_client_choice`, `placement.prepare` | needs_you → approval to send instruction |
| 6 | receipt matched | premium: received_by_insurer; commission: due | cover confirmation | — | `money.match_payment`, `money.check_payment_condition`, `commission.expected` | Job waiting_external |
| 7 | cover confirmation | cover: confirmed | schedule | — | `placement.verify_cover_match` (match) | — |
| 8 | schedule delivered and validated | policy_evidence: complete; renewal: retained | — | — | `document.validate`, `policy.documents` | `unit.verify_transition` → economic_transitions; Job completed |
| 9 | statement + payment + WHT certificate | commission: paid → settled | — | — | `commission.reconcile`, `commission.check_wht_evidence` | Reconciliation Space resolves card |

Summary path: broker committed → market-ready → decision-ready → placed cover → active service → cash and renewal.
Utterances: "Renew Acme" → Renewal Space + Job; "What's stopping Acme's renewal?" → `unit.blockers`; "Has Acme paid?" → `money.check_payment_condition`.

## S2 · Highly profitable retained corporate account — Phase 12

Six policies, fourth renewal year, clean data, stable insurer, low claims, few corrections.

Expected: each unit reaches settled with `service_load: normal`; `analysis.contribution` returns a positive estimate with `basis: measured` where effort_records exist and `estimated` elsewhere; no exception detectors fire; the client-level Investigation Space shows acquisition cost amortised across periods. Judged on: contribution estimate carries confidence band and basis; no value presented as fact without measurement.

## S3 · Quote work is lost — Phase 7

Many hours on a tender; client uses the comparison to negotiate elsewhere.

Path: commitment pursuing → mandated; risk_information market_ready; market terms_usable; client_decision pending → **expired_terms**; renewal/commitment → lost. Detectors: `quote.validity_expiring` at the configured window, `opportunity.effort_without_conversion` (estimate). Skills: `quote.track_validity`, `quote.follow_up`, `quote.record_client_choice` (loss reason). Completion evidence: loss reason recorded; Job ends `completed` with outcome lost, contribution negative (sunk effort, `basis: estimated`). Utterance: "Which quotes are we likely to lose?" ⊇ `unit.blockers`, `analysis.production`.

## S4 · Client pays late — Phase 7

Client selects terms; premium does not reach the insurer before intended inception; client assumes cover started.

Vector at inception: client_decision instructed; premium **due**; cover **none**; exceptions [premium_failure]. Detector: `money.premium_due_near_inception` escalating to `money.premium_failed_at_inception`. Space copy (checked verbatim class, not wording): "Cover cannot safely start yet. Premium receipt has not been matched to this policy." Skills: `money.check_payment_condition`, `money.prepare_follow_up` (approval: external send). The Job must **not** reach completed; cover stays `none` until a receipt or a revised inception resolves. Negative test: a model narration claiming cover is active must be rejected by the validator (value not from database).

## S5 · Wrong vehicle value — Phase 7

Client spreadsheet KSh 3.8M; previous schedule KSh 4.2M; unresolved before placement.

Expected: `document.detect_conflict` sets risk_information **conflicting**; a `job_interrupt` with both sources and evidence refs; the vector may not reach market_ready until the interrupt resolves (deterministic rule). Detector: `risk.conflicting_exposure_near_renewal`. Negative test: an automation "mark market-ready" must not fire while the conflict is open. Completion evidence: resolved value with chosen source recorded in `economic_transitions.evidence_refs`.

## S6 · Fire policy document is late — Phase 7

Cover confirmed; insurer issues no schedule for three weeks.

Vector: cover confirmed; policy_evidence **overdue** once the configured document clock (seeded from the 14-day market-conduct guideline, D-027) passes. Detector: `policy.document_overdue`. Automation candidate fires: attention item + prepared insurer follow-up (approval: external send). The fixture must pass with the clock configured at 14 and at 21 days. Contribution effect: service cost accumulates (`basis: inferred` from follow-ups).

## S7 · Difficult medical account — Phase 12

Large commission; hundreds of member changes, pre-authorisations, complaints.

Vector: active_service open_requests continuously; service_load **abnormal** once effort exceeds the configured threshold relative to expected commission (threshold is a hypothesis; default from observed distribution, labelled). Detector: `service.load_abnormal`. Automation: `analysis.contribution` → Investigation Space ("why is this account unprofitable?"). Judged on: every figure labelled estimate; the Space names the measurement basis; no threshold hardcoded.

## S8 · Commission underpayment — Phase 11

Insurer receives premium; statement uses the wrong class or rate; unnoticed for four months.

Money chain: M4 received → M5 due → M6 stated with **variance** → dispute. Detectors: `money.commission_aging` (beyond the configured deadline), `money.commission_variance` (stated ≠ expected: premium × configured class rate). Skills: `commission.expected`, `commission.reconcile`, `commission.check_wht_evidence`. Completion evidence: corrected statement + payment matched + WHT certificate. Negative test: expected commission must be computed from the organization's configured rate, never a constant; changing the configured rate changes the variance.

## S9 · Claim delay damages renewal — Phase 12

Claim covered; police abstract and assessor report slow; client blames broker and moves the renewal.

Vector: active_service **open_claim** → blocked (external dependency); renewal **at_risk** (deterministic rule: open blocked claim within the renewal window); later **lost**. Detectors: `claims.no_movement_beyond_threshold`, `renewals.at_risk`. Skills: `claim.detect_blocker`, `claim.follow_up`, `renewal.assess_risk`. Judged on: renewal risk raised *before* expiry from the claim signal; contribution shows service cost without new revenue; loss reason recorded at closure.

## S10 · Urgent Time on Risk request — Phase 13

Short-period motor cover needed immediately; one detail missing.

Path: active_service → TOR service request; risk_information for the request **incomplete** (missing detail) → information hold → insurer confirmation → active. Skills: `service.create`, `service.classify`, `service.extract_request`, `service.check_requirements` (identifies the missing detail), `tor.prepare`, `service.track`, `service.review_response`. Negative test: `tor.prepare` may not prepare the insurer request while a required field is missing; the Space asks one question. Completion evidence: insurer confirmation matching the requested dates and vehicle.

---

## Fixture data

Fixtures are built on the two seed brokerages (`supabase/seed.sql`) so isolation tests and economic tests share identities. Each scenario adds its own records under Acme Insurance Brokers; Beta Risk Partners must show **no** detectors, Spaces or transitions from any scenario — every economic fixture doubles as a tenant-isolation check.
