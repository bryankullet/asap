# Kenyan Insurance Brokerages — Economic State Machine (extracted text)

Text extracted from `ASAP-Kenyan-Insurance-Brokerages-Economic-State-Machine.pdf` (5 September 2026) so it is greppable in the repo. The PDF is the source. Page markers are preserved.

Evidence labels used by the report: **observed fact**, **strong inference**, **hypothesis**. Every number in it that is a hypothesis is listed in `docs/research/OPERATOR-VALIDATION.md`; every legal or market value is a per-organization configurable in ASAP, never a constant (D-027).

```text
<<PAGE 1>>
ECONOMIC MODEL
Kenyan Insurance
Brokerages
Economic State Machine
One simple question How does broker work turn into cover, commission, cash and a retained client?
Primary unit: one client-policy-year - one policy placed or renewed for one client for one period of cover.
Prepared for ASAP | 5 September 2026


<<PAGE 2>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
2
Reading the evidence
• Observed fact means a law, regulator, industry report, court record, or other reliable source directly supports the point.
• Strong inference means the conclusion follows from good evidence, but it will not be identical at every brokerage.
• Hypothesis means the point is likely important but must be checked with real Kenyan brokers.
• Commission rates, payment handling, taxes, insurer agreements, and policy conditions can change. A brokerage should confirm the
current rule before using a number commercially.
SECTION 1
1. Executive Economic Summary
An insurance broker does not carry the insurance risk. The insurer does that.
The broker earns money by helping a client understand a risk, finding suitable insurance, comparing terms, arranging cover, supporting
the client during the policy period, and helping at renewal or during a claim.
The simplest economic journey is:
Client has a risk
→
Broker understands it
→
Insurers quote
→
Client chooses
Premium reaches
insurer
→
Cover starts
→
Commission becomes
due
→
Broker services policy
Policy renews or ends
The broker usually earns a percentage of the premium as commission. The rate depends on the class of insurance and is limited by
regulation. Kenyan law says an insurer should pay the intermediary's commission within 30 days after receiving the premium. Resident
insurance brokers normally suffer 5% withholding tax on commission. [S3] [S4] [S8]
The broker starts spending money long before commission arrives. Staff spend time finding clients, collecting documents, preparing
submissions, asking insurers for terms, comparing quotes, correcting mistakes, following up, issuing documents, supporting claims,
reconciling commissions, and preparing renewals.
This creates the central business problem:


<<PAGE 3>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
3
The broker can do a lot of work before knowing whether the client will buy, whether the premium will be
paid, whether the insurer will issue correct documents, and whether the commission will arrive correctly.
The broker's basic profit equation is:
Commission and agreed fees
- 5% withholding tax deducted from commission cash received
- sales and placement labour
- policy administration labour
- claims and servicing labour
- travel, communication, and document costs
- compliance, licensing, guarantee, and professional indemnity costs
- technology, office, and management overhead
- errors, rework, lost renewals, and unpaid commission
= profit before income tax
Withholding tax is normally a tax credit rather than a final business cost for a resident broker, but it still reduces the cash received
immediately. [S8]
The broker makes good money when it:
• wins clients whose annual commission is larger than the cost of serving them;
• retains the client for several renewals;
• places the right cover without costly mistakes;
• collects missing information early;
• receives correct commission quickly;
• controls service and claims workload;
• notices renewal risk before the client leaves.
The broker loses money when:
• staff work on quotations that never convert;
• a policy is placed but premium is not paid;


<<PAGE 4>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
4
• commission is missing, underpaid, delayed, or never reconciled;
• documents are wrong and work must be repeated;
• claims and servicing consume far more time than expected;
• a client leaves at renewal;
• a missed deadline causes uninsured exposure, complaint, or professional liability;
• many small policies create more service cost than commission.
The correct economic picture is therefore not one status. It is a group of linked states:
Brokerage economic state =
[client commitment, risk information, market response, client decision,
premium, cover, policy evidence, service load, commission, renewal, risk]
One policy can be active while its documents are incomplete, its commission is unpaid, a claim is waiting, and its renewal is already
becoming urgent.
SECTION 2
2. Best Segmentation of the Industry
2.1 Segment by how the brokerage makes money
Segment
What it sells
Main income
Main cost and risk
Economic pattern
Corporate and
commercial broker
Advice, insurer access,
placement, service, claims
support
Commission; sometimes agreed
fees
High staff effort, tender work, complex
documents, long sales cycles
Fewer clients, larger premiums,
many policies per client
SME general
insurance broker
Motor, property, WIBA, liability,
medical and business packages
Mostly commission
High follow-up and admin cost for
moderate premium
Many renewals; profitability
depends on repeat business
Retail or
personal-lines
broker
Individual motor, travel, home,
personal accident
Commission
Small commission per policy; price
competition; high transaction volume
Must be fast and low-cost
Medical-focused
intermediary
Group medical placement and
member support
Commission or agreed
remuneration
Very heavy service, pre-authorisation
and claims workload
Revenue can look attractive while
service cost destroys margin


<<PAGE 5>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
5
Segment
What it sells
Main income
Main cost and risk
Economic pattern
Life, pension and
employee-benefits
broker
Group life, pensions, credit life
and long-term products
Commission and sometimes
advisory fees
Long selling cycle, compliance, member
communication
Longer relationships; income
pattern differs from annual
general insurance
Specialist broker
Marine, aviation, energy,
construction, professional
liability and large risks
Higher-value commission and fees
Scarce expertise, complex placement,
co-insurance or reinsurance
Fewer but more valuable and
more technical units
Tied or corporate
insurance agency
Sells for one insurer or a limited
group
Agency commission
Less insurer comparison; depends
heavily on insurer relationship
Simpler placement but less
independent market choice
2.2 Important difference: broker versus agent
A broker normally acts as an intermediary who finds and places cover for the client across insurers. An agent normally brings business to
an insurer under an agency relationship. The legal permissions, market access, economics, and client promise are different. [S3] [S16]
ASAP's strongest economic target is the independent brokerage that manages many clients, insurers, policy types, documents, renewals,
claims, premium records, and commission statements.
2.3 Scope used for the rest of this report
The remaining model uses a Kenyan commercial brokerage that places general insurance and supports the policy through its full year.
Medical, life, microinsurance, and pure retail sales need adjusted versions because their service load, commission pattern, and policy
periods differ.


<<PAGE 6>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
6
SECTION 3
3. Primary Economic Unit
Primary unit: the client-policy-year
This means one policy or renewal placed for one client for one period of insurance.
Examples:
• Acme Ltd's motor fleet policy for 1 November 2026 to 31 October 2027;
• Jane Wanjiku's private motor policy for twelve months;
• a company's group medical policy for one benefit year;
• a contractor's WIBA policy for one annual period.
This is the best unit because it contains:
• a client need;
• a defined insurance risk;
• insurer quotations;
• a premium;
• a client decision;
• evidence that cover exists;
• brokerage commission;
• service and claims effort;
• an expiry date;
• a renewal or exit decision;
• measurable profit or loss for the brokerage.
When the unit becomes economically real


<<PAGE 7>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
7
The unit begins as a possible sale. It becomes economically serious when the broker accepts the client request or renewal and commits
staff time. It becomes revenue-producing only when the client selects terms, the required premium reaches the insurer, and cover is
placed. Commission then becomes due under the insurer agreement and Kenyan law. [S3]
When it becomes economically complete
It is complete when:
• the policy period has ended or renewed;
• all servicing and claims-support obligations for that period are understood;
• commission and adjustments are reconciled;
• cancellations or refunds are settled;
• documents and client instructions are stored;
• no unresolved complaint, error, or professional-liability exposure remains.
Important secondary units
Secondary unit
Relationship to client-policy-year
Economic role
Client relationship
Contains many policy-years
Spreads acquisition cost across several policies and renewals
Opportunity or tender
May create several policies
Consumes sales effort before revenue exists
Quote request
One insurer response path
Produces a usable option or wastes placement time
Endorsement or service request
Changes an active policy
Can add premium and commission, or create unpaid service work
Claim support case
Happens under a policy
Usually protects retention rather than creating direct commission
Premium item
Amount owed to insurer
Controls whether cover can start or continue
Commission receivable
Amount owed to broker
Converts placed business into brokerage cash
Renewal cycle
Creates the next policy-year
Main retention and repeat-revenue mechanism
Complaint or error
Exception to normal service
Can destroy trust, commission, renewal and professional liability capacity


<<PAGE 8>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
8
SECTION 4
4. Core Economics
4.1 What the client buys
The client buys more than a policy document. The client is buying:
• help understanding what can go wrong;
• access to insurers and usable quotations;
• an explanation of price, cover, limits, excesses, and exclusions;
• correct placement of cover;
• help keeping records and certificates correct;
• support when something changes;
• support when a claim occurs;
• help making the next renewal decision.
The insurer receives the premium and carries the insured risk. The broker receives commission or an agreed fee for bringing, placing, and
supporting the business.
4.2 Revenue equation
Gross brokerage revenue
= commission on new policies
+ commission on renewals
+ commission on additional premium from endorsements
+ agreed advisory or administration fees, where permitted and disclosed
- commission returned after cancellation, refund, or correction


<<PAGE 9>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
9
Contribution from one policy-year
= gross brokerage revenue
- direct acquisition and placement labour
- direct administration and service labour
- direct claims-support labour
- direct communication, travel, and document cost
- unrecovered error and rework cost
Brokerage profit
= contribution from all policy-years
- salaries not assigned directly
- office and technology
- compliance and audit
- licence, guarantee, and professional indemnity costs
- marketing and management overhead
4.3 Commission mechanics
Kenya limits commission by class of insurance. Common published maximums include 10% for motor, 17.5% for marine, 20% for personal
accident, 8% for group life, and 10% for medical. Fire has historically carried a higher maximum. Actual income depends on the class,
insurer agreement, policy structure, premium paid, taxes, and later adjustments. [S4] [S12]
Simple example - not an industry average
A client pays KSh 1,000,000 for an annual motor policy.
Premium paid to insurer KSh 1,000,000
Maximum motor commission at 10% KSh 100,000
5% withholding tax deducted from commission KSh 5,000
Immediate commission cash to broker KSh 95,000
The broker still needs to pay salaries, rent, technology, compliance, sales, placement, service, and claim-support costs. If that policy uses
KSh 70,000 of direct and shared cost, the remaining contribution is only KSh 30,000 before company tax. This KSh 70,000 cost is an
illustration and must be tested with operators.
4.4 Working capital


<<PAGE 10>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
10
The client normally pays premium to the insurer before the insurer assumes risk, subject to prescribed exceptions. The insurer should pay
the broker's commission within 30 days after receiving premium. [S3] [S10]
The broker therefore finances:
• prospecting and quotation work before a sale;
• placement work before premium is paid;
• policy administration before commission arrives;
• claims and service work throughout the year;
• salaries and overhead even when commission reconciliation is late.
Unlike a contractor, the broker usually does not finance materials or a physical project. Its main working-capital burden is people time
paid before commission cash arrives.
4.5 Fixed capacity cost
Broker licensing requirements include at least KSh 1 million paid-up capital, a KSh 3 million bank guarantee or qualifying government
bond, and professional indemnity cover with a minimum limit of KSh 10 million. These requirements tie up money or create annual cost
before the brokerage writes any policy. [S7]
The biggest regular cost is normally skilled staff capacity. A staff hour used on a weak lead, repeated correction, missing document, or
avoidable follow-up cannot be reused.


<<PAGE 11>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
11
SECTION 5
5. Actor & Incentive Map
Actor
What they want
What they control
Delay or economic risk they can create
Client or policyholder
Suitable cover, fair price, clear service, claim
support
Risk information, documents, premium
payment, final choice
Missing facts, late payment, unclear
instructions, last-minute renewal
Client finance team
Correct invoice and payment evidence
Payment approval and timing
Premium delay can stop cover from starting
Client decision maker
Best balance of price, cover and insurer
confidence
Insurer selection and renewal decision
Slow choice shortens placement time and can
cause a lapse
Broker sales/account
executive
Win and retain client
Relationship, fact-find, expectation-setting
Can promise too much or accept unprofitable
work
Broker placement officer
Obtain accurate, competitive terms
Insurer submission and comparison
Weak submission creates delays, poor terms,
or exclusions
Broker policy
administrator
Correct policy documents and records
Schedules, certificates, endorsements,
delivery evidence
Errors create rework and uninsured exposure
Broker claims officer
Help client submit and follow up claim
Claim checklist, correspondence, escalation
Missing evidence and weak follow-up damage
retention
Broker finance officer
Receive correct commission and reconcile
accounts
Commission statements, WHT certificates,
receivables
Unreconciled differences hide lost income
Broker manager
Profitable growth, compliance and controlled
workload
Pricing choices, client acceptance, staff
assignment, escalation
Growth pressure can create bad-fit clients and
overloaded teams
Insurer underwriter
Accept risks that fit appetite at a viable price
Terms, conditions, exclusions, capacity and
quote validity
Slow or incomplete response blocks client
decision
Insurer credit/finance
team
Correct premium and commission accounting
Receipts, statements, commission payment
and adjustments
Missing or delayed commission traps broker
cash
Insurer policy team
Correct policy issuance
Schedule, wording, certificate and
endorsement
Wrong or late documents create risk and
service cost
Insurer claims team
Valid, complete, controlled claim settlement
Requirements, liability position, assessor and
payment
Delays affect client trust even when broker is
not the risk carrier
Assessor, investigator,
adjuster or provider
Clear instruction and payment
Technical evidence and reports
External queue delays can stall claims


<<PAGE 12>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
12
Actor
What they want
What they control
Delay or economic risk they can create
Regulator
Fair treatment, stable market and compliance
Licensing, conduct rules, enforcement
Missing compliance can stop business or
increase cost
KRA
Correct tax collection
WHT and other tax rules
Missing certificates or wrong treatment
creates cash and audit problems
Main incentive conflict
The client wants quick cover and the lowest price. The insurer wants complete information and a price that matches the risk. The broker
wants to win the client, protect the relationship, stay compliant, and earn enough commission to cover service cost.
This conflict is strongest near expiry. Everyone is under time pressure, but a rushed decision can leave incorrect values, exclusions,
missing documents, unpaid premium, or unclear client instructions.
SECTION 6
6. Primary Economic State Machine
6.1 Complete path
Risk need visible
→
Opportunity qualified
→
Client mandate
→
Risk facts ready
Market approached
→
Usable terms
→
Client instruction
→
Premium paid
Cover confirmed
→
Policy evidence
complete
→
Active service
→
Commission collected
Renewal or exit
→
Economically closed
6.2 State table A - economic position


<<PAGE 13>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
13
ID
State
Plain meaning
Economic meaning
Cost, value and cash
position
Valid next states
S0
Risk need visible
A person or business may
need insurance
Possible future revenue only
Small prospecting cost; no
right to commission
S1 or lost
S1
Opportunity
qualified
Broker decides the case is
worth pursuing
Sales capacity is committed
Staff cost starts; probability of
revenue is still uncertain
S2 or no-bid
S2
Client mandate or
renewal request
Client asks broker to act
Relationship and service
promise become real
More staff cost; still no
commission
S3 or cancelled
S3
Risk facts ready
Enough correct information
exists to approach insurers
Insurers can price the real risk
Fact-find and document cost
accumulated
S4 or information hold
S4
Market approached
Suitable insurers have
received the submission
Market response becomes
possible
Placement labour grows; no
cash yet
S5, insurer decline, revise
S5
Usable terms
received
At least one complete quote
can be explained
A sale can now happen
Potential premium and
commission become
measurable
S6, re-market, lost
S6
Client instruction
recorded
Client chooses an insurer
and terms
Commercial choice is proven
Revenue probability becomes
high, but cover may not exist
yet
S7 or changed decision
S7
Premium paid or
valid payment
condition met
Insurer receives required
premium
Insurer can assume risk;
commission becomes due
Client money goes to insurer;
broker commission receivable
begins
S8 or payment failure
S8
Cover confirmed
Written confirmation shows
cover is active
Broker has delivered the main
placement result
Commission due; professional
duty continues
S9, correction, cancellation
S9
Policy evidence
complete
Correct schedule, wording
and certificates reach client
Placement is provable and safer
Rework risk falls; commission
may still be unpaid
S10, correction, servicing
S10
Active service
period
Broker supports changes,
claims and questions
Retention value is created, but
cost keeps growing
Commission may already be
cash; service can still destroy
margin
S11, claim, endorsement,
cancellation
S11
Commission
reconciled and
collected
Insurer statement matches
expected commission and
cash arrives
Placed business becomes broker
cash
WHT reduces immediate cash;
unmatched items remain
exposed
S12 or dispute
S12
Renewal or exit
decision
Client chooses to renew,
change broker, or end cover
Future recurring revenue is won
or lost
New acquisition cost is
avoided if retained
New S2, lapse, cancellation


<<PAGE 14>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
14
ID
State
Plain meaning
Economic meaning
Cost, value and cash
position
Valid next states
S13
Economically closed
The policy-year, money,
documents and open issues
reconcile
Final contribution is known
No unresolved commission,
refund, complaint or service
obligation
Archive or next policy-year
6.3 State table B - entry, evidence, actor and approval
State
Entry trigger
Required information and
evidence
Main owner
Important decision or
approval
S0
Referral, lead, tender, expiry list
or enquiry
Contact, possible risk, source
Sales/account executive
Is it real enough to contact?
S1
Broker accepts pursuit
Client fit, likely premium, line of
business, capacity
Sales lead or manager
Is expected commission worth the
work and risk?
S2
Client appointment, email
instruction or renewal ownership
Mandate, current policies, expiry,
contacts
Account executive
What has the broker agreed to
do?
S3
Fact-find passes completeness
check
Proposal forms, schedules, claims
history, asset/member lists,
values
Account executive and placement
Is the information accurate
enough to market?
S4
Submission sent to selected
insurers
Submission copy, insurer list,
date, requested terms
Placement officer
Which insurers fit the risk and
avoid conflicts?
S5
Terms pass comparison check
Quote, exclusions, deductibles,
premium, validity, subjectivities
Placement and account executive
Are terms complete and fairly
explained?
S6
Client gives clear choice
Written instruction and selected
option
Client decision maker
Which insurer and terms are
accepted?
S7
Insurer confirms receipt of
required premium
Receipt, bank evidence, payment
reference, permitted guarantee or
deposit
Client finance and insurer finance
Has the legal payment condition
been met?
S8
Insurer confirms inception
Cover note, risk note, policy
confirmation
Insurer policy team and broker
Does confirmation match client
instruction?
S9
Correct documents delivered
and acknowledged
Schedule, wording, certificate,
endorsements, delivery record
Policy administrator
Are all names, dates, values,
limits and items correct?
S10
Policy remains active
Service logs, claim records,
endorsement instructions
Account executive and service teams
Which changes are safe and who
must approve?


<<PAGE 15>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
15
State
Entry trigger
Required information and
evidence
Main owner
Important decision or
approval
S11
Statement and cash match
expectation
Insurer statement, commission
calculation, WHT certificate, bank
receipt
Broker finance
Is the amount complete and
correct?
S12
Renewal clock or client exit
starts
Updated exposure, claims, service
history, insurer performance
Account executive
Retain, re-market, change terms,
or let policy end?
S13
All open items are cleared
Final reconciliation and complete
audit file
Manager and finance
Can the unit close without hidden
exposure?
6.4 State table C - where each state gets stuck
State
Common reason it is stuck
Unhealthy signal
Financial effect if nothing happens
S0-S1
Weak lead or poor fit
Repeated calls with no decision maker or clear
risk
Wasted sales time
S2
No clear mandate or current policy
Broker is doing work from verbal promises
only
Free work and dispute risk
S3
Missing schedules, claims data, values or
signed forms
Expiry is near but information is incomplete
Poor terms, wrong cover, or lost renewal
S4
Insurer does not respond or asks repeated
questions
No usable terms before client decision date
Lost sale or emergency placement
S5
Quote is incomplete or cannot be compared
Premium shown without exclusions, excesses
or subjectivities
Bad recommendation and liability risk
S6
Client delays choice
Quote validity is close to expiring
Re-quotation, price change, or cover gap
S7
Premium is not paid or reference is unclear
Inception date arrives without insurer receipt
No cover, complaint, lost commission
S8-S9
Schedule or certificate is late or wrong
Cover confirmation and final document
disagree
Rework and professional-liability exposure
S10
Many claims, endorsements or support
requests
Service hours rise while revenue stays fixed
Policy becomes unprofitable
S11
Commission statement missing or amount
differs
Commission older than 30 days
Broker finances operations and may lose
income
S12
Renewal started too late
No updated risk information or terms near
expiry
Churn, poor terms, uninsured gap


<<PAGE 16>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
16
State
Common reason it is stuck
Unhealthy signal
Financial effect if nothing happens
S13
Refund, claim, complaint or commission
dispute remains
Closed in one system but open in email or
finance
Hidden liability and wrong profit
SECTION 7
7. Exception State Machine
Exception
Starts from
Trigger
Economic consequence
Recovery path
Can value be
permanently lost?
No-bid or bad-fit
client
S1
Low premium, high service
need, unacceptable risk
Pursuit cost only
Decline clearly and close
Yes, pursuit time is sunk
Client chooses
another broker
S4-S6
Price, relationship, delay or
trust
All quotation work earns no
commission
Learn reason; seek future
opportunity
Yes
Insurers decline
risk
S4
Risk outside appetite or
information poor
Placement work increases; sale
may fail
Improve information, change
market, change risk
Yes
Quote expires
S5-S6
Client decision or payment is
late
Premium or conditions may
change
Re-quote and obtain fresh
instruction
Yes, if client leaves
Premium payment
failure
S7
No payment, wrong
reference, bank delay
Cover may not start;
commission not due
Confirm payment route and
new inception
Yes
Wrong cover
confirmation
S8
Dates, item, value or terms
differ
Client may believe they are
covered incorrectly
Correct immediately and
preserve evidence
Yes, through complaint or
uninsured loss
Policy issuance
delay
S8-S9
Insurer administration delay
More broker follow-up; weaker
client trust
Escalate and obtain correct
document
Usually recoverable, but
service cost is sunk
Endorsement or
TOR
S10
Client changes asset,
person, value, dates or
ownership
Additional work; may create
extra premium and commission
Gather instruction, obtain
insurer approval, confirm
change
Yes if change is late or
wrong
Claim occurs
S10
Insured event
Heavy service cost; renewal and
relationship at risk
Complete documents, submit,
follow up, explain
Usually no direct new
revenue
Cancellation or
refund
S8-S10
Client or insurer ends cover
Commission may be reduced or
returned
Reconcile earned period,
refund and commission
Yes
Commission
dispute
S11
Statement missing,
class/rate wrong, payment
not linked
Broker cash and reported
income are wrong
Match premium, policy, rate,
WHT and payment
Yes if not pursued


<<PAGE 17>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
17
Exception
Starts from
Trigger
Economic consequence
Recovery path
Can value be
permanently lost?
Renewal lost or
lapsed
S12
Late work, price, service
failure or competitor
Future commission disappears
Win-back or replace with new
client
Yes
Complaint or
professional error
Any active state
Mis-selling, wrong
document, missed deadline,
privacy breach
Legal, licence, reputation and
insurance cost
Investigate, correct, notify,
compensate if required
Yes, potentially severe
Key loops
Missing facts
→
Request correction
→
Risk facts ready
Incomplete quote
→
Return to insurer
Usable terms Wrong
policy document
→
Correction request
→
Policy evidence
complete Unmatched
commission
→
Reconciliation
Commission collected
Claim or endorsement
→
Active service
→
Renewal decision
SECTION 8
8. Money State Machine
Operational progress and money progress are not the same.
Possible premium
→
Quoted premium
→
Client-selected premium →
Premium due
Premium reaches
insurer
→
Commission due
→
Commission statement
→
WHT deducted
Commission cash
received
→
Adjustments cleared


<<PAGE 18>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
18
Money state
Meaning
Value owner
What unlocks next state
Where money gets trapped
M0 Possible
premium
Early estimate of the policy
price
Nobody has a payment right
Usable insurer terms
Bad or incomplete risk data
M1 Quoted
premium
Insurer offers a price for a
limited time
Insurer offer; client not committed
Client selection
Quote expires or is misunderstood
M2 Selected
premium
Client chooses the option
Client owes payment if
proceeding
Correct payment instruction
Internal client approval
M3 Premium due
Payment is required before risk
starts, subject to exceptions
Insurer
Receipt or permitted payment condition
Bank delay, wrong reference, split
instalment
M4 Premium
received by insurer
Insurer has the premium
Insurer carries risk according to
cover
Cover confirmation and commission
calculation
Payment not linked to correct
policy
M5 Commission due
Broker has a claim under
law/agreement
Broker
Insurer statement and payment
Insurer delay or missing booking
M6 Commission
stated
Insurer reports amount payable
Broker, subject to reconciliation
Match policy, premium, rate and tax
Wrong class, cancellation,
adjustment, co-insurance
M7 Net commission
paid
Cash reaches broker after WHT
Broker
Bank match and WHT certificate
Unidentified deposit or missing
tax certificate
M8 Final
commission settled
Refunds, cancellations and
adjustments are cleared
Broker
Policy-year close
Late clawback or unresolved
dispute
Where value is trapped
The most important trapped-value gap is:
Premium received by insurer
-> commission legally due
-> commission correctly stated
-> commission cash received and matched
A broker can have strong sales but weak cash because insurer statements, WHT records, premium references, and bank receipts do not
match.


<<PAGE 19>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
19
SECTION 9
9. Cost & Margin State Map
Stage
Cost accumulating
Is it recoverable?
Margin uncertainty
Prospecting and
qualification
Marketing, calls, travel, sales salary
Usually no
Very high: most opportunities may not convert
Client mandate and
fact-find
Account executive and document work
Usually no separate charge
High: scope and service need may still be
unclear
Insurer marketing
Placement staff, insurer follow-ups, specialist
advice
Usually only if policy is placed
High
Quote comparison and
advice
Analysis, presentation and meetings
Usually only if policy is placed
Medium to high
Placement and payment
Administration and finance follow-up
Covered by expected commission
Medium
Policy checking and
delivery
Policy administration and correction
Covered by commission
Medium; errors can make it high
Active policy service
Endorsements, certificates, questions,
meetings
Often no new fee
Can rise throughout year
Claim support
Claims staff and external follow-up
Usually no direct commission
Very high for difficult claims
Commission
reconciliation
Finance staff and insurer follow-up
No extra revenue
Medium; hidden income loss possible
Renewal
Updated fact-find, remarketing and
negotiation
Paid only if retained and placed
High until client renews
Expected margin movement


<<PAGE 20>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
20
At lead: negative - sales cost, no revenue
At usable quote: still negative - more labour used
At client choice: expected profit becomes visible
At premium receipt: commission becomes due
At commission cash: positive cash contribution becomes real
During service/claims: contribution can fall as hours grow
At renewal: retention can make the relationship much more profitable
At loss/cancellation: future value and some commission can disappear
The highest-margin client is not automatically the one with the highest premium. It is the client whose commission, fees, retention and
referrals remain larger than the full cost of winning and serving the account.
SECTION 10
10. Evidence-to-Economic-Transition Map
Evidence
Who creates it
Transition it unlocks
What happens if missing
Can it be recreated later?
Client mandate or
appointment
Client and broker
Opportunity -> authorised work
Dispute over broker authority; free work
Sometimes, but later proof is
weaker
Current policy
schedule
Previous insurer/client
Fact-find -> market-ready risk
Wrong comparison and missing cover
changes
Usually
Proposal or
risk-information
form
Client with broker help
Risk facts -> insurer quote
Insurer may decline, add conditions, or
avoid liability
Yes before placement
Asset/member/vehi
cle list
Client
Complete exposure -> accurate
terms
Items may be uninsured or mispriced
Yes, but late correction may cost
more
Claims history
Insurer/client
Risk assessment -> fair quote
Premium or terms may be wrong
Usually
Insurer quotation
Insurer
Market response -> client
decision
No defensible recommendation
Must be re-issued if expired
Quote comparison
and explanation
record
Broker
Terms -> informed choice
Mis-selling and complaint risk
Weak if reconstructed later
Written client
instruction
Client
Choice -> placement
Wrong insurer or cover dispute
Difficult after loss occurs


<<PAGE 21>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
21
Evidence
Who creates it
Transition it unlocks
What happens if missing
Can it be recreated later?
Premium
receipt/payment
confirmation
Insurer/bank
Payment -> cover and
commission
Risk may not start; commission not due
Bank evidence may be found later
Cover note or
written confirmation
Insurer/broker
Placement -> active cover
Client cannot safely rely on cover
Yes, but delay is risky
Policy schedule and
wording
Insurer
Cover -> complete evidence
Limits and exclusions remain unclear
Yes
Delivery
acknowledgement
Client/broker
Document issued -> proven
delivery
Conduct and complaint exposure
Hard to recreate honestly
Endorsement
instruction and
document
Client/insurer
Old cover -> changed cover
Asset or value may remain wrong
Sometimes
Claim notification
and supporting
documents
Client/broker/providers
Incident -> insurer claim process
Delay or denial risk
Some evidence decays over time
Commission
statement
Insurer
Commission due -> reconciled
receivable
Missing income remains invisible
Usually
WHT certificate
Insurer/KRA
Net payment -> tax credit
evidence
Broker may lose or delay tax credit
Usually, with effort
Renewal instruction
Client
Expiring policy -> next policy-year
Cover may lapse or client may leave
Not after the deadline without a
gap
Kenyan market-conduct rules require intermediaries to disclose their role and remuneration basis, quote terms as provided by the insurer,
explain policy terms, confirm when insurance has been effected, and help ensure the policy document is issued within 14 days if not
supplied at inception. [S5]


<<PAGE 22>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
22
SECTION 11
11. Information Fragmentation Map
Economic question
Where the answer often lives
Why reconstruction is difficult
What exactly did the client ask
for?
Email, WhatsApp, meeting notes, proposal form
Later messages may change the original request
What risks and items are
included?
Spreadsheet, old schedule, PDF, handwritten list
Versions and totals may disagree
Which insurers were
approached?
Placement officer's email and personal tracker
Another employee cannot see complete market activity
What did each insurer quote?
PDFs, email bodies, portals and spreadsheets
Terms use different wording and structures
What did the client choose?
Email, signed form, WhatsApp, meeting minutes
Verbal choice may not prove exact terms
Has premium reached the
insurer?
Client bank slip, insurer receipt, finance email
Reference may not match policy or client name
Is cover actually active?
Cover note, risk note, portal, insurer email
Confirmation may conflict with requested dates
Is the final schedule correct?
Insurer PDF, broker record, client copy
Corrections may create several versions
What is happening with a claim?
Claims email, insurer portal, phone calls, assessor reports
Current blocker may exist only in one person's memory
What commission is owed?
Premium register, insurer statement, broker ERP, WHT
system, bank
Different identifiers and months prevent matching
Which renewals are in danger?
Expiry spreadsheet, email, account executive memory
Missing updates make the list look healthier than reality
Is this client profitable?
Commission accounts, staff time, claims files, service logs
Revenue and service cost are rarely joined at policy level
Strong inference: The hardest management problem is not lack of data. It is that the same policy has different partial truths in email,
documents, spreadsheets, insurer systems, finance records, and employee memory.


<<PAGE 23>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
23
SECTION 12
12. Decision & Approval Map
Decision
Main decision maker
Information used
Cost of a bad or late decision
Pursue or decline client
Broker manager/sales lead
Expected premium, service need, risk class, fit
Wasted capacity or missed revenue
Which insurers to
approach
Placement officer
Risk type, insurer appetite, service history,
capacity
Few or weak terms
Is information complete
enough?
Account executive/underwriter
Proposal, schedules, claims, values
Wrong pricing or uninsured exposure
Are terms truly
comparable?
Placement and account executive
Premium, cover, limits, excesses, exclusions,
subjectivities
Bad advice and complaint risk
Which option should be
recommended?
Broker professional
Client need, terms, insurer strength/service
Client loss or unsuitable cover
Which option is selected?
Client
Comparison and explanation
Wrong cover or unaffordable premium
Has payment condition
been met?
Insurer finance/credit
Receipt and policy reference
Cover may not start
Does policy evidence
match instruction?
Policy administrator/account executive
Instruction, quote, receipt, schedule
Professional error
Is an endorsement safe
to place?
Client, broker and insurer
Exact requested change and effective date
Uninsured or wrongly insured item
Is a claim file ready?
Claims officer and insurer
Policy, incident and supporting documents
Delay or denial
Is commission correct?
Broker finance
Premium, class, rate, statement, tax and bank
Lost cash and wrong accounts
Start renewal, retain or
re-market?
Account executive/manager/client
Claims, price, service, exposure changes
Churn or poor terms
The broker repeats four expensive thinking tasks across almost every unit:
1. Find the latest correct information.
2. Check whether it is complete and consistent.
3. Compare choices and explain the difference.


<<PAGE 24>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
24
4. Decide what must happen next and who controls it.
SECTION 13
13. Waiting & Dependency Map
Waiting on
Typical state
Acceptable time
Economic effect
Is the delay usually visible?
Client documents
S2-S3
Depends on expiry; shorter near
renewal
Staff follow-up, weaker submission, lost
cover
Often visible only to account
owner
Insurer quotation
S4
Must fit quote and expiry clock
Lost sale or poor market comparison
Partly visible in email
Underwriting
question
S4-S5
Before quote validity/renewal
deadline
Rework and placement delay
Usually fragmented
Client choice
S5-S6
Before quote expiry and inception
Terms expire or cover lapses
Often tracked manually
Premium payment
S6-S7
Before risk begins, except allowed
cases
No cover and no commission
Finance and account teams may
see different status
Cover confirmation
S7-S8
Immediate or prompt after valid
payment
Client uncertainty and professional risk
Usually in email
Final policy
document
S8-S9
Within 14 days when not given at
inception
More follow-up and conduct risk
Often poorly measured
Endorsement
response
S10
Before requested effective date
Wrong active cover
Often visible only in service
mailbox
Claim document
Claim loop
Before insurer can decide
Claim delay and unhappy client
Checklist may be manual
Assessor or insurer
action
Claim loop
Depends on claim and legal clocks
Retention and reputation damage
External dependency is often
unclear
Commission
statement/payment
S11
Commission due within 30 days of
insurer premium receipt
Working-capital pressure and lost income
Usually visible only after
reconciliation
Manager/client
approval
Any key decision
Before the next external
commitment
Queue grows and deadlines shorten
Sometimes hidden in chat or
email
The cost of waiting is mainly staff time, lost probability of conversion, lost renewal probability, delayed commission cash, and increased
professional risk.


<<PAGE 25>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
25
SECTION 14
14. Economic Leakage Map
Scores are directional. They must be checked with real brokerage data.
Leakage
Type
Root cause
Impact /10
Frequency /10
Recoverability /10
Visibility today
/10
Time sensitivity
/10
Missed or
late
renewal
Revenue
Renewal starts late
or owner forgets
10
7
3
5
10
Commissi
on not re
conciled
Cash/revenue
Premium, policy,
statement and bank
do not match
9
7
7
3
7
Unprofita
ble small
account
Margin/capacity
Service hours
exceed commission
7
8
4
2
5
Quote
work that
never
converts
Capacity
Poor qualification or
weak follow-up
7
8
1
4
6
Wrong
policy
schedule
Risk/margin
Manual re-keying,
version confusion
9
5
6
5
10
Missing
client inst
ruction
Risk
Verbal or scattered
approval
9
5
3
3
10
Premium
paid but
not
linked
Cash/risk
Wrong reference or
separate records
9
5
8
4
10
Delayed
policy do
cument
Risk/capacity
Insurer backlog and
weak follow-up
7
7
8
5
8


<<PAGE 26>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
26
Leakage
Type
Root cause
Impact /10
Frequency /10
Recoverability /10
Visibility today
/10
Time sensitivity
/10
Excessive
claim
support
effort
Margin
Difficult insurer,
missing evidence,
client expectations
7
6
2
2
7
Endorse
ment not
complete
d on time
Risk/revenue
Missing details or
insurer delay
9
5
5
4
10
Cancellat
ion
clawback
missed
Revenue/cash
Refund and
commission ledgers
separate
7
4
5
3
6
Poor
insurer
selection
Revenue/risk
Focus on price
without
service/claims
evidence
8
4
3
3
7
Staff
overload
around m
onth-end/
renewal
Capacity
Work arrives in
batches and is not
prioritised
8
7
5
4
8
Complian
ce
evidence
missing
Risk
Delivery, disclosure
or approval not
recorded
9
5
4
2
9
Client
leaves
after
poor
service
Revenue
Slow claim,
document or
communication
handling
9
5
2
4
8
Five biggest economic leaks
1. Lost renewals: future recurring commission disappears.
2. Unreconciled commission: earned income stays invisible or uncollected.
3. High service cost: staff time grows but commission is fixed.


<<PAGE 27>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
27
4. Failed quote work: the broker pays for work that produces no policy.
5. Wrong or late evidence: errors threaten cover, trust, licences and professional indemnity.
SECTION 15
15. Economic Clock Map
Clock
When it starts
What stops it
Economic consequence if missed
Current owner
Policy expiry
Existing policy inception
Renewal or replacement cover
Cover gap and lost renewal revenue
Account executive
Quote validity
Insurer issues quote
Client accepts and pays under
valid terms
Re-quotation and changed premium
Placement officer/client
Premium-before-ris
k clock
Intended inception
Insurer receives premium or valid
exception applies
Insurer may not assume risk
Client finance/insurer
Commission
payment clock
Insurer receives premium
Broker receives commission
Broker cash delayed beyond 30 days
Insurer and broker finance
Policy document
clock
Cover begins without full policy
document
Correct document delivered
Market-conduct risk after 14 days
Insurer and broker policy team
Endorsement
effective date
Client requests change
Insurer confirms exact change
Wrong cover during the gap
Account executive/policy admin
Claim notification
clock
Incident occurs or client knows
Valid notification recorded
Evidence weakens or policy deadline
may be missed
Client and claims officer
Claim settlement
clock
Complete relevant claim
documents reported
Liability, amount, claimant and
payment resolved
Legal and complaint exposure; Section
203 refers to 90 days
Insurer; broker follows up
Tender deadline
Tender published
Complete submission delivered
Entire opportunity lost
Sales/tender team
Monthly
commission
statement
Accounting period closes
Statement reconciled
Errors age and become harder to recover
Broker finance
Licence
renewal/compliance
calendar
Regulatory period
Complete filing and payment
Brokerage cannot lawfully continue or
faces sanction
Principal officer/compliance
WHT certificate and
tax filing
Commission paid/deducted
Certificate and tax records match
Tax credit or compliance problem
Finance


<<PAGE 28>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
28
Sources for the 30-day commission, 14-day policy document, and 90-day claims references are [S3], [S5], and [S15]. Exceptions and
exact starting points must be checked against the current policy and law.
SECTION 16
16. Quantified Economics
16.1 Market facts
Measure
Finding
Evidence label
Kenya insurance gross written
premium, 2025
KSh 464.72 billion
Observed fact - IRA Q4 2025 [S2]
Kenya insurance gross
premium, 2024
About KSh 395.3 billion in Q4 industry reporting
Observed fact - IRA/Cytonn summary [S1] [S11]
General insurance share, 2024
About 51.6% of industry premium
Observed fact - 2024 industry results [S11]
Motor and medical share of
general insurance, 2024
About 64.8%
Observed fact - 2024 industry results [S11]
Insurance penetration, 2024
About 2.44% of GDP
Observed fact - AKI survey [S13]
Licensed brokers, end of 2023
220
Observed fact - cited industry summary [S11]
Licensed brokers on 2025
published list
List runs to 191 brokers
Observed fact from IRA licensed list [S14]
Broker channel share, 2020
37.7% of industry premium
Observed fact - IMF paper using Kenyan data [S17]
Broker channel share, 2023
About 30.3% reported in public industry discussion
Secondary evidence; validate against IRA source [S18]
Commission payment deadline
Within 30 days after insurer receives premium
Observed fact - Insurance Act [S3]
Resident broker WHT on
insurance commission
5%
Observed fact - KRA [S8]
Minimum paid-up capital
KSh 1 million
Observed fact - IRA licensing [S7]
Bank guarantee/government
bond
KSh 3 million
Observed fact - IRA licensing [S7]


<<PAGE 29>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
29
Measure
Finding
Evidence label
Minimum professional indemnity
limit
KSh 10 million
Observed fact - IRA licensing [S7]
The 2024 totals differ slightly across publications because some use gross written premium, gross premium income, direct business, or
different reporting cutoffs. This report does not force unlike measures into one number.
16.2 Strong inference about broker revenue pool
If brokers placed roughly 30%-38% of a KSh 361-395 billion market during the 2020-2024 period, the premium passing through the broker
channel could be roughly KSh 108-150 billion a year.
This is not brokerage revenue. Broker revenue is only the commission or fee on that premium. A blended commission rate cannot be
safely assumed because the mix of motor, medical, fire, marine, life and other classes changes the result.
16.3 Illustrative policy economics
Policy example
Premium
Example maximum
commission
Gross commission
Net cash after 5% WHT
Status
Motor policy
KSh 1,000,000
10%
KSh 100,000
KSh 95,000
Illustration using published
limit
Medical policy
KSh 5,000,000
10%
KSh 500,000
KSh 475,000
Illustration; service cost may
be high
Marine policy
KSh 2,000,000
17.5%
KSh 350,000
KSh 332,500
Illustration; actual structure
may differ
The missing number is the full cost to win and serve each policy. Most brokerages need to measure staff time and direct costs by
client-policy-year before they can know true profitability.
16.4 Numbers that remain hypotheses
• average conversion rate from qualified opportunity to paid policy;
• average staff hours per quote, placement, endorsement, claim and renewal;
• average days from premium receipt to commission cash;


<<PAGE 30>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
30
• percentage of commission statements with differences;
• client retention by policy class and account manager;
• average contribution margin by client-policy-year;
• share of service effort caused by missing or conflicting information.
SECTION 17
17. Management Control Loop
What management usually tries to know
Daily
• Which covers expire very soon?
• Which client decisions or premiums are still missing?
• Which claims or servicing requests are blocked?
• Which insurer responses are late?
Weekly
• Which renewals may be lost?
• Which opportunities are likely to convert?
• Which employees are overloaded?
• Which policy documents and endorsements are overdue?
• Which commissions should already have been paid?
Monthly
• Premium placed by class, insurer, client and employee;
• commission expected, stated, received and disputed;
• new business and renewal retention;
• outstanding service and claims work;


<<PAGE 31>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
31
• expenses, cash and profit.
Too late or only after a problem
• a policy schedule was wrong;
• a verbal instruction cannot be proven;
• an account consumed more service cost than commission;
• commission was underpaid for several months;
• a client was already moving to another broker;
• a claim delay damaged the relationship;
• a compliance document was never stored.
Current control loop
Event happens
→
Someone receives email
or call
→
Person updates own
notes or spreadsheet
→
Manager asks for status
Team reconstructs story →
Decision is made
→
Follow-up happens
The biggest delay is often between the real event and management knowing its economic meaning.
Example:
Insurer receives client premium
-> finance email confirms receipt
-> insurer month-end statement is issued
-> broker finance downloads statement
-> policy references are matched manually
-> missing commission is noticed
-> insurer is asked to correct it
By the time the problem is visible, the legal 30-day period may already have passed.


<<PAGE 32>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
32
SECTION 18
18. Irreducible Economic State Machine
After removing administrative detail, the brokerage reduces to eight economic states:
State
The simplest meaning
Money position
Main question
1. Possible business
A client may buy
No revenue right
Is this worth pursuing?
2. Broker committed
Broker accepts the work
Cost begins
Do we understand the need?
3. Market-ready risk
Facts and evidence are good enough
More cost, possible sale
Can insurers price it correctly?
4. Decision-ready options
Usable terms exist
Expected commission is visible
What should the client choose?
5. Placed cover
Client chooses, premium condition is met,
cover is confirmed
Commission becomes due
Is cover exactly what was agreed?
6. Active service
Broker supports the policy
Service cost changes margin
Is the relationship still profitable and safe?
7. Cash and renewal
Commission is collected and next period is
decided
Cash realised; future value won or lost
Did we collect and retain the client?
8. Economic closure
Money, evidence and open issues reconcile
Final contribution known
Is anything still exposed?
Possible business
→
Broker committed
→
Market-ready risk
→
Decision-ready options
Placed cover
→
Active service
→
Cash and renewal
→
Economic closure
The entire business can be understood by asking eight questions:
1. What client-policy-year is this?
2. What has the broker promised?
3. What information and evidence are still missing?
4. What has the insurer offered?
5. What did the client choose and pay for?
6. Is the cover and policy evidence correct?


<<PAGE 33>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
33
7. Has commission been collected, and how much service cost has accumulated?
8. Will the policy renew, leave, or close with unresolved exposure?
SECTION 19
19. Ten Scenario Stress Tests
Scenario 1 - Normal successful motor renewal
The broker starts 45 days before expiry. The client sends the vehicle list and claims history. Three insurers quote. The client chooses one.
Premium reaches the insurer before inception. Cover is confirmed, the schedule is checked, and commission arrives within 30 days.
Path: S2 -> S3 -> S4 -> S5 -> S6 -> S7 -> S8 -> S9 -> S10 -> S11 -> S12.
Result: Commission cash arrives, service begins, and the next renewal remains possible.
Scenario 2 - Highly profitable retained corporate account
The client has six policies and renews for the fourth year. Current data is clean, the insurer relationship is stable, claims are low, and few
corrections are required.
Economic effect: Acquisition cost is already recovered. Commission repeats while placement effort falls. The relationship contribution
improves.
Scenario 3 - Quote work is lost
The team spends many hours preparing a tender. The client uses the comparison to negotiate with another broker and does not appoint
the brokerage.
Path: S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> lost.
Economic effect: All staff cost is sunk. No premium or commission follows.
Scenario 4 - Client pays late
The client selects terms but premium does not reach the insurer before intended inception. The client assumes cover has started.
Path: S6 -> S7 payment failure.


<<PAGE 34>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
34
Economic effect: No safe assumption of risk, no commission due, and serious complaint exposure if a loss occurs.
Scenario 5 - Wrong vehicle value
The client's spreadsheet shows KSh 3.8 million while the old schedule shows KSh 4.2 million. The difference is not resolved before
placement.
Path: S3 information conflict -> rushed S4-S8 -> correction or claim dispute.
Economic effect: Rework, additional or return premium, trust loss, and possible professional liability.
Scenario 6 - Fire policy document is late
Cover is confirmed, but the insurer does not issue the final schedule for three weeks. The broker repeatedly follows up.
Path: S8 -> S9 delay.
Economic effect: Placement revenue exists, but policy administration cost rises and the 14-day conduct clock is missed.
Scenario 7 - Difficult medical account
The commission is large, but the broker handles hundreds of member changes, pre-authorisations, complaints and claims questions.
Path: S10 active service loops repeatedly.
Economic effect: Gross revenue looks good while contribution margin may become poor. Operator time data is needed to prove it.
Scenario 8 - Commission underpayment
The insurer receives premium, but its statement uses the wrong class or rate. The broker does not notice for four months.
Path: S11 -> commission dispute -> reconciliation.
Economic effect: Cash is delayed; some income may be lost if evidence is weak or the item is never followed up.
Scenario 9 - Claim delay damages renewal
A client's claim is covered, but the police abstract and assessor report move slowly. The client blames the broker and moves the next
renewal.


<<PAGE 35>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
35
Path: S10 -> claim loop -> S12 lost renewal.
Economic effect: The claim does not directly reduce insurer-risk for the broker, but service cost rises and future commission disappears.
Scenario 10 - Urgent Time on Risk request
The client needs short-period motor cover immediately. Exact start and end dates, vehicle details, purpose and payment are required.
One detail is missing.
Path: S10 endorsement/TOR exception -> information hold -> insurer confirmation -> active service.
Economic effect: Fast action protects the relationship, but an unchecked date or vehicle error creates high exposure.
The model can represent all ten cases without creating a separate business model for each one. That supports the choice of
client-policy-year as the primary unit.
SECTION 20
20. Unknowns Requiring Operator Validation
These questions should be answered by interviews and real brokerage data before the model is treated as complete.
Sales and conversion
1. How many leads become qualified opportunities?
2. How many qualified opportunities reach paid, confirmed cover?
3. How many staff hours are spent on a lost quote?
4. Which client types are usually rejected as unprofitable?
Service cost
5. How many endorsements, certificates, calls and emails does each policy class create?
6. How many hours does one claim consume?
7. Which insurers create the most correction and follow-up work?
8. Which clients consume more service cost than commission?


<<PAGE 36>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
36
Money
9. What is the real average time from insurer premium receipt to broker commission cash?
10. What percentage of expected commission is missing or different on first statement?
11. How much commission is older than 30, 60 and 90 days?
12. How often are WHT certificates missing or wrong?
13. How often do cancellations create commission clawbacks?
Renewal and retention
14. What percentage of policies renew with the brokerage?
15. When does renewal work actually start by class?
16. What are the top five reasons clients leave?
17. How much expected commission sits in renewals with no client response or insurer terms?
Risk and evidence
18. How often do client lists disagree with policy schedules?
19. How many policy documents arrive later than 14 days?
20. How many active policies lack clear written client instruction?
21. Which compliance failures have caused complaints, penalties or professional indemnity notifications?
Brokerage structure
22. Do Kenyan brokers commonly charge separate client fees, and for which services?
23. How are commissions shared with agents, introducers or account executives?
24. How much capital is tied up in guarantees, deposits and receivables?
25. How different are economics between corporate, SME, retail, medical, life and specialist brokers?


<<PAGE 37>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
37
SECTION 21
21. Final Economic State Machine Diagram
CLIENT RISK OR EXPIRY →
BROKER ACCEPTS WORK →
FACTS AND EVIDENCE
READY
→
INSURERS RESPOND
CLIENT CHOOSES
→
PREMIUM REACHES
INSURER
→
COVER IS PROVED
→
POLICY IS SERVICED
COMMISSION IS
COLLECTED
→
RENEW OR EXIT
→
ECONOMIC CLOSURE
The most important exception loops


<<PAGE 38>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
38
Missing or conflicting facts
-> return to client
-> correct risk information
No usable insurer terms
-> improve submission or change market
-> new terms
Premium missing
-> cover cannot safely proceed
-> confirm payment or change inception
Wrong or late policy evidence
-> insurer correction
-> verified schedule and delivery
Claim, endorsement, certificate or complaint
-> more service cost
-> resolved active-policy state
Commission missing or wrong
-> match premium, policy, rate, tax and bank
-> collect or dispute
Renewal delayed or lost
-> future commission disappears
-> win-back, replacement client, or closure
The economic truth in one sentence
A Kenyan insurance broker turns client trust, risk information, insurer access and staff work into placed
cover; that cover becomes profitable only when commission is collected, service cost stays controlled,
evidence is correct, and the client renews.


<<PAGE 39>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
39
REFERENCE
Sources
[S1] Insurance Regulatory Authority, Insurance Industry Annual Report 2024. https://ira.go.ke/resource/insurance-industry-annual-report-2024/
[S2] Insurance Regulatory Authority, Quarter 4 2025 Industry Release. https://ira.go.ke/lib.html?f=quarter-4-2025-industry-release
[S3] Kenya Law, Insurance Act, Cap. 487, especially sections on brokers, commission and advance payment of premium.
https://new.kenyalaw.org/akn/ke/act/1985/1/eng@2023-09-15
[S4] Kenya Law, The Insurance Regulations, especially Regulation 22 and the Eleventh Schedule.
https://new.kenyalaw.org/akn/ke/act/ln/1986/312/eng@2022-12-31
[S5] Kenya Law, Insurance (Market Conduct) Guidelines, 2022. https://new.kenyalaw.org/akn/ke/act/gn/2022/3642/eng@2022-03-29
[S6] Kenya Law, Insurance (Claims Management) Guidelines, 2022. https://new.kenyalaw.org/akn/ke/act/gn/2022/3638/eng@2022-03-29
[S7] Insurance Regulatory Authority, Registration Requirements for Insurance Brokers, Reinsurance Brokers and Medical Insurance Providers.
https://www.ira.go.ke/1002/registration-requirements-brokers-mips/
[S8] Kenya Revenue Authority, Withholding Tax, including insurance commission rates.
https://www.kra.go.ke/individual/filing-paying/types-of-taxes/individual-withholding-tax
[S9] Association of Insurance Brokers of Kenya, description of the broker's role. https://aibk.co.ke/
[S10] Kenya Law, Association of Insurance Brokers of Kenya v Cabinet Secretary for National Treasury & Planning, Petition 288 of 2019, 2021.
https://new.kenyalaw.org/akn/ke/judgment/kehc/2021/451/eng@2021-07-29
[S11] Cytonn Research, Kenya Listed Insurance FY 2024 Report, summarising IRA data. https://cytonnreport.com/topicals/kenya-listed-insurance-3
[S12] Business Daily Africa, Insurance brokers eye first pay rise in 30 years, summary of common commission limits.
https://www.businessdailyafrica.com/bd/markets/market-news/insurance-brokers-eye-first-pay-rise-in-30-years-2147652
[S13] Association of Kenya Insurers, Insurance Market Survey 2024.
https://www.akinsure.com/content/uploads/documents/AKI_Insurance_Market_Survey_2024_Final.pdf
[S14] Insurance Regulatory Authority, Licensed Insurance Brokers 2025. https://www.ira.go.ke/resource/ira-licensed-insurers-and-intermediaries-2025/
[S15] Kenya Law, Insurance Act, section 203, and related claims decisions explaining the 90-day rule after relevant documents are submitted.
https://new.kenyalaw.org/akn/ke/act/1985/1/eng@2023-09-15
[S16] Kenya Law, Saham Assurance Company Limited v Mburu, 2025, description of the broker's intermediary role.
https://new.kenyalaw.org/akn/ke/judgment/kehc/2025/1039/eng@2025-03-04
[S17] International Monetary Fund, Implementing Risk-Based Solvency for Insurers, 2024, Kenyan distribution-channel data.
https://www.imf.org/en/Publications/WP/Issues/2024/11/15/Implementing-Risk-Based-Solvency-for-Insurers-557372
[S18] Public industry reporting on Kenya's 2023 distribution mix; validate against the underlying IRA annual report before commercial use.


<<PAGE 40>>
ASAP | Kenyan Insurance Brokerages Economic State Machine
40
Research conclusion
This state machine is strong enough to explain how Kenyan brokerage work turns into commission and cash, where staff cost builds, and
where value gets trapped. The next step should be operator validation with several Kenyan brokerages before any later intent, skill,
workflow, or product-design exercise.

```
