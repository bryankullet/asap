# ASAP Insurance Intent & Skill Map

Text extracted from ASAP_Insurance_Intent__Skill_Map.pdf. The PDF is the source; this file exists so the map is greppable in the repo.

```text
ASAP Insurance Intent & Skill Map
CORE INTERACTION MODEL
User intent ↓ ASAP identifies business context ↓ Selects one or more insurance skills ↓ Retrieves relevant records, 
documents and email ↓ Generates the right workspace ↓ Prepares recommended actions ↓ Human approves where 
required ↓ ASAP executes + records evidence
ASAP does not need to predict every sentence.
It needs to understand a finite set of insurance intents and skills.
UNIVERSAL INTENT TYPES
Find — Locate a client, policy, claim, email, document, payment Understand — Explain status, cover, history, delay or 
problem Prioritize — Tell me what needs attention Create — Create client, opportunity, claim, servicing request 
Prepare — Prepare quote, renewal, email, report, submission Compare — Compare insurers, premiums, cover or 
versions Check — Verify completeness, requirements, status or discrepancies Follow up — Prepare or manage 
communication Update — Change internal records or workflow state Assign — Give work to someone Approve — 
Confirm prepared action Analyze — Surface trends, risks, performance or financial insights Automate — Create 
recurring or event-driven rules
CLIENT
Typical requests: - Find Acme. - Show me everything about this client. - What policies does Acme have? - What are we 
currently doing for them? - Add this client. - Who manages this account?
Skills: client.find client.create client.update client.summary client.relationship_history client.contacts client.activity 
client.assign_owner client.list_policies client.list_claims client.list_opportunities client.money_summary
Generated UI: Client Summary Space.
OPPORTUNITY / QUOTE
Typical requests: - Get this quote ready. - Create an opportunity from this email. - Who have we approached? - Which 
insurers responded? - Compare these quotations. - What's still missing? - Prepare the client presentation.
Skills: opportunity.create opportunity.detect_from_email quote.prepare quote.extract_requirements 
quote.check_completeness quote.select_insurers quote.prepare_request quote.track_responses quote.extract_terms 
quote.compare quote.compare_cover quote.follow_up quote.prepare_client_options quote.record_client_choice
Generated UI: Quote Workspace / Comparison Space.
PLACEMENT / UNDERWRITING
Typical requests: - The client chose Britam. What now? - Prepare placement. - What does underwriting still need? - 
Have we received confirmation? - What's blocking issuance?
Skills: placement.prepare placement.check_requirements placement.prepare_submission 
underwriting.track_requirements underwriting.record_terms underwriting.resolve_queries placement.confirm 
placement.track_policy_issuance
Generated UI: Placement Progress Space.
POLICY
Typical requests: - Show me this policy. - What is Acme covered for? - When does it expire? - Find the schedule. - Is 
this vehicle covered? - What changed from last year?


Skills: policy.find policy.summary policy.coverage policy.schedule policy.documents policy.check_item 
policy.compare_versions policy.history policy.expiry policy.parties
Generated UI: Policy Space.
POLICY SERVICING
Includes endorsements, TOR, certificates and amendments.
Typical requests: - Add this vehicle. - Remove this vehicle. - Transfer ownership. - Prepare TOR. - Get a certificate. - 
Change the insured value. - What's happening with this endorsement?
Skills: service.create service.classify service.extract_request service.check_requirements 
service.prepare_insurer_request service.track service.follow_up service.review_response service.update_policy 
service.complete
tor.prepare endorsement.prepare certificate.request
Generated UI: Service Request Space.
CLAIMS
Typical requests: - Register this claim. - What's happening with Jane's claim? - What documents are missing? - Why 
hasn't this moved? - What did the insurer ask for? - Prepare a follow-up. - Which claims need attention?
Skills: claim.create claim.detect_from_email claim.extract_incident claim.find_policy claim.check_coverage 
claim.check_documents claim.timeline claim.status claim.detect_blocker claim.prepare_submission claim.track 
claim.follow_up claim.record_response claim.settlement_summary claim.close
Generated UI: Claim Space / Claim Timeline.
RENEWALS
Typical requests: - Renew Acme. - What's expiring next month? - Which renewals are at risk? - Have we received 
terms? - Compare renewal terms. - Why did premium increase? - Prepare recommendation for the client.
Skills: renewal.find renewal.list_upcoming renewal.assess_risk renewal.prepare renewal.check_documents 
renewal.request_terms renewal.track_terms renewal.extract_terms renewal.compare renewal.explain_change 
renewal.follow_up renewal.prepare_recommendation renewal.record_client_choice renewal.prepare_placement 
renewal.complete
Generated UI: Renewal Space.
MONEY
Typical requests: - Who owes us money? - What does Acme owe? - What's overdue? - Prepare reminders. - Has this 
premium been paid? - Reconcile this payment. - What commission are we owed?
Skills: money.client_balance money.outstanding money.overdue money.prepare_follow_up money.record_payment 
money.match_payment money.reconcile money.insurer_balance
commission.expected commission.received commission.reconcile commission.outstanding
Generated UI: Money / Reconciliation Space.
DOCUMENTS
Typical requests: - Read this. - What is this document? - Extract the policy details. - Compare these two schedules. - 
What documents are missing? - Find the certificate.
Skills: document.classify document.extract document.summarize document.find document.compare document.validate 
document.link_to_record document.check_missing document.detect_conflict
Generated UI: Document Review Space.


EMAIL AND COMMUNICATION
Typical requests: - Find CIC's last email. - Summarize this thread. - Draft a reply. - Follow up the insurer. - Attach this 
response to the claim. - What emails haven't been dealt with?
Skills: email.find email.thread_summary email.classify email.identify_client email.identify_policy 
email.identify_claim email.identify_quote email.extract_action email.prepare_reply email.prepare_follow_up 
email.link_to_record email.detect_unhandled
External messages remain human-approved unless the brokerage explicitly configures otherwise.
Generated UI: Communication Space.
WORK
Typical requests: - What needs doing? - What's urgent? - What is James waiting on? - What is stuck? - What did ASAP 
prepare? - Assign this to Grace.
Skills: work.today work.prioritize work.waiting work.blocked work.overdue work.by_user work.by_client work.assign 
work.reassign work.complete work.explain
Generated UI: Work Space.
SEARCH / ASK THE BROKERAGE
Typical requests: - Find anything about Acme. - When did we last speak to CIC about this? - Which policies contain 
this exclusion? - Who insured this risk before? - Show me everything connected to this claim.
Skills: search.global search.semantic search.records search.documents search.email search.relationships 
search.timeline
Generated UI: Search Results Space based on object type.
REPORTS / ANALYSIS
Typical requests: - How are renewals performing? - Which insurers take longest to respond? - Show production by 
account manager. - Which clients have the most claims? - What's our outstanding premium? - Why did revenue fall?
Skills: analysis.production analysis.renewals analysis.claims analysis.insurers analysis.clients analysis.money 
analysis.commission analysis.workload analysis.performance analysis.explain_change
Generated UI: Generated report, chart, table or investigation Space.
TEAM / MANAGEMENT
Typical requests: - What is Grace working on? - Who is overloaded? - Assign these renewals. - What approvals are 
waiting for me? - What work is overdue?
Skills: team.workload team.performance team.assign team.reassign team.approvals team.overdue team.activity
Generated UI: Team Operations Space.
AUTOMATIONS
Users should be able to describe automations naturally.
Examples: - When a policy is 30 days from expiry, prepare the renewal. - When an insurer sends quotation terms, 
update the quote and notify the account manager. - When a client emails a claim notification, create a draft claim. - 
Every Monday show me renewals without terms.
Automation model: TRIGGER + CONDITIONS + ASAP SKILLS + ACTION + APPROVAL RULE + EXCEPTION 
HANDLING
Skills: automation.create automation.explain automation.edit automation.pause automation.resume automation.delete 
automation.test automation.history


AUTOMATION TRIGGERS
Email received Document uploaded Policy approaching expiry Quote received Claim created Claim status changed 
Payment received Invoice overdue Record changed Work item overdue Date/time reached User action
AUTOMATION ACTIONS
Create work Assign work Prepare email Prepare document Extract information Update internal record Check 
requirements Compare information Run analysis Generate report Create notification Request approval Flag exception 
Start workflow
EVERY SKILL MUST DEFINE
Skill name What it does Required context Optional context Data sources Allowed AI actions Restricted actions 
Generated UI Available user actions Approval requirements Evidence / sources Audit trail Failure / missing-data 
behaviour
CORE GENERATED SPACES
Client Space Quote Space Quote Comparison Space Placement Space Policy Space Servicing Space Claim Space 
Renewal Space Money Space Reconciliation Space Document Space Communication Space Work Space Search Space 
Report Space Team Space Automation Space
These are recipes, not fixed screens.
ASAP chooses and composes the appropriate components depending on the user's intent.
FINAL PRODUCT PRINCIPLE
DO NOT DESIGN: Insurance module → submenu → record → form → action
DESIGN: User intent → insurance skill → relevant business context → generated workspace → prepared action → 
approval → execution
The legacy ASAP determines what insurance work is possible.
The Intent & Skill Map determines how the AI understands what the user wants.
The Generative UI layer determines what they see next.

```

---

# Economic purpose addendum (Architecture v3.1)

The map above says what users want and what ASAP can do. The Economic State Machine (`docs/research/ASAP-Kenyan-Insurance-Brokerages-Economic-State-Machine.pdf`) says *why the work matters*: an economic unit — one client, one policy, one period of cover — is somewhere in its lifecycle and something blocks it. This addendum connects the two. Audit and reasoning: `docs/research/ESM-INTEGRATION-AUDIT.md` §F.

## 1. Skill contract extension

Every skill (existing and new) gains an economic block in its contract (`skill_versions`, Phase 5 — Architecture §17):

```text
economic_unit            client_policy_year | client | opportunity | quote_request | service_request |
                         claim | premium_item | commission_receivable | renewal_cycle | portfolio
applicable_states        which dimension values make this skill relevant
transition_served        dimension: from → to           (may be none for pure read skills)
blockers_resolved        missing_evidence | waiting_party | conflict | deadline | decision
required_evidence        what must exist before the skill can do its job
success_evidence         what proves it worked           (feeds Job completion, §26)
effects                  money · service_cost · retention · compliance_risk   (+ / − / 0, with basis)
failure_consequence      value lost if the skill does not run
detector_opportunities   §27 detectors that should invoke it
automation_opportunities §28 automation candidates it belongs in
```

This is metadata about skills, not a change to how they execute. A read-only skill such as `policy.expiry` has `transition_served: none` and still declares its unit and applicable states.

## 2. New skills (genuine gaps only)

| Skill | Family | Transition or blocker | Why no existing skill covers it |
| --- | --- | --- | --- |
| `opportunity.qualify` | opportunity | commitment: pursuing → mandated, or → declined | `opportunity.create` records an opportunity; nothing judges whether expected commission justifies the service need and risk class |
| `quote.check_comparability` | quote | market: terms_received → terms_usable | `quote.compare_cover` compares; nothing checks that exclusions, excesses, subjectivities and validity are present so a comparison is safe |
| `quote.track_validity` | quote | client_decision: pending → instructed before terms expire | quote expiry has no owner; `quote.track_responses` tracks insurers, not the clock |
| `placement.verify_cover_match` | placement | cover: confirmed vs confirmed_mismatch | `placement.confirm` records confirmation; nothing compares it field by field to the client instruction |
| `money.check_payment_condition` | money | premium: due → received_by_insurer (cover may start) | `money.match_payment` matches receipts; the *legal payment condition for this unit* (receipt, permitted guarantee, deposit, exception) is a distinct question |
| `commission.check_wht_evidence` | commission | commission: paid → settled | no skill knows about withholding-tax certificates |
| `analysis.service_load` | analysis | service_load (measurement) | `analysis.workload` is people-centred; this is effort per unit |
| `analysis.contribution` | analysis | contribution estimate per unit | no profitability skill exists |
| `unit.position` | unit | — (reads the state vector and story) | the economic story of a period spans every family |
| `unit.blockers` | unit | — (what prevents the next transition) | as above |
| `unit.next_transition` | unit | — (candidates with value at stake) | as above |
| `unit.close_check` | unit | → economic closure | nothing asks "can this policy-year close without hidden exposure?" |

Contract extensions without new skills: `commission.outstanding` gains aging buckets (30/60/90 days against the configured deadline); `document.detect_conflict` covers structured facts (client list vs previous schedule), not only documents; `renewal.assess_risk` consumes the state vector.

The `unit.*` family is the skill surface of the Economic State Service (Architecture §3B). It composes existing skills, reads computed state, and never authors state.

## 3. Transition coverage map

Which skills serve each transition of the primary path. All existing unless marked **new**.

| Transition | Skills |
| --- | --- |
| Possible business → broker committed | `opportunity.detect_from_email`, `client.find`, **`opportunity.qualify`**, `opportunity.create` |
| Broker committed → market-ready risk | `quote.extract_requirements`, `quote.check_completeness`, `renewal.check_documents`, `document.check_missing`, `document.detect_conflict`, `document.extract` |
| Market-ready risk → decision-ready options | `quote.select_insurers`, `quote.prepare_request`, `quote.track_responses`, `quote.extract_terms`, **`quote.check_comparability`**, `quote.compare`, `quote.compare_cover`, `quote.prepare_client_options`, `renewal.request_terms`, `renewal.track_terms`, `renewal.extract_terms`, `renewal.compare`, `renewal.explain_change`, `renewal.prepare_recommendation` |
| Decision-ready options → placed cover | `quote.record_client_choice`, `renewal.record_client_choice`, **`quote.track_validity`**, `placement.prepare`, `placement.check_requirements`, `placement.prepare_submission`, `underwriting.track_requirements`, `underwriting.record_terms`, `underwriting.resolve_queries`, **`money.check_payment_condition`**, `money.record_payment`, `money.match_payment`, `placement.confirm`, **`placement.verify_cover_match`**, `placement.track_policy_issuance`, `policy.documents`, `document.validate` |
| Placed cover → active service | `service.*`, `tor.prepare`, `endorsement.prepare`, `certificate.request`, `claim.*`, `email.*`, `work.*` |
| Active service → cash and renewal | `commission.expected`, `commission.received`, `commission.reconcile`, `commission.outstanding` (aging), **`commission.check_wht_evidence`**, `money.reconcile`, `money.insurer_balance`, `renewal.find`, `renewal.list_upcoming`, `renewal.assess_risk`, `renewal.prepare`, `renewal.follow_up`, `renewal.complete` |
| Cash and renewal → economic closure | **`unit.close_check`**, `money.reconcile`, `commission.reconcile`, `document.check_missing` |
| Cross-cutting | **`unit.position`**, **`unit.blockers`**, **`unit.next_transition`**, **`analysis.service_load`**, **`analysis.contribution`**, `analysis.*`, `search.*`, `automation.*` |

Exception loops and the skills that recover them are in Architecture §24A.

## 4. Language rule

Skill names, detector keys and dimension values are internal identifiers. The eight economic states and the S0–S13 / M0–M8 codes never appear in UI copy, tooltips or alt text (D-028). Every Space recipe carries plain-language phrasing for the dimension values it shows.
