# ASAP — Space and Screen Map (v1, 6 September 2026)

> Converted from the PDF for the repository. This is the detailed catalogue. **Screen Map v3 overrides this document wherever they disagree** — in particular the shell (three destinations, not four), the status vocabulary, the H03/S16 merge, and Jobs becoming an Activity chip. Read v3 first; use this for the per-screen ten-question entries, the component table, the skill coverage and the master list.

ASAP / PRODUCT DESIGN REFERENCE

                                      Space and
                                     Screen Map
                                  What each screen shows.
                                   What every action does.
                                  Where the work goes next.

                          49 surfaces | 163 named skills | One simple shell

                              Based on the supplied economic state machine
                                    and insurance intent and skill map.

                                                 6 September 2026
                                Design specification for review and implementation

How to use this map
This is a product specification, not a claim that a deployed app already implements it. It covers the two
supplied documents and the agreed ASAP interaction model. It does not inspect a current codebase or
remove legacy functions. Before release, compare this map with the existing app and add any older
capability that the two sources omit.

The map defines 49 named surfaces: permanent destinations, generated Space recipes, focused
variants, dialogs and settings details. This does not mean 49 items in a menu. TOR, endorsement and
certificate are detailed variants of one Servicing recipe. Source, approval and assignment panels are
shared everywhere.

All 163 named skills in the supplied Intent & Skill Map have at least one screen/action path. Each
catalogue entry answers the requested ten questions. Button lists include the controls unique to that
screen; the common controls and state rules below also apply. Hidden, disabled and error states must
be built, not just the happy path.

Source [E]: ASAP_Kenyan_Insurance_Brokerages_Economic_State_Machine(4).pdf, dated 5 September
2026. Main references: sections 3, 6-15, 17-20. Source [I]: ASAP Insurance Intent & Skill Map(2).pdf, all
four pages. Screen layouts and controls are proposed design decisions derived from those sources, not
quotations from them.

Use the catalogue as a reference. For a first review, follow the employee journey, then check the 49-
screen master list and the open decisions at the end. Screen IDs such as S11 are links between
specifications, not labels to show to brokers.

The main idea
ASAP understands what the person wants, checks the current business facts, prepares the right work
and shows the simplest useful Space. A known blockage can also produce a Discover suggestion.
Preparation may be automatic; consequential actions stay under the company's approval rules.

The economic unit is one client-policy-year: one policy for one client for one cover period. Show that
period when it matters. An opportunity can contain several proposed policies, and a client can contain
many active and historical periods. Never combine all of those into one misleading progress bar.

## Part 1. The rules every screen follows

Permanent shell
Only four primary destinations: Discover, Spaces, Jobs and Automations. Below them are + New and
Search. Profile / Company sits at the bottom. Insurance objects appear inside Spaces, never as primary
menu entries. Ask ASAP is persistent, not a fifth page.

Desktop: a quiet labelled sidebar and one main work area. Persistent Ask sits near the work area bottom
without covering content. Source and approval panels open only when called. No permanent chatbot
sidebar. On mobile, Discover, Spaces and Jobs stay easy to reach; a More sheet holds Automations, +
New, Search and Profile. Ask remains within reach.

One clear next action
Each Space starts with a readable title, client/period, plain status, one short explanation and one
primary button. At most two secondary controls sit beside it. All other catalogue actions live in the
relevant card or a labelled More menu. Listing many possible actions in this document does not mean
showing them all at once.

Use short summaries, checklists for missing facts, timelines for progress and comparisons for choices.
Default collections show a short useful set and View all. No ten-tab records, tiny tables, unexplained
technical labels or invented success numbers. Detailed fields appear only for the current task.

Context and Space identity
Keep company, user permissions, client, policy-year, claim, selected records, task and thread attached to
the current request. Show a small context chip so the user can change scope. Clearing the chip changes
the question scope, not record ownership. Ask for a choice when a name or policy period is ambiguous.

Same task plus a new question changes the current view. A different task creates or resumes a related
Space. Repeated requests for the same task and period reuse the existing Space unless the person
explicitly creates a new version. The server checks permissions on reads, searches, generated summaries
and actions.

Back restores the previous Space view, filters, selection and scroll position. Closing a drawer restores
focus to its trigger. Browser Back and direct links work. Only one primary overlay is open; a source
preview inside an approval returns to that approval rather than stacking endless dialogs.

Four different kinds of status
Space status describes the human's task: Active means it can move; Waiting means the next step
depends on someone else; Work means a person has a decision or action; Completed means this task's

exit checks passed. If Work and Waiting coexist, the summary says Work and explains the outside
dependency below it. Pinned and Recent are navigation views, not completion states.

Job status describes an ASAP run: Running, Waiting externally, Work, Completed, Failed or Cancelled.
Job completion names the actual result, such as Renewal pack prepared. It never claims the policy
renewed, the insurer accepted a claim, or the money arrived just because preparation finished.

Insurance status comes from supporting business evidence: draft request, client chosen, submitted,
confirmed, active, expired or cancelled. Money has its own state. The UI may show Cover active;
commission outstanding; claim waiting at the same time.

Completing a Work item, completing a Space, completing a Job and economically closing a policy-year
are separate actions. S20 checks economic closure. A new claim or adjustment after closure flags that
period and reopens the relevant work with history intact.

Common button contract
Ask opens H02 in place. Search opens H04. + New opens H05. Profile opens C01. More opens a small
labelled action menu and closes after selection. View all expands the current collection without changing
scope. A record chip opens its relevant Space and keeps a return link. Source opens X02. Assign opens
X04. Share opens X05. History opens the scoped C05 view.

Pin/Unpin changes the user's saved navigation. Rename changes a permitted Space title, not the
underlying client name. Refresh updates data with a new time stamp. Complete checks the task
outcome; Reopen records a reason. Help shows short task guidance in place, not an empty support
button.

Close, Escape and Cancel never approve or execute. Unsaved edits show Save draft, Discard and Keep
editing. Save draft validates storage, not the insurance outcome. Back preserves saved work. Destructive
actions name exact targets and explain what remains recoverable. Retry uses the existing request
identity and retries only failed steps. Disabled buttons explain what is missing beside the control.

AI preparation and human control
ASAP may read allowed data, extract fields, propose links, compare records, draft documents and create
safe internal work. No repeated confirmations for harmless searches or formatting changes. It must not
invent missing records, cover, payment, client decisions or insurer acceptance.

Default rollout: prepare drafts and let humans send externally. Preserve the skill map's human-approved
sending capability as an explicit company option only when a supported connector exists. Use Open in
email / Copy draft in manual mode. In connected approved-send mode, use Review and send through
X01. Do not silently enable autonomous external messages. No shadow-mode screen is included.

Insurer selection needs the client's actual instruction. Cover or endorsement confirmation needs valid
insurer evidence. Financial posting and reversals need the authorised finance role. Software approval
never substitutes for a client's decision, an insurer's underwriting decision or a bank's payment
confirmation.

Shared states and recovery
Loading: keep the shell stable and show the actual step, scope and Stop where cancellation is safe. Long
work becomes a Job so the person can leave. Use step counts only when known.

Empty: explain why nothing appears and offer one useful next step. New companies see setup quick
actions, not sample business presented as real records. Sample data, if used in a prototype, is visibly
marked and separate.

Waiting: name the outside party, what is expected, when waiting began, the last follow-up and next
check. Prepare follow-up creates a draft. Changing a next-check date never hides a policy expiry or
resets a legal clock.

Missing data: show a short checklist with Add, Request information or Enter manually. Conflicting data:
open X03 with the alternatives and sources. Distinguish Unknown, Not applicable and Confirmed
missing.

Failed: explain what failed, what succeeded and whether anything changed. Offer retry, reconnect or
manual handoff. Unknown execution outcome must be checked before repeating. Partial import,
posting and assignment failures are itemised.

Stale data: show last successful update and affected scope. New evidence invalidates dependent
approvals if material. Permission denied: explain safely and preserve navigation; never expose restricted
snippets, counts or previous-company context.

All material facts can open Source. Show source, date/version, exact location and uncertainty. Use plain
labels such as Source confirmed, Check this value or Not enough information; do not present
uncalibrated confidence percentages as guarantees.

Desktop, mobile and access
Proposed UI tokens: readable 16px body text, 24-32px headings, controls around 44px high, strong text
contrast, restrained colour, generous spacing and clear focus rings. Do not use colour alone to explain
status. All actions must work by keyboard with announced validation and loading updates.

Mobile uses one column, full-height sheets instead of side drawers, and a sticky primary action above
the keyboard. Quote comparison chooses two options and stacks differences; large evidence/table
views may expand to full screen. Never hide essential approval evidence or financial totals merely to fit
mobile.

No automatic mutation when offline. Show read-only saved content with a freshness label where
company policy allows caching. Save drafts only when safely supported; do not claim a server save until
it is confirmed.

Economic safeguards that affect design
Source [E] itself says operational and money progress are separate. Do not implement its illustrated S0-
S13 path as a single mandatory sequential wizard: commission may arrive during active service; renewal
may start before old commission or claims close.

There is an accounting inconsistency in [E]: its opening profit equation deducts withholding tax, but its
later explanation treats that amount as a tax credit. For product design, show gross commission,
deductions, net cash and tax-credit evidence separately. Do not classify withholding tax as an operating
cost without an accountant-approved basis. No rates or legal deadlines are hardcoded by this map.

Rule source, effective date, scope and start/stop events belong in C06. This design maps the supplied
documents; it is not a fresh legal or tax review. TOR follows the source's Time on Risk wording
provisionally, and must be confirmed with the brokerage before final form design.

## Part 2. Screen catalogue
Each entry uses the same ten questions. The status and common-control rules in Part 1 apply to every
screen. The named button paths below are the complete proposed action contract for this map;
additional actions from a legacy app need a documented path before migration.

### O01 — Sign in and regain access
Surface: Full screen
1. Purpose: Let a person enter the right company safely, without a long setup form.
2. How to reach it: First visit, invitation link, signed-out session, or expired session.
3. State or intent: Access intent; no policy-year is created.
4. What appears: ASAP logo, one welcome line, work-email field and sign-in options. Verification code
and recovery appear in the same card only when required.
5. What ASAP prepares: Nothing involving insurance data. Remember the intended destination, not an
unverified company identity.
6. Human decision: Choose a sign-in method; complete verification and any required company security
check.
7. Buttons and actions:
    Continue with Google / Microsoft: Open secure provider sign-in; success returns here and checks
     company membership.
    Send sign-in link: Validate email; show a check-your-email state. Do not reveal whether another
     person has an account.
    Verify / Resend / Change email: Check the code, resend after a visible cooldown, or return to the
     email field.
    Use another method / Back: Return to the sign-in card without clearing the saved destination.
8. Opens, closes and changes: An existing single-company member goes to H01 or their permitted deep
link. Multiple memberships open O02. An invited user confirms the invitation in O02.
9. Waiting, errors and evidence: Expired link: request another. Lost access: show company
contact/support guidance. Offline: explain and retry. Never display cached company records before
access is verified.
10. What happens next: Company access is established, or the user remains on a clear recoverable sign-
in step.

### O02 — Choose or create a company
Surface: Full screen
1. Purpose: Put the user inside the correct brokerage with the correct role.
2. How to reach it: O01 when company selection or creation is needed; company switch from C01.

3. State or intent: Setup intent; company membership is separate from insurance records.
4. What appears: Available companies or the invited company. New-company form: company name,
brokerage/agency type, country, timezone and currency; Kenya defaults are suggestions.
5. What ASAP prepares: Prefill only verified identity details. Carry the invited role; do not let a new
member grant themselves admin access.
6. Human decision: Accept a valid invitation, select an existing company, or confirm a new workspace.
7. Buttons and actions:
    Open company: Enter the selected permitted company and load H01.
    Accept invitation: Show company and role, then confirm membership and open H01.
    Create company: Open the short form; Create validates and saves once, then opens H01.
    Request access: Prepare a request to the known company admin; submitting it leaves
     membership pending.
    Back / Sign out: Return to O01 without creating a company.
8. Opens, closes and changes: Successful setup ends onboarding immediately at H01. Import and email
connection are optional next steps on Discover, not gates to using ASAP.
9. Waiting, errors and evidence: Pending invitation shows its status and refresh action. Duplicate
company names require a choice, never an automatic merge. Switching company clears the previous
company context.
10. What happens next: Discover opens with Add records and Connect email quick actions, or the user
sees a pending-access explanation.

### O03 — Add files or paste information
Surface: Dialog; full screen on mobile
1. Purpose: Use one entry for a single record or a large mixed batch.
2. How to reach it: H01 Add records; H05 Upload something; attachment control in H02 or any Space.
3. State or intent: document.classify and document.extract; may support any economic state.
4. What appears: Drop zone, file picker, paste area and optional client/Space context. Show accepted
formats and current size limits before upload. Proposed formats: PDF, images, CSV, Excel, Word and
saved email.
5. What ASAP prepares: Check file safety and readability, classify contents, find possible existing records
and start J02 for background extraction.
6. Human decision: Choose files or paste text; confirm scope if the content seems unrelated to the open
Space.
7. Buttons and actions:
    Choose files / Paste text: Open the device picker or paste field; add items to the batch.
    Remove: Remove an unsubmitted item; a started item asks whether to stop that item.
    Continue: Upload once, create a batch Job and open O04 when preview data is ready.

    Add manually: Open X06 with the current context.
    Close: Before submission, discard the local selection only after confirmation; after submission,
     leave the Job running.
8. Opens, closes and changes: O04 replaces the dialog with a review Space. Files remain drafts until
review confirms record changes. Leaving the upload does not create duplicate Jobs.
9. Waiting, errors and evidence: Unsupported or encrypted file: explain and offer a supported
copy/manual entry. Failed files are separate from successful ones. Potential duplicates remain
suggestions.
10. What happens next: Review extracted records, or follow the batch Job from J01.

### O04 — Review an import
Surface: Persistent review Space
1. Purpose: Let people check important exceptions without retyping every record.
2. How to reach it: O03, a completed extraction Job, or Resume import on H01.
3. State or intent: Information becomes usable at S3 or is linked to an existing policy-year; import alone
does not prove cover or payment.
4. What appears: Counts for Ready, Check and Failed; short preview; extracted fields beside source;
proposed create/update/link actions. Advanced column mapping is collapsed for CSV/Excel.
5. What ASAP prepares: Match columns, group documents, propose client-policy links and flag
uncertain values, duplicates and conflicting versions.
6. Human decision: Resolve uncertain identities, material values and duplicate choices; confirm what
will be saved.
7. Buttons and actions:
    Review item / Open source: Open X03 for a conflict or X02 for its source; closing returns to the
     same row.
    Map columns / Change type: Edit the mapping or record type and refresh the preview without
     posting records.
    Use existing / Create separately / Skip: Choose a duplicate outcome for that item; preserve the
     decision.
    Save ready items: Show counts and proposed changes, then commit eligible items once.
     Unresolved items remain here.
    Retry failed / Download issues: Retry only failed items or export their error list.
    Undo import: Preview a reversal; allow only unchanged records with no downstream use,
     otherwise open X03 for review.
8. Opens, closes and changes: Successful items open their Client, Policy or other Space. The review stays
searchable for remaining items; its saved status and audit link remain visible.

9. Waiting, errors and evidence: Partial success is explicit. A later edit invalidates the affected preview.
Originals stay available. Permission-denied items cannot be committed through a bulk action.
10. What happens next: H01 replaces the setup card with real work based only on confirmed data.

### O05 — Connect email
Surface: Connection dialog
1. Purpose: Let ASAP read selected business email and prepare work with clear consent.
2. How to reach it: H01 Connect email, H02 when email is needed, or C01 Connections.
3. State or intent: Email retrieval intent; never treated as authority to send.
4. What appears: Google, Microsoft and supported IMAP choices; mailbox identity, folders, history
range, shared-mailbox access and plain-language permissions.
5. What ASAP prepares: Explain what will be read and who can see linked results. Default to read access
and draft preparation; sending is a separate permission.
6. Human decision: Choose the mailbox and approved data scope; finish provider consent.
7. Buttons and actions:
    Connect Google / Microsoft: Open provider consent; return here with the actual permission
     result.
    Connect IMAP: Show server/account fields for an approved connector; test securely without
     exposing saved credentials.
    Choose folders / History range: Set what can be indexed before first sync.
    Start sync: Save scope and open O06 with a sync Job.
    Not now / Close: Return to the invoking screen; email-based work stays unavailable, not
     fabricated.
8. Opens, closes and changes: The connection dialog closes after consent; O06 opens. Existing mailbox
connections are reused instead of duplicated.
9. Waiting, errors and evidence: Admin consent required: explain who must approve. Revoked
permission, unsupported provider or cancelled consent never looks connected. Reconnect preserves
approved scope for review.
10. What happens next: O06 shows progress and the first safely linked email results.

### O06 — Connection status and sync review
Surface: Settings detail with Job link
1. Purpose: Show what data ASAP has actually read and what still needs checking.
2. How to reach it: O05, C01 Connections, or a stale-data warning.
3. State or intent: Email classification and record matching; evidence freshness for all states.

4. What appears: Mailbox, last successful sync, approved folders, progress, linked/unmatched counts
and errors. No unearned success checkmark.
5. What ASAP prepares: Classify mail, propose record links and create internal Work for unresolved
items. Avoid importing the same message twice.
6. Human decision: Resolve unclear matches and control the connection scope.
7. Buttons and actions:
    Review unmatched: Open S15 filtered to unresolved messages; linking uses X03 or the record
     picker.
    View Job: Open J02; closing returns to connection status.
    Sync now / Retry: Request one incremental run or retry only the failed scope.
    Edit scope / Reconnect: Return to O05 with current settings for review.
    Pause / Resume: Stop or restart future sync; keep existing records and disclose that they may be
     stale.
    Disconnect: Confirm lost access and affected Jobs; stop new reads. Data removal is a separate C03
     decision.
8. Opens, closes and changes: New evidence refreshes linked Spaces and H01. Suspected links do not
silently become confirmed facts.
9. Waiting, errors and evidence: Partial sync shows exact scope and last update time. Network failure
keeps saved data readable with a stale label. Restricted mailbox content never leaks through
summaries.
10. What happens next: User returns to H01 while sync continues; the setup step is complete only when
connection is verified.

### H01 — Discover, including first use
Surface: Permanent destination
1. Purpose: Answer: What matters now? Present the clearest next action, not a wall of numbers.
2. How to reach it: After sign-in/setup; Discover in the shell; returning to the product.
3. State or intent: Priority and exception signals across S0-S13 and M0-M8, filtered by role and access.
4. What appears: Greeting, persistent Ask field, up to five priority cards, one optional pattern and View
all work. First-use state replaces real cards with Add records, Connect email and Try a sample question.
5. What ASAP prepares: Rank verified deadlines, unresolved decisions, missing evidence and trapped
commission. Explain the reason; label incomplete data. Do not use only premium size to rank.
6. Human decision: Choose a priority or state a different goal.
7. Buttons and actions:
    Continue / Review: Open the existing related Space at its blocker, not its generic overview.
    Why this matters: Expand deadline, evidence, impact and owner inline.
    View all work: Open S16 with the same scope.

    Investigate: Open S18 with the observation and underlying records.
    Add records / Connect email: Open O03 / O05; optional setup never blocks Discover.
    Try a sample question: Put an example into H02 without inventing business data.
8. Opens, closes and changes: Actions refresh the affected card. A resolved card leaves the priority list
but stays in history. All-clear is shown only when current data supports it.
9. Waiting, errors and evidence: No data: guided quick actions. Stale/partial data: show scope warning.
No urgent items: show recent Spaces and quiet next steps. No autoplay tour or fictional KPIs.
10. What happens next: User starts work in context and can return to the same list position.

### H02 — Ask ASAP
Surface: Persistent composer and expandable answer panel
1. Purpose: Let users express a goal without learning the menu.
2. How to reach it: Composer everywhere, Ctrl/Cmd+J, suggested question or a Space follow-up.
3. State or intent: All universal intent types. Context includes company, permitted records, current
Space, selection and prior turns.
4. What appears: Short input, attach control, visible context chip, concise answer or proposed Space.
Show the interpreted client/period when ambiguous.
5. What ASAP prepares: Retrieve permitted evidence, choose skills, answer simple questions directly
and compose task views from approved components.
6. Human decision: Clarify an ambiguous client, period or goal. Approve consequential changes
separately in X01.
7. Buttons and actions:
    Ask / Enter: Submit once; show what is being checked and Stop while running.
    Attach: Open O03 without losing the question.
    Context chip: Change or clear scope; show the new scope before rerunning.
    Choose match: Resolve ambiguity and continue the same request.
    Open Space / Save as Space: Open a prepared task Space or save a useful answer with its
     evidence.
    Stop / Retry: Stop generation, not completed business actions; retry reuses saved progress.
    Close / Escape: Collapse the panel; preserve the thread and return focus to the composer.
8. Opens, closes and changes: A simple answer stays in place. Same task changes the current Space
view. A new task creates or resumes a linked Space; H03 retains it. Slow multi-step preparation creates
J02.
9. Waiting, errors and evidence: No answer found: say what was searched and offer upload or a
narrower question. Conflicting evidence opens X03. Partial results never imply full completion.
10. What happens next: An answer, updated Space, linked task or visible Job, always with a next action
where useful.

### H03 — Spaces library and lifecycle
Surface: Permanent destination
1. Purpose: Find ongoing and past work without navigating insurance modules.
2. How to reach it: Spaces in the shell; Back to Spaces; Open saved Space.
3. State or intent: Resume intent across all economic states. A Space is a saved task context, not a new
copy of a policy.
4. What appears: Recent cards with title, client/period, owner, status and next step. Filters: Active,
Waiting, Work, Completed; Pinned and Recent are views, not business states.
5. What ASAP prepares: Name and save task Spaces, group related work and keep their evidence links
current.
6. Human decision: Resume, pin, rename, share or close work when its checks pass.
7. Buttons and actions:
    Open card: Resume its last meaningful view, selection and thread.
    Filter / Search Spaces: Narrow visible cards without changing the records.
    Pin / Unpin / Rename: Update personal pin or permitted title; no policy changes.
    Share: Open X05.
    Complete Space: Check the task-specific exit conditions; unresolved items are shown, not silently
     closed.
    Reopen: Record a reason; change Completed to Active and preserve history.
8. Opens, closes and changes: Work means a person has a decision/action. Waiting means an outside
dependency blocks the next step. Active means work can proceed. Status priority and independent
blockers are defined in Part 1.
9. Waiting, errors and evidence: No Spaces: offer Ask ASAP and Add records. Removed access: show an
access notice, not cached details. A completed Space can still link to an active policy or another open
task.
10. What happens next: The same task is resumed; a second click cannot create a duplicate Space.

### H04 — Global search and saved search
Surface: Overlay; optional Search Space
1. Purpose: Locate records and evidence directly, with useful context.
2. How to reach it: Search in shell, Ctrl/Cmd+K, or Find from a Space.
3. State or intent: Find intent across records, documents, email and relationships.
4. What appears: Search field, grouped results, concise context, source/date and optional filters. Results
can include vehicles, contacts, insurers, payments, invoices, Spaces and Jobs.
5. What ASAP prepares: Combine exact matches and meaning-based retrieval; respect company and
record permissions before ranking or summarising.

6. Human decision: Select a match or narrow the query.
7. Buttons and actions:
      Search: Run with visible scope; show result groups and matched evidence.
      Result: Open the corresponding Space or X02 source directly.
      Filters / Clear: Adjust date, type or scope; refresh results.
      Show relationships / Timeline: Compose a related-record or event view in the Search Space.
      Save search: Save a persistent query Space in H03; does not freeze results.
      Ask about results: Open H02 with explicit selected-result context.
      Close: Return to the exact prior screen and scroll position.
8. Opens, closes and changes: An insurer result opens a contextual report/relationship view, not a new
primary module. A contact or vehicle opens its parent Space with that object focused.
9. Waiting, errors and evidence: No results: show scope and suggest spelling/upload. More than one
Acme: ask which. Unavailable sources show their last sync time. Counts must not expose restricted
records.
10. What happens next: User lands on the useful view without passing through a module index.

### H05 — + New
Surface: Small chooser
1. Purpose: Provide a simple manual route without making a giant menu.
2. How to reach it: + New in shell, or a contextual New action in a Space.
3. State or intent: Create and ingestion intents; context is shown before reuse.
4. What appears: Upload something, Tell ASAP, and Create manually. Manual options expand only on
request.
5. What ASAP prepares: Carry the current client and period as suggestions, never as hidden
assumptions.
6. Human decision: Choose an input route.
7. Buttons and actions:
    Upload something: Close chooser and open O03.
    Tell ASAP: Close chooser and focus H02 with current context.
    Create manually: Expand client, opportunity/quote, policy, claim, servicing request, payment,
     invoice, contact or internal work; choosing one opens X06.
    Close / Escape: Dismiss without creating anything.
8. Opens, closes and changes: Only one overlay remains open. A new record opens its appropriate
Space after save; previews are not final records.
9. Waiting, errors and evidence: Unavailable record types are hidden by role. If a known duplicate
exists, X06 requires a choice. No empty placeholder record is created by merely opening the chooser.
10. What happens next: O03, H02 or X06 provides the next step.

### S01 — Client Space
Surface: Living Space
1. Purpose: Understand one client without opening separate modules.
2. How to reach it: Search result, related client chip, Ask Find Acme, or saved Space.
3. State or intent: Client summary, relationship and ownership intents; contains many policy-years, not
one combined policy state.
4. What appears: ClientHeader, owner and contact, short relationship summary, important
policy/claim/money items and recent activity. Policy periods are always visible.
5. What ASAP prepares: Summarise permitted records, link ongoing opportunities and surface the most
important blocker.
6. Human decision: Confirm client facts, ownership and the specific task to progress.
7. Buttons and actions:
    Show policies / Claims / Opportunities / Balance: Replace the centre view with that scoped
     collection; no permanent tab row.
    Open item: Open its linked Space with client context and Back to client.
    Edit details / Add contact: Open X06; save updates safe internal fields or routes material changes
     to X01.
    Assign owner: Open X04 for a permitted owner change.
    Show history: Replace summary with sourced relationship timeline.
    Prepare renewal / New quote: Open S11 for the chosen expiring policy or S02 for a new
     opportunity.
8. Opens, closes and changes: Follow-up Show only policies expiring this year changes this view. Renew
this motor policy creates/resumes a linked S11 without replacing client history.
9. Waiting, errors and evidence: Missing identity or duplicate client: X03. No policies: offer O03/X06.
Restricted money or claim data is omitted with a role-appropriate explanation.
10. What happens next: Work continues in a focused task while the Client Space remains available.

### S02 — Opportunity and Quote Space
Surface: Living Space
1. Purpose: Turn a real client need into clear insurer options without repeating data entry.
2. How to reach it: Ask Get this quote ready; S15 Create opportunity; H05; S01 New quote.
3. State or intent: S0-S5: risk need, qualification, mandate, facts, insurer approach and usable terms.
4. What appears: Client/risk/period header, mandate and readiness checks, insurer response tracker,
quote cards and one next action. Lead, tender and multi-policy request are modes of this recipe.
5. What ASAP prepares: Extract risk facts, check requirements, suggest eligible insurers, prepare
request packs, extract returned terms and draft follow-ups.

6. Human decision: Decide whether to pursue; confirm client mandate, risk facts, insurer shortlist and
recommendation.
7. Buttons and actions:
    Accept opportunity / Decline: Record pursuit and owner, or open S20 with no-bid reason.
    Add mandate / Add missing information: Open O03 or X06; return to the readiness check.
    Choose insurers: Open a scoped shortlist with appetite/appointment evidence; Save updates the
     proposed market list.
    Prepare requests / Follow up: Create S15 drafts; sending follows X01.
    Add terms / Record response: Open O03/S14 or capture declined/pending terms with evidence.
    Compare / Prepare presentation: Open S03 or build a versioned client document in S14.
    Record client choice: Open X01 with client instruction evidence; accepted choice links S04.
8. Opens, closes and changes: S3 to S4 requires a recorded submission, not a drafted email. S5 requires
usable terms, not just any insurer reply. Multi-policy tender items keep separate premium and coverage
decisions.
9. Waiting, errors and evidence: Missing facts: checklist. No terms: Waiting with insurer and date.
Expired/incomparable terms: blocked selection and request correction. Lost quote: S20 keeps pursuit
cost.
10. What happens next: Client-ready comparison or a clearly owned dependency; placement starts only
with a recorded choice.

### S03 — Quote and cover comparison
Surface: Space recipe or view within Quote/Renewal
1. Purpose: Help a person make an informed choice, not simply pick the lowest price.
2. How to reach it: S02 Compare, S11 Compare terms, or Ask Compare these quotations.
3. State or intent: S5-S6; compare premium, cover, exclusions, excesses and conditions.
4. What appears: Two or three selected options, common coverage rows, highlighted differences,
missing terms, quote validity and a short evidence-backed recommendation. Expand to see all rows.
5. What ASAP prepares: Normalise comparable terms, calculate changes and separate price changes
from changed cover. Flag limits to the comparison.
6. Human decision: Choose what to recommend; record what the client actually chose.
7. Buttons and actions:
    Change options / Show all differences: Update the compared set or expand rows without leaving
     context.
    Why this changed / Source: Expand explanation or open X02 on the exact quote field.
    Request clarification: Open a S15 draft for missing insurer terms.
    Prepare recommendation: Open a versioned presentation in S14 for review.
    Record client choice: Open X01 requiring the selected quote version and client instruction.
    Back to quote / renewal: Restore the prior task view and selected records.

8. Opens, closes and changes: A follow-up Why did APA increase the premium? morphs this view to
change explanation and evidence. Approval creates/resumes S04 for the chosen option; other quotes
stay in history.
9. Waiting, errors and evidence: Missing coverage is Unknown, never zero or equivalent. Invalid quote
blocks selection. Price-only recommendation is labelled incomplete. New quote version invalidates an
older pending approval.
10. What happens next: Verified client instruction moves placement forward; a prepared
recommendation alone does not.

### S04 — Placement and underwriting
Surface: Living Space
1. Purpose: Show what must be true before cover and final documents can be trusted.
2. How to reach it: Accepted client choice, S11 Prepare placement, Ask What is blocking issuance?
3. State or intent: S6-S9: client instruction, payment condition, cover confirmation and correct delivered
documents.
4. What appears: Chosen terms, client approval source, underwriting requirements, premium status,
insurer confirmation and document checklist. Each has a separate status.
5. What ASAP prepares: Prepare submission, organise underwriting queries, compare insurer
confirmation to chosen terms and check issuance evidence.
6. Human decision: Review submission; resolve material queries; confirm evidence supplied by the
client and insurer.
7. Buttons and actions:
    Review submission: Open S14; request submission through S15/X01.
    Resolve requirement / Record terms: Open X06 or X03; changed terms return to S03 and require
     fresh client instruction.
    Record premium evidence: Open S12/X06; an uploaded bank slip stays unverified until matched
     to insurer receipt or approved payment condition.
    Record insurer confirmation: Open X01 with exact cover, dates and source; no self-issued cover
     assumption.
    Check policy documents: Open S14 comparison against selected terms.
    Record delivery: Attach actual delivery/acknowledgement evidence, not a send-click assumption.
    Open policy / Follow up: Open S05 or prepare the targeted S15 draft.
8. Opens, closes and changes: Internal approval permits a submission, not insurer acceptance. Economic
state S8 advances only on valid insurer evidence. Policy issuance and commission may progress
independently.

9. Waiting, errors and evidence: Unpaid or unverified premium, expired quote or changed underwriting
term prevents false Active cover. Late issuance creates Waiting with named insurer contact and clock
source.
10. What happens next: S05 holds confirmed policy facts; S12/S13 track commission and S16 retains any
document-delivery work.

### S05 — Policy Space
Surface: Living Space
1. Purpose: Explain the cover and show whether the documents, money and service work are healthy.
2. How to reach it: Search, S01 policy item, S04, or Ask Is this vehicle covered?
3. State or intent: S8-S13; coverage, item check, parties, history, expiry and version comparison.
4. What appears: PolicyHeader with client, insurer, policy number and period; source-backed cover
summary; schedule; next important item. Money, service and renewal indicators stay distinct.
5. What ASAP prepares: Summarise the policy, retrieve exact clauses, identify insured items and
compare versions without inventing cover.
6. Human decision: Check disputed terms, confirm evidence and start a service or renewal task.
7. Buttons and actions:
    Open schedule / Documents: Open X02 for a quick read or S14 for extraction/review.
    Check an item: Focus H02 with this policy and the item query; show result plus source.
    Show cover / Parties / History: Morph the centre into the requested table, party cards or
     timeline.
    Compare versions: Open a S14 comparison with version dates preserved.
    Request change / Get certificate / Prepare TOR: Open S06, S09 or S07 linked to the correct policy
     period.
    Register claim / Renew: Open S10 / S11.
    Review money / Close policy-year: Open S12 / S20; close is not cancellation.
8. Opens, closes and changes: Service requests are linked tasks. New confirmed endorsements create
new policy versions; they never overwrite old evidence.
9. Waiting, errors and evidence: No matching item or clause: say Not found in available documents. An
outdated schedule gets a warning. A paid premium does not by itself prove the requested cover.
10. What happens next: User understands the cover or continues in a linked task without losing the
policy context.

### S06 — Servicing request
Surface: Living Space; parent recipe for S07-S09
1. Purpose: Turn a change request into an insurer-confirmed outcome.
2. How to reach it: S05 Request change; email request; Ask Add this vehicle; H05.

3. State or intent: Service loop from S10, or correction loop from S8-S9.
4. What appears: Request type, linked policy/period, requested effective date, change summary,
required documents and progress: Draft, Reviewed, Submitted, Waiting, Response received, Confirmed.
5. What ASAP prepares: Classify the request, extract details, check requirements, draft the insurer
request and compare the response.
6. Human decision: Confirm what the client requested, exact dates/values and whether the insurer
response matches.
7. Buttons and actions:
    Change request type: Switch among endorsement, TOR, certificate or amendment; preserve
     common fields and show added requirements.
    Add information / Review difference: Open O03/X06 or X03.
    Prepare insurer request: Open S15 with draft and attachments; X01 controls sending.
    Record submission / Follow up: Attach submission evidence or prepare S15 follow-up.
    Review response: Open S14/X03 showing requested versus offered change.
    Confirm update: Open X01; only accepted insurer evidence can create a new policy version.
    Complete / Cancel request: Check outcome and delivery, or open S20; neither silently cancels the
     policy.
8. Opens, closes and changes: Choosing TOR, endorsement or certificate morphs the same recipe into
S07, S08 or S09. A request is not evidence that cover changed.
9. Waiting, errors and evidence: Missing client instruction, past effective date, price difference or
rejected request is explicit. Waiting names the insurer, owner and next check date.
10. What happens next: Policy remains unchanged until confirmation; then record delivery and any
premium/commission adjustment.

### S07 — TOR preparation
Surface: Servicing variant, not a primary destination
1. Purpose: Make TOR visible and safe, with exact cover dates and supporting evidence.
2. How to reach it: Ask Prepare TOR, S05 Prepare TOR, or S06 request-type choice.
3. State or intent: Source [E] scenario 10 calls TOR Time on Risk. Confirm local product meaning in C06
before treating this as a final insurer form.
4. What appears: TOR label and full meaning, client, insurer, linked policy if any, vehicle/risk, purpose,
exact start/end date and time, timezone, insurer requirements and payment/cover status.
5. What ASAP prepares: Pull known details, flag missing dates/items and prepare the relevant request.
Do not guess a TOR rate or duration.
6. Human decision: Confirm TOR meaning, risk details, requested period, authority and insurer terms.

7. Buttons and actions:
    Confirm type / Edit period: Confirm the configured TOR meaning and dates; past or overlapping
     dates trigger review.
    Choose vehicle / Add evidence: Select an insured item or open O03/X06 for a new one.
    Prepare TOR request: Open S15 draft; X01 handles external submission.
    Record insurer response: Open S14 and compare dates, cover and amount.
    Confirm cover / Open certificate: Route evidence through X01, then open S09/X02 for an issued
     document.
    Back to service: Return to the shared request summary; preserve entered fields.
8. Opens, closes and changes: If TOR is standalone short-period cover, create a linked placement/policy
unit rather than pretending an existing policy changed. The request ID stays the same.
9. Waiting, errors and evidence: Unconfigured meaning: show clarification, not a guessed form.
Unconfirmed cover, missing payment evidence, wrong vehicle or invalid dates block final confirmation.
10. What happens next: An insurer-confirmed TOR outcome is linked to S05/S09 and money
adjustments; expiry remains visible.

### S08 — Endorsement and amendment
Surface: Servicing variant
1. Purpose: Show the exact proposed change before it affects the policy.
2. How to reach it: S06; Ask Add/remove a vehicle, transfer ownership or change insured value.
3. State or intent: S10 service loop with possible additional or return premium and commission change.
4. What appears: Before/after fields, effective date, client instruction, affected items, required evidence
and financial impact. Transfer ownership has its own parties and authority fields.
5. What ASAP prepares: Extract the requested change, compare versions, check missing requirements
and prepare a request with unchanged fields clearly separated.
6. Human decision: Confirm exact changes and the insurer response; resolve material value or identity
conflicts.
7. Buttons and actions:
    Edit changes / Add items: Open focused fields or O03 for a bulk item list.
    Resolve conflict: Open X03 beside the source values.
    Prepare endorsement request: Open S15; X01 controls submission.
    Review insurer terms: Show before/after response and additional/return premium; changed
     terms need fresh instruction.
    Apply confirmed endorsement: Open X01; create a new effective-dated policy version after
     checks pass.
    Review adjustment / Record delivery: Open S12/S13 or attach delivery evidence.
8. Opens, closes and changes: Until confirmation, S05 shows Change requested and retains current
confirmed cover. Confirmed version becomes current only at its valid effective time.

9. Waiting, errors and evidence: Partial insurer acceptance separates accepted and outstanding items.
Backdated requests, mismatched values and missing approvals block final update. Rejected items stay
unchanged.
10. What happens next: Updated policy evidence and the linked financial adjustment can finish
independently.

### S09 — Certificate request and delivery
Surface: Servicing variant
1. Purpose: Obtain the right certificate and prove it reached the intended person.
2. How to reach it: S05 Get certificate, S07 outcome, S06 or Ask Find the certificate.
3. State or intent: S9 evidence completion or S10 service; certificate preparation does not create
insurance cover.
4. What appears: Client, risk/item, policy period, certificate purpose, recipient, issuer, document status
and delivery evidence.
5. What ASAP prepares: Find an existing valid certificate or prepare an insurer request using confirmed
policy facts.
6. Human decision: Confirm recipient, item, dates and authenticity of the issued document.
7. Buttons and actions:
      Find existing: Search this policy period and open candidate evidence in X02.
      Prepare request: Open S15 for review and submission.
      Upload issued certificate: Open O03/S14 for verification and linking.
      Review / Download: Open X02 or export the verified current document if permitted.
      Prepare delivery: Open S15 with verified attachment; review recipient through X01.
      Record acknowledgement / Complete: Save actual evidence, then check request completion.
8. Opens, closes and changes: An issued certificate stays linked to the policy and original request.
Closing its viewer returns to the delivery step.
9. Waiting, errors and evidence: Expired, wrong-item or draft certificate cannot be labelled valid. No
issuer connection: prepare a request and wait; do not manufacture an official certificate.
10. What happens next: The service request completes with the issuer evidence and delivery trail.

### S10 — Claim Space
Surface: Living Space
1. Purpose: Explain the claim, what is missing, who is holding it up and the next useful action.
2. How to reach it: Email claim detection, H05, S05 or Ask What is happening with Jane's claim?
3. State or intent: Claim-support loop under the relevant policy-year, including claims reported after
policy expiry.

4. What appears: Incident summary, linked policy, insurer reference, status timeline, missing documents
and named blocker. Settlement amount, offer, acceptance and cash receipt are separate facts.
5. What ASAP prepares: Extract incident details, find candidate cover, flag uncertainty, check
documents, prepare submission and draft follow-ups.
6. Human decision: Confirm incident/policy match, review submission and record real insurer decisions
and client acceptance.
7. Buttons and actions:
    Register draft / Confirm policy: Open X06 or matching choices; record identity and loss date
     without claiming coverage is accepted.
    Check cover / Open evidence: Show relevant clauses and exclusions in X02; label as a review, not
     an insurer liability decision.
    Add documents / Prepare submission: Open O03 or S14, then S15/X01 for submission.
    Record response / Update timeline: Attach insurer correspondence or a dated call note;
     distinguish note from insurer confirmation.
    Follow up / Escalate: Prepare S15 communication or X04 handoff.
    Review settlement / Record payment: Open X01 for recorded acceptance or S12 for payment
     evidence; no inferred acceptance.
    Close / Reopen claim: Check outstanding evidence and amounts, record reason and preserve the
     claim trail.
8. Opens, closes and changes: Follow-ups morph between timeline, missing-documents and settlement
views. A reopened claim reopens its Work and may flag a previously closed policy-year.
9. Waiting, errors and evidence: Unknown cover, duplicate incident, incomplete evidence, disputed
liability and slow third parties each have a specific blocker. Elapsed time is not legal breach without a
verified rule and start event.
10. What happens next: Claim work stays open until its outcome is recorded; settlement does not
automatically mean money was received.

### S11 — Renewal Space
Surface: Living Space
1. Purpose: Protect the next policy period while keeping the current cover visible.
2. How to reach it: Discover expiry card, S05 Renew, automation preparation or Ask Renew Acme.
3. State or intent: S12 of the old period creates S2-S9 preparation for the next period; old claims and
commission remain separate.
4. What appears: Current versus proposed period, expiry clock, readiness checklist, updated risk facts,
claims history, insurer response tracker and next decision.
5. What ASAP prepares: Review the expiring policy, gather changes, identify risks, draft term requests
and prepare comparison/recommendation.

6. Human decision: Confirm renewed exposure, decide the recommendation and record the client's
actual choice.
7. Buttons and actions:
    Prepare renewal / Update details: Start/resume J02 preparation or open X06/O03 for current
     facts.
    Request terms / Follow up: Open S15 with selected insurers and missing replies.
    Add terms / Compare: Open O03/S14 or S03 in renewal mode.
    Explain increase: Morph to premium/cover change evidence, not a guessed reason.
    Prepare recommendation / Record choice: Open S14 or X01 with exact quote version and client
     instruction.
    Prepare placement: Open S04 for the new period, reusing confirmed data.
    Record lost / Lapse / Complete renewal: Open S20 for exit or verify new-cover evidence before
     marking renewal complete.
8. Opens, closes and changes: A second request to Renew Acme resumes the same target period. A
completed renewal does not economically close the old policy-year while its claims, refunds or
commission remain open.
9. Waiting, errors and evidence: No chosen policy: ask which. Missing terms: Waiting. Old claims or
unpaid commission can remain visible without blocking lawful renewal unnecessarily. Suspected cover
gap requires explicit warning.
10. What happens next: New policy period is linked to the old; remaining old-period work is still
searchable and assigned.

### S12 — Money Space
Surface: Living Space
1. Purpose: Separate client premium, insurer receipts, broker commission and cash so no number tells a
false story.
2. How to reach it: Ask Who owes us money?, client balance, policy money chip or finance priority.
3. State or intent: M0-M8, with placement S7, commission S11 and closure S13 links.
4. What appears: Scope header, one plain answer, compact invoice/payment list and expandable
balances. Separate premium due to insurer, brokerage fees, commission due, stated commission,
received cash and tax evidence.
5. What ASAP prepares: Calculate balances from supported entries, suggest matches, identify overdue
items and prepare targeted reminder drafts.
6. Human decision: Confirm payment direction, payer/payee, amount, policy allocation and supported
adjustments.
7. Buttons and actions:
    Change scope / Show overdue: Filter by client, insurer, policy-year or type.
    Open invoice / Payment: Open X06 detail with evidence and linked ledger entries.

      Record payment / Add invoice: Open X06; post only through the permitted X01 confirmation.
      Match / Reconcile: Open S13 with selected entries.
      Prepare reminder: Open S15 addressed to the right debtor, not a blanket campaign.
      Show commission / Insurer balance: Morph into the scoped commission/insurer view.
      Review adjustment / Export: Open S13/S20 or create a permission-scoped export.
8. Opens, closes and changes: Posted payment evidence updates the matching money state. It cannot
alone mark cover Active. Client-to-insurer money is never counted as broker revenue.
9. Waiting, errors and evidence: Unmatched deposit, partial payment, missing tax certificate, wrong
currency or disputed amount stay explicit. An estimate is labelled; no unknown amount becomes zero.
10. What happens next: Collection work, reconciliation or a supported balance remains in context.

### S13 — Reconciliation Space
Surface: Living Space
1. Purpose: Match payments and commission without hiding differences.
2. How to reach it: S12 Reconcile; upload a statement; Ask Reconcile Jubilee's statement.
3. State or intent: M4-M8 and S11; may expose cancellation/refund adjustments before S13 closure.
4. What appears: Statement period, expected versus stated/paid totals, suggested matches, unmatched
rows and difference reasons. Show gross commission, deductions, net cash and certificate status
separately.
5. What ASAP prepares: Match policy, insurer, premium, commission basis and bank references;
suggest split or combined allocations and highlight unexplained differences.
6. Human decision: Approve matches and legitimate adjustments; do not approve a forced balance.
7. Buttons and actions:
    Import statement / Bank evidence: Open O03; preserve source row references.
    Review match / Change allocation: Open a focused matching panel; edit split amounts and
     remaining balance.
    Accept match / Approve selected: Open X01 with proposed entries and total impact. A bulk action
     still checks each item.
    Mark difference / Dispute: Record a reason or prepare S15 clarification; leave the amount
     unresolved.
    Add tax certificate: Open O03/S14 and link to the payment.
    Record adjustment / Reverse entry: Open X01 with evidence and reason; preserve original entry
     and compensating entry.
    Finish reconciliation: Complete only balanced items; report remaining exceptions and linked
     Work.
8. Opens, closes and changes: Use transactional posting: saved rows are not reposted on Retry. Co-
insurance, multiple policy allocations and cancellation returns remain visible by line.

9. Waiting, errors and evidence: Partial success is itemised. Missing rate agreement, rounding, duplicate
statement or conflicting payment reference requires review. Cash received can coexist with missing tax
evidence.
10. What happens next: Money and commission facts update; unresolved differences remain owned
Work, not hidden in Completed.

### S14 — Document review and prepared document
Surface: Space recipe; can open as focused view
1. Purpose: Read, compare or review extracted information while keeping the original beside it.
2. How to reach it: O04, attachment, schedule, terms, statement, or prepared submission/presentation.
3. State or intent: Evidence and extraction across all states; generating a document is preparation, not
proof of a business outcome.
4. What appears: Source viewer, extracted fields/summary, version, linked records and uncertainty
marks. Compare mode shows two versions; prepared mode clearly says Draft.
5. What ASAP prepares: Classify, extract, summarise, compare and propose record links or a client-
ready draft from verified facts.
6. Human decision: Correct uncertain fields, choose the right version and approve material changes or
external use.
7. Buttons and actions:
    Read / Extract / Compare: Switch the centre view and retain the document identity.
    Edit field / Resolve: Open inline correction or X03 with source location.
    Link to record: Open scoped record picker; confirm entity and period before linking.
    Use reviewed data: Open O04/X01 as appropriate; show exact record changes.
    Generate / Revise draft: Create a new version, retaining the prior one and its sources.
    Download / Prepare to send: Export permitted content or open S15 with the exact version
     attached.
    Back to task: Close focused view and restore the parent task.
8. Opens, closes and changes: A new source version marks dependent summaries and pending
approvals as stale. A draft comparison does not become insurer terms.
9. Waiting, errors and evidence: Unreadable pages request a clearer copy. Conflicting values route to
X03. No source is labelled Unsupported. Quarantined files cannot feed recommendations.
10. What happens next: Reviewed information supports the relevant task; the original and corrections
remain auditable.

### S15 — Communication Space
Surface: Living Space or scoped thread view
1. Purpose: Turn email into understood context and useful work, with controlled outbound messages.

2. How to reach it: Ask Find CIC's last email; O06 unmatched list; follow-up action; search result.
3. State or intent: Communication intent across all states; an email suggestion is not a verified change to
cover or money.
4. What appears: Latest thread summary, original messages, client/policy/claim/quote links, extracted
work and optional draft. Show mailbox identity and recipient chips.
5. What ASAP prepares: Classify the thread, propose links, extract requests, prepare replies and attach
relevant reviewed documents.
6. Human decision: Confirm ambiguous links, recipient, message wording, attachments and actual
business instructions.
7. Buttons and actions:
    Open thread / Sources: Expand original messages or open X02.
    Link / Relink: Open a scoped record picker; ambiguous identity routes to X03.
    Create opportunity / Claim / Service / Work: Prepare the chosen S02/S10/S06/S16 draft from the
     message; reuse a matching case if present.
    Draft reply / Follow up / Edit draft: Prepare or edit the draft with autosave.
    Attach / Remove attachment: Select a verified version or remove it from the draft only.
    Review and send: Open X01. Manual-only mode instead shows Open in email / Copy draft.
    Record sent externally / Mark handled: Attach actual send evidence; mark handled only after
     extracted work is linked or dismissed with reason.
8. Opens, closes and changes: A sent message creates communication evidence, not proof of insurer
acceptance. Read-only email mode keeps all preparation features and never sends automatically.
9. Waiting, errors and evidence: Wrong recipient, stale attachment or unlinked client blocks send
review. Failed/unknown send is checked before retry. Incoming instructions never override company
permissions.
10. What happens next: Thread, prepared action and linked task stay connected; unresolved requests
remain visible in Work.

### S16 — Work Space
Surface: Generated collection and item detail
1. Purpose: Show what a person must do, decide or chase. This is separate from Jobs.
2. How to reach it: H01 View all work; Ask What is James waiting on?; Team or client scope.
3. State or intent: Prioritise, waiting, blocked, overdue, assignment and completion intents across
states.
4. What appears: Simple cards grouped by Now, Waiting and Done; each names the outcome,
client/period, owner, reason, blocker and next step. Filters appear only when requested.
5. What ASAP prepares: Group duplicate signals for the same issue, explain priority and prepare the
materials needed to act.

6. Human decision: Take the next action, resolve a blocker, assign or record completion evidence.
7. Buttons and actions:
    Open / Continue: Open the linked task at its exact next step.
    Why this work?: Show source event, economic impact, rule/automation and owner.
    Assign / Reassign: Open X04.
    Waiting on: Choose party, reason and next check date; preserve the real deadline.
    Complete: Check task-specific outcome evidence; writing a draft cannot complete a Send request
     task.
    Reopen / Dismiss duplicate: Record reason and restore the task, or link the duplicate to its
     retained original.
    Log effort: Open X07; no mandatory timer on the main screen.
8. Opens, closes and changes: Completion updates its parent card and timeline. Waiting is not
completion. A user can finish their handoff while the insurer-dependent case remains Waiting.
9. Waiting, errors and evidence: No work: state scope and freshness. Conflicting owners or missing
evidence prevent false completion. No permission to assign: show current owner and permitted
escalation.
10. What happens next: Work is completed, waiting with a named dependency, or handed to another
authorised person.

### S17 — Report Space
Surface: Saved generated view
1. Purpose: Answer a business question with a clear number, definition and supporting records.
2. How to reach it: Ask How did renewals perform?; saved report; scheduled internal report; client or
team follow-up.
3. State or intent: Analysis of production, renewals, claims, insurers, clients, money, commission,
workload and performance.
4. What appears: Question/title, period and scope, one summary, one useful chart/table, metric
definitions and freshness. Additional views are on request.
5. What ASAP prepares: Calculate from permitted records; identify missing data and separate facts,
estimates and possible explanations.
6. Human decision: Choose scope, verify interpretation and decide what to investigate or share.
7. Buttons and actions:
    Change period / Scope: Update the same report with new query context.
    Explain calculation / View records: Show numerator, denominator and evidence; open S18 or
     relevant record Space.
    Investigate: Create linked S18 with the exact metric and filters.
    Pin / Share: Use H03 pin or X05 permissions.
    Export: Download a dated snapshot, labelled with data scope and gaps.

    Schedule: Open A02 with this saved query as a proposed internal report action.
    Refresh: Recalculate and record the new data time; do not silently replace an exported snapshot.
8. Opens, closes and changes: A report can stay live while exports are fixed snapshots. Follow-up
questions morph the chart/table in place; a new business problem opens S18.
9. Waiting, errors and evidence: Unknown staff cost means margin unavailable, not zero. No
unsupported causal claim. Restricted finance remains hidden. Different reporting periods are clearly
labelled.
10. What happens next: A decision, an investigation, or a saved/shareable result with traceable
evidence.

### S18 — Investigation Space
Surface: Living analysis Space
1. Purpose: Find a likely cause of a business problem and show what evidence supports it.
2. How to reach it: Discover observation, S17 Investigate, or Ask Why are claims slower?
3. State or intent: Understand/analyse intent; waiting, cost, retention or commission leakage across the
economic model.
4. What appears: Question, selected population and dates, observations, competing explanations,
relevant records and proposed checks. Keep one active line of investigation visible.
5. What ASAP prepares: Compare timelines and groups, detect patterns, fetch supporting records and
identify what cannot be concluded.
6. Human decision: Confirm scope, test explanations and decide practical follow-up.
7. Buttons and actions:
    Compare groups / Narrow scope: Change the analysis in this Space.
    Open evidence / Related case: Open X02 or the linked business Space, retaining Back to
     investigation.
    Test explanation: Run a check as J02 and add its finding without deleting earlier results.
    Create work: Open X06/S16 with evidence and suggested owner.
    Save finding / Share: Save a labelled conclusion or open X05.
    Schedule watch: Open A02 draft for monitoring a confirmed useful signal.
8. Opens, closes and changes: Why are CIC claims slower? can become missing-document analysis, then
a Work collection for those claims. This does not change claim decisions.
9. Waiting, errors and evidence: Small samples, missing dates and biased comparisons are warnings. If
cost data is absent, show workload evidence instead of invented margin. Correlation is not labelled
cause.
10. What happens next: An evidence-backed finding or a clear data gap, with linked work where useful.

### S19 — Team Operations Space
Surface: Generated management Space
1. Purpose: Help a manager rebalance work and make decisions without a separate admin dashboard.
2. How to reach it: Ask Who is overloaded?; My team context; approval or overdue-work query.
3. State or intent: Team workload, performance, approvals, overdue work and assignment across
economic states.
4. What appears: People summary, urgent decisions, waiting work, workload by effort when known and
underlying cases. Headcounts alone are not treated as capacity.
5. What ASAP prepares: Suggest assignments using permissions, ownership, skills and known capacity;
explain each suggestion.
6. Human decision: Approve a handoff, review an action or change a priority with a reason.
7. Buttons and actions:
      Open person / Show overdue: Morph into that person's scoped S16 collection.
      Rebalance / Assign selected: Open X04 with proposed owner changes and each affected case.
      Review approvals: Show permission-filtered X01 queue.
      Show performance / Activity: Open S17 or a sourced activity timeline.
      Open case / Explain load: Open the linked task or reveal workload basis.
      Manage permissions: Open C02 only for authorised admins.
8. Opens, closes and changes: Bulk reassignment changes accountable owners only after review; it does
not transfer personal mailbox access or erase former owners.
9. Waiting, errors and evidence: Unknown effort is labelled. Personal performance views obey role
restrictions. Unavailable owners or conflicts require manager choice; failed rows remain unchanged.
10. What happens next: Work is redistributed or decisions are resolved, with each change visible in its
original Space.

### S20 — Exceptions, cancellation and economic closure
Surface: Shared case-resolution recipe
1. Purpose: Give lost business, cover problems, refunds and final closure real paths instead of hiding
them in a Done button.
2. How to reach it: Quote no-bid/loss; policy cancellation; lapse warning; complaint; commission
adjustment; Close policy-year.
3. State or intent: Exception loops in [E] section 7 and economic closure S13. Also no-bid/loss from S0-
S6.
4. What appears: Case type, reason, affected policy-years, money/evidence still open and next owner.
Closure mode lists claims, service, commission, refund, delivery and complaint checks.

5. What ASAP prepares: Assemble dependencies, estimate impact only from supported data, draft
follow-up and prepare correction/closure checklists.
6. Human decision: Confirm real exit reason, effective dates, client/insurer authority and supported
financial changes.
7. Buttons and actions:
    Record no-bid / Lost / Lapsed: Save reason and evidence; stop pursuit but retain cost/history. A
     lapse does not erase the client.
    Prepare cancellation: Draft S15 request; X01 approval does not make insurer cancellation
     effective.
    Record cancellation / Refund: Link insurer confirmation and open S13 for supported premium and
     commission adjustments.
    Log complaint / Escalate: Capture allegation, source and owner; open restricted
     investigation/work. Do not auto-admit liability.
    Resolve issue: Check supporting correction/outcome; unresolved financial items stay open.
    Close policy-year: Run closure checks; blocked items link directly to their Spaces. Confirm only
     when all required items reconcile.
    Reopen / Win back: Record reason and revive the appropriate task or create a new opportunity.
8. Opens, closes and changes: Cancellation, commercial exit, completed task and economic closure are
different states. A later claim or adjustment reopens the relevant work and flags the closed period for
review.
9. Waiting, errors and evidence: Disputed cancellation, unpaid refund, complaint or commission
prevents a clean economic close. Never silently write off a difference to finish the case.
10. What happens next: Resolved exception with evidence, or clearly owned remaining work; all original
records remain auditable.

### J01 — Jobs
Surface: Permanent destination
1. Purpose: Show what ASAP is doing, not a manual to-do list.
2. How to reach it: Jobs in the shell or a running-job indicator.
3. State or intent: Preparation, extraction, checks and approved execution linked to a Space or ingestion
batch.
4. What appears: Running, Waiting externally, Work, Completed and Failed filters. Each row names the
actual outcome, linked Space, current step and last update.
5. What ASAP prepares: Publish truthful progress from recorded steps. Use counts, not invented
completion percentages.
6. Human decision: Inspect a run, resolve a requested decision or handle a failure.

7. Buttons and actions:
      Open Job: Open J02 with current progress.
      Open Space: Go directly to the affected business context.
      Resolve / Review: Open X03/X01 in that context; return updates this Job.
      Filter: Change visible Job states only.
      Retry: Open J02 and show failed-step scope before retrying.
8. Opens, closes and changes: Completed means the specified Job finished. Prepared renewal does not
mean renewed policy. A waiting external response uses a persisted wait, not an endlessly running
spinner.
9. Waiting, errors and evidence: No Jobs: explain that longer tasks appear here. Disconnected service:
show failure reason and recovery. No worker access: reveal only safe progress metadata.
10. What happens next: The user can leave while supported work continues and resume its Space later.

### J02 — Job detail and recovery
Surface: Detail page or panel
1. Purpose: Make AI activity understandable and recoverable.
2. How to reach it: J01, Ask progress, import run or automation history.
3. State or intent: A specific run of one or more permitted skills; links to economic states but is not itself
a policy status.
4. What appears: Goal, scope, step list, sources checked, prepared outputs, approvals, changes actually
made and time stamps. Show a business action summary, not private reasoning.
5. What ASAP prepares: Checkpoint completed steps, pause for missing facts or approval, and record
every external outcome.
6. Human decision: Resolve ambiguity, approve a prepared action, retry safely or cancel remaining
work.
7. Buttons and actions:
    Open output / Space: Open S14 or its task Space.
    Review / Resolve: Open X01 / X03 with exact run context.
    Retry failed steps: Reuse recorded successes and a stable request identity; never resend a
     successful action.
    Check outcome: Query execution evidence after an uncertain send/post before offering retry.
    Cancel remaining: Confirm what already happened; stop future cancellable steps, not completed
     actions.
    View history / Sources: Open C05 or X02.
    Back: Return to the originating Jobs, Space or automation view.
8. Opens, closes and changes: A Job may complete with a draft output, wait externally, enter Work for
human input, or fail with recoverable detail. Cancellation keeps its audit record.

9. Waiting, errors and evidence: Timeout is Unknown outcome, not automatic failure. Partial success
lists each changed item. Revoked permission stops later steps and requires revalidation.
10. What happens next: Only confirmed execution updates records; unfinished work remains visible.

### A01 — Automations
Surface: Permanent destination
1. Purpose: Show the rules the company has chosen to run.
2. How to reach it: Automations in the shell or Ask Always do this.
3. State or intent: Automate intent across the mapped triggers and safe actions.
4. What appears: Short list: rule name, plain-language trigger, owner, approval rule, enabled/paused
state and recent failures. No visual wiring canvas by default.
5. What ASAP prepares: Explain existing rules, identify overlaps and suggest draft rules from repeated
work.
6. Human decision: Choose what to create, test, activate, pause or retire.
7. Buttons and actions:
    Create automation: Open A02 with a blank intent or current task as a draft.
    Open / Edit: Open A02 at the saved version.
    Pause / Resume: Stop future triggering or re-enable after validity checks; show what happens to
     current runs.
    History: Open A03 filtered to this automation.
    Delete: Confirm retirement, show affected schedules and keep historical versions/runs. No record
     deletion.
8. Opens, closes and changes: Pausing a rule does not cancel already-approved runs; J02 provides that
separate control. Deleting retires the rule from future use while preserving the audit trail.
9. Waiting, errors and evidence: No rules: one plain example and Create. Invalid connector/owner/rule
gets a specific warning and is not silently resumed.
10. What happens next: A rule draft, safe state change or auditable history view.

### A02 — Automation builder and test
Surface: Space recipe
1. Purpose: Turn a plain instruction into a rule a manager can understand and test.
2. How to reach it: A01, Ask When a policy is near expiry..., or S17 Schedule.
3. State or intent: TRIGGER + CONDITIONS + SKILLS + ACTION + APPROVAL + EXCEPTIONS, as specified in
[I].
4. What appears: One-sentence summary followed by When, Only if, Prepare/do, Approval and If
something goes wrong. Collapsed details include owner, timezone, duplicate handling and run limits.

5. What ASAP prepares: Propose permitted skills and conditions; explain affected records and refuse
unsupported actions.
6. Human decision: Confirm scope, authority, timing, approval and exception owner before activation.
7. Buttons and actions:
    Describe / Edit step: Update one rule section and refresh the plain-language summary.
    Choose trigger / Add condition / Add action: Open small pickers of supported items, not arbitrary
     code.
    Set approval / Exception owner: Choose permitted reviewer and recovery owner; high-risk
     actions cannot bypass policy.
    Test: Simulate against selected/sample records with no external send, payment or production
     changes.
    Review test: Show matched/skipped records, intended actions and exceptions.
    Save draft / Activate: Save an inactive version or activate after checks and required admin
     approval.
    Cancel: Return to A01; keep saved draft, confirm discarding unsaved changes.
8. Opens, closes and changes: Changing a trigger, scope or action invalidates its test. Activation versions
the rule; running Jobs keep their original version. Testing is an explicit simulation, not a hidden operating
mode.
9. Waiting, errors and evidence: No matches: show why. Loop risk or duplicate triggers: block activation
until resolved. Unsupported connector or missing approval owner blocks affected actions.
10. What happens next: A visible, testable rule creates Jobs and linked Spaces only when its conditions
truly match.

### A03 — Automation history and monitoring
Surface: History view
1. Purpose: Explain why a rule ran, what it changed and what failed.
2. How to reach it: A01 History, A02 after activation, or Why this work? in a Space.
3. State or intent: Automation explanation/history; shows original event and matched conditions.
4. What appears: Run date, event, rule version, matched conditions, affected records, outcome and Job
link. Skipped events include a reason.
5. What ASAP prepares: Record trigger identity, step outcomes and evidence links so a created Work
item is explainable.
6. Human decision: Inspect unusual runs and decide whether to pause or edit the rule.
7. Buttons and actions:
    Open run: Open J02 with the exact rule version.
    Why it ran / Why skipped: Expand event, conditions and evidence in place.
    Open affected Space: Open the saved context at its prepared output.

    Pause rule / Edit: Pause future runs or open a new A02 draft version.
    Retry failed: Open J02; retry only failed, permitted steps after checking prior outcomes.
    Filter / Export history: Limit dates/status or export a permission-scoped audit view.
8. Opens, closes and changes: History is immutable. Editing the rule does not rewrite why earlier Jobs
ran.
9. Waiting, errors and evidence: Missing source event or outdated permission blocks replay. Replayed
events cannot duplicate a completed action. Failure shows a named owner and recovery path.
10. What happens next: Trustworthy execution history or a controlled rule correction.

### X01 — Approval and action review
Surface: Shared dialog; focused full screen for long reviews
1. Purpose: Let the right human authorise an exact prepared action once.
2. How to reach it: Review action from a Space/Job, manager approvals, financial posting or a controlled
admin change.
3. State or intent: Client choice, submission, material update, financial posting and permitted external
communication.
4. What appears: Action, target, scope, before/after, recipients/attachments if relevant, source
versions, impact, permissions and one explicit approve button.
5. What ASAP prepares: Prepare the review packet; check required evidence and validate that nothing
relevant changed since preparation.
6. Human decision: Approve, reject or return for changes within their authority. Client instruction and
insurer confirmation remain separate evidence.
7. Buttons and actions:
    Approve [named action]: Recheck permissions and versions, then execute once or release the
     approved Job; show result, not just a success toast.
    Request changes: Add reason and return to the preparer/Space with status Work.
    Reject: Record reason, end this approval request and keep the business task open if still needed.
    Edit / View source: Return to the draft or open X02; editing invalidates this approval version.
    Close / Decide later: Dismiss without approving; keep it in the reviewer's Work queue.
8. Opens, closes and changes: Approval is followed by Executing, Confirmed, Failed or Outcome
unknown. Unsupported integrations hand off to the human instead of pretending to execute.
9. Waiting, errors and evidence: Wrong role, self-approval restriction, stale quote, changed recipient,
missing client authority or failed prerequisite prevents approval. Timeout prompts Check outcome
before retry.
10. What happens next: Record actor, scope, evidence version, time and actual result; refresh the
source Space.

### X02 — Source evidence
Surface: Right-side drawer; full screen on mobile
1. Purpose: Let users verify a fact without losing their task.
2. How to reach it: Source chip, highlighted field, Explain, or audit entry.
3. State or intent: Evidence requirement for any economic transition or material statement.
4. What appears: Fact, document/email/record name, version and date, exact page/row/message
excerpt, uncertainty and linked original.
5. What ASAP prepares: Locate the supporting passage; distinguish quoted source, extracted value and
interpretation.
6. Human decision: Check support or flag a wrong fact.
7. Buttons and actions:
      Open original / Page controls: Open the actual source at its location; navigate inside the drawer.
      Compare versions: Open S14 with the current and previous source.
      Flag issue: Open X03 or create linked Work with the disputed fact.
      Download: Export source only if permission allows.
      Close / Escape: Return focus, scroll and selection to the originating control.
8. Opens, closes and changes: Opening evidence changes no business state. Switching to a full
document view preserves Back to task.
9. Waiting, errors and evidence: Source unavailable: say unavailable and offer refresh/reconnect.
Missing evidence never becomes a verified fact. Restricted sources cannot be exposed through excerpts.
10. What happens next: User returns informed, or starts a correction.

### X03 — Missing facts, conflicts and duplicate choice
Surface: Shared resolution panel
1. Purpose: Resolve one unclear issue at a time with enough evidence to choose safely.
2. How to reach it: Import check, conflicting value, ambiguous record match or stale approval.
3. State or intent: Information hold at S3, query at S5, evidence correction at S9, or money mismatch.
4. What appears: Question, candidate values/records, source/date, affected actions and suggested
resolution. Related fields expand only if needed.
5. What ASAP prepares: Show the disagreement and impact; never silently choose a material value
because one source is newer.
6. Human decision: Choose a supported value/link, provide corrected evidence or defer with an owner.
7. Buttons and actions:
    Use this value / Link this record: Preview the resulting changes and save safe internal corrections
     or route material ones to X01.
    Create separately: Keep possible duplicates distinct; record the reason.

      Enter correction / Upload evidence: Open inline fields or O03; retain the original values in history.
      Request information: Prepare S15 draft or create Work; do not send automatically.
      Skip for now: Leave unresolved, name owner and return to the batch/task.
      Cancel / Close: Discard unsaved selection, keep the blocker.
8. Opens, closes and changes: Resolution refreshes checks and invalidates outdated prepared actions.
Merging used records requires an explicit mapping/impact review, not this quick chooser.
9. Waiting, errors and evidence: No evidence supporting any option keeps the action blocked. Material
uncertainty is never solved by an unexplained confidence percentage.
10. What happens next: The parent resumes only where its requirements now pass.

### X04 — Assign or hand off work
Surface: Shared dialog
1. Purpose: Make responsibility clear without moving private data to an unauthorised person.
2. How to reach it: Work/Team/Client assignment, Job exception or automation owner setting.
3. State or intent: Assign/reassign intent; ownership may change while economic state stays the same.
4. What appears: Affected work, current owner, permitted people, due date, reason and optional
workload context.
5. What ASAP prepares: Suggest an eligible owner and flag overloaded/unavailable people without
pretending to know unmeasured capacity.
6. Human decision: Choose the responsible person and confirm the handoff scope.
7. Buttons and actions:
    Choose person / Change due date: Update the proposal; show real deadline separately from
     internal follow-up date.
    Assign / Reassign: Validate each item, save owner and create internal notification/audit evidence.
    Review selected: Expand every item in a bulk handoff and show permission exceptions.
    Cancel / Close: Leave current owners unchanged.
8. Opens, closes and changes: Dialog closes on success and refreshes both user queues. Failed bulk rows
remain unchanged and visible.
9. Waiting, errors and evidence: No eligible owner: show admin/escalation guidance. Assignment does
not grant mailbox or claim access. Lost role access requires another owner.
10. What happens next: A visible owner and next check date, with unchanged evidence links.

### X05 — Share, save and export scope
Surface: Shared dialog
1. Purpose: Share useful work while preserving company and record access.
2. How to reach it: Share on a Space/report or a controlled export action.

3. State or intent: Collaboration intent; no insurance state change.
4. What appears: Space identity, internal recipients, permitted access level, live view versus dated
snapshot and included sources.
5. What ASAP prepares: Check content permissions and flag attachments or financial/claim data the
recipient cannot access.
6. Human decision: Choose recipients, access and whether a snapshot is suitable.
7. Buttons and actions:
    Choose people / Access: Select permitted members and available view/edit roles.
    Share internally: Save access only within allowed limits; notify recipients if policy permits.
    Copy link: Copy a permission-checked internal link, never a public bearer link.
    Export snapshot: Create a dated, scoped file with evidence and data gaps.
    Prepare external copy: Open S14/S15 for a reviewed export; external recipients do not receive
     live company access.
    Remove access / Close: Revoke a share if authorised, or close without changing it.
8. Opens, closes and changes: Recipient links open the actual Space after sign-in. Saving a report
preserves its query; exports preserve a specific result version.
9. Waiting, errors and evidence: Missing recipient access: do not send restricted excerpts. External live
sharing is not assumed. Revoked access stops later views but cannot retract a downloaded file.
10. What happens next: A safe shared Space or explicit snapshot with an audit entry.

### X06 — Manual creation and focused editing
Surface: Shared form; type-specific fields
1. Purpose: Keep every existing manual route available while asking only for needed fields.
2. How to reach it: H05 Create manually, Add contact, Edit details, Record response/payment or
missing-data action.
3. State or intent: Create/update intent; the selected type and action determine approval and state
effects.
4. What appears: A short form with visible client/period context, required fields, optional details
collapsed, evidence attachment and duplicate candidates. Full field sets are in Part 3.
5. What ASAP prepares: Prefill known facts with source labels; validate relationships, dates, amounts
and duplicates.
6. Human decision: Fill missing facts and confirm the proposed create/update.
7. Buttons and actions:
    Change type / Context: Switch form or linked records; confirm if this would clear incompatible
     entries.
    Add evidence / More details: Open O03 or reveal optional fields.
    Save draft: Save unfinished internal work, not confirmed cover/payment.

    Create / Save changes: Validate, then save safe fields or open X01 for material/financial changes.
    Use existing: Open matching record and offer a safe update/link instead of duplicate creation.
    Cancel / Close: Keep saved drafts; ask Save draft / Discard / Keep editing for unsaved fields.
8. Opens, closes and changes: Success opens the corresponding Space and records creation evidence.
Existing record edits return to the invoking view. Posted financial entries are reversed, not overwritten.
9. Waiting, errors and evidence: Required field errors sit next to the field. Missing policy may create a
draft claim but cannot invent a policy. Permission-denied fields are read-only with reason.
10. What happens next: One valid record or a clear saved draft with next missing facts.

### X07 — Effort and service-cost record
Surface: Optional shared panel
1. Purpose: Make the economic model's service-cost question measurable without adding busywork
everywhere.
2. How to reach it: S16 Log effort, S01/S05 cost question, or S19 workload review.
3. State or intent: Cost and margin loop in [E] sections 9, 16 and 17; supporting capability proposed to
close a source gap.
4. What appears: Task and policy-year, person, work date, activity type, actual minutes or cost and
source. Imported/estimated effort is clearly labelled.
5. What ASAP prepares: Suggest task linkage and aggregate confirmed effort; do not treat time between
emails as hours worked.
6. Human decision: Confirm actual effort; managers choose valid cost assumptions separately in C06.
7. Buttons and actions:
      Add entry / Edit entry: Enter or correct authorised effort with reason for edits.
      Save: Validate non-negative amounts and links; update workload/margin basis.
      View basis: Show actual versus estimated inputs and configured rate source.
      Import time records: Open O03 if a supported source is available.
      Cancel / Close: Return to the task without requiring a time entry to do insurance work.
8. Opens, closes and changes: Confirmed cost contributes to scoped reports. The UI shows Incomplete
cost data until coverage is sufficient; it never fabricates profit.
9. Waiting, errors and evidence: Unknown rate or missing policy link leaves an uncosted entry. Personal
effort and compensation details obey separate permissions.
10. What happens next: Better workload/cost evidence, without changing policy or money states.

### C01 — Profile and company settings
Surface: Menu plus settings landing
1. Purpose: Keep setup and administration out of the main navigation.

2. How to reach it: Profile / Company at the bottom of the shell.
3. State or intent: Account/settings intent; roles determine visible choices.
4. What appears: Current company and role, personal preferences, company basics, Team &
permissions, Connections, Data & security, Billing, Audit and Business rules.
5. What ASAP prepares: Explain settings impact and show connection/security issues; do not change
settings from a vague request.
6. Human decision: Choose the setting or company; edit permitted preferences.
7. Buttons and actions:
    Switch company: Open O02 and clear current company context only after selection.
    Profile / Notifications: Edit name, timezone and notification preferences; Save validates and
     returns here.
    Company details: Edit permitted name/contact fields; sensitive changes request X01.
    Team / Data / Billing / Audit / Business rules: Open C02 / C03 / C04 / C05 / C06 respectively.
    Connections: Open O06 list/detail; Add connection opens O05 or supported import connector
     setup.
    Sign out: End this session, clear displayed company data and return to O01.
    Close / Back: Return to the previous Space without losing work.
8. Opens, closes and changes: Settings use one list/detail pattern rather than new main menus. A
denied setting does not break navigation back to work.
9. Waiting, errors and evidence: Offline saves do not display success until confirmed. Switching
company warns about unsaved edits; saved Jobs continue only in their authorised company.
10. What happens next: Updated preferences or the chosen admin screen.

### C02 — Team membership and permissions
Surface: Settings detail
1. Purpose: Control who can see, prepare, approve and administer work.
2. How to reach it: C01 Team & permissions; S19 Manage permissions.
3. State or intent: Admin intent, separate from operational assignment.
4. What appears: Members, invited/pending status, roles, data scope and approval rights. Suggested
roles: admin, manager, broker/account owner, claims, finance and read-only.
5. What ASAP prepares: Show effective permission changes, affected work and risky role combinations.
6. Human decision: Choose allowed access and an owner for reassigned work.
7. Buttons and actions:
    Invite: Enter verified email and role; review then send invitation, leaving it Pending.
    Resend / Revoke invitation: Send a new invite or invalidate the unused invitation after
     confirmation.

    Edit role / Scope: Preview changes and affected approvals/mailboxes; confirm permitted change
     through X01.
    Suspend member: Confirm session/access removal and handoff of Work and owned automations.
    Restore member: Recheck and restore approved access, not unreviewed historical privileges.
    Back: Return to C01.
8. Opens, closes and changes: A role change immediately affects search, Spaces, approval eligibility and
future Job steps. Ownership handoff is explicit through X04.
9. Waiting, errors and evidence: Prevent removal of the last administrator. Shared mailbox access is not
implied by a general team role. Pending invite is not an active member.
10. What happens next: An auditable access state and clearly owned remaining work.

### C03 — Data, access and security controls
Surface: Settings detail
1. Purpose: Let the company understand and control stored data and access.
2. How to reach it: C01 Data & security; approved deletion/export workflow.
3. State or intent: Admin/security intent; can affect evidence availability and dependent work.
4. What appears: Data sources, retention rules, permitted export/delete requests, security
requirements and active sessions. Mark capabilities that require backend support.
5. What ASAP prepares: Preview affected records, evidence, reports and runs; explain what a requested
removal will and will not do.
6. Human decision: Authorised admin reviews scope, retention obligations and irreversible effects.
7. Buttons and actions:
    Review source data: Open source scope and linked records in O06/S14.
    Request export: Show company scope and sensitive categories; confirm authorised export
     through X01 and J02.
    Request deletion: Preview exact targets and retention holds; require X01, then track J02. Do not
     delete approved evidence under a hold.
    Security policy / Sessions: Edit supported session/MFA rules or revoke selected sessions after
     review.
    View audit / Back: Open C05 or return to C01.
8. Opens, closes and changes: Disconnecting a mailbox stops access; it is not data deletion. Deletion
jobs record confirmed outcomes and safe tombstones without exposing removed sensitive content.
9. Waiting, errors and evidence: Unsupported export/delete/security integration is clearly unavailable.
Permission failure stops the operation. Retention conflict offers review, not a bypass.
10. What happens next: A tracked data-control result or a clear approval/retention blocker.

### C04 — Billing and subscription
Surface: Settings detail
1. Purpose: Make the software subscription understandable without mixing it with client insurance
money.
2. How to reach it: C01 Billing; usage-limit warning.
3. State or intent: Company subscription only; never part of M0-M8 insurance money.
4. What appears: Actual plan, billing contact, documented usage limits, invoices and payment status.
Pricing and provider are not assumed by this map.
5. What ASAP prepares: Explain current usage and consequences of a plan change.
6. Human decision: Billing admin chooses an available plan/payment change and reviews actual charges.
7. Buttons and actions:
    Manage plan / Payment method: Open the supported provider flow; confirm price and effective
     date before committing.
    Download invoice: Export the selected subscription invoice.
    Update billing contact: Edit permitted invoice recipient information.
    Cancel subscription: Show access/export/retention impact and require confirmation; does not
     cancel insurance policies.
    Back: Return to C01.
8. Opens, closes and changes: Provider confirmation updates subscription status. A failed redirect does
not mark a bill paid.
9. Waiting, errors and evidence: No billing integration or plan yet: show honest unavailable state, not
invented charges. Past-due behaviour must preserve permitted access to records and export according
to company policy.
10. What happens next: Confirmed billing change or pending provider action; insurance records remain
separate.

### C05 — Audit log and event detail
Surface: Settings list/detail; scoped drawer
1. Purpose: Explain who did what, with which evidence, and what actually happened.
2. How to reach it: C01 Audit; View history from a Space, approval, import or Job.
3. State or intent: Evidence and accountability across every state change.
4. What appears: Time, actor, action, target, before/after, reason, source version, approval and
execution outcome. Technical identifiers are secondary.
5. What ASAP prepares: Record changes and link their original event, Job, rule version and sources;
never rewrite historical outcomes.
6. Human decision: Inspect a change, verify evidence or open a permitted correction workflow.

7. Buttons and actions:
    Open event: Expand target, before/after and result.
    Open source / Approval / Job / Space: Open X02 / X01 history / J02 / linked Space.
    Filter / Export: Scope by time, actor or record and export permitted audit data.
    Request correction: Open X03/S20; add a new correction event, never edit the original audit
     entry.
    Back / Close: Return to the calling screen.
8. Opens, closes and changes: Scoped history can open as a drawer. The full company log remains an
admin tool, not a primary navigation item.
9. Waiting, errors and evidence: Missing or removed source has a clear reason and retained safe
reference. Restricted details remain redacted even for users who can see a related task.
10. What happens next: A trusted explanation or an explicit correction request.

### C06 — Insurers, business rules and approval policy
Surface: Settings detail
1. Purpose: Store the company-specific facts that keep preparation and checks accurate.
2. How to reach it: C01 Business rules; unresolved TOR meaning; missing commission basis or deadline
rule.
3. State or intent: Supporting setup for quote selection, servicing, financial checks and economic clocks;
proposed detail beyond [I].
4. What appears: Insurer directory/contacts and agency appointments; product/class rules; TOR
meaning; commission agreements; deadline sources; approval roles; optional effort-cost basis. One
group open at a time.
5. What ASAP prepares: Suggest extracted rules with sources, show conflicts and preview which records
will be affected.
6. Human decision: Authorised operator validates business meaning, rates, effective dates, source and
scope before use.
7. Buttons and actions:
    Add / Edit rule: Open focused fields: name, scope, value, unit, source, effective dates and owner.
    Upload agreement: Open O03/S14 for a proposed rule, not automatic activation.
    Preview impact / Test: Show affected checks or calculations without changing live records.
    Save draft / Activate version: Save inactive change or require X01 to publish a validated version.
    Retire / Restore version: Stop future use or propose a new activation; preserve historical
     calculation basis.
    External action policy: Keep draft/manual-send as default; any supported approved-send
     capability requires explicit company authorisation.
    Back: Return to C01.

8. Opens, closes and changes: Rule versions apply by effective date. New rates/deadlines never silently
rewrite historical payments or clocks. Existing approvals are rechecked if their basis changes.
9. Waiting, errors and evidence: No validated TOR/rate/deadline means Ask/Check, not a made-up
value. Agency users see only permitted insurer markets. Automated binding or money movement is not
enabled by this page.
10. What happens next: A sourced, versioned rule or a clearly owned validation task.

## Part 3. Fields, states and complete user journeys

Manual record forms in X06
Only the selected type's fields appear. Required details vary by product and validated company rules;
fields below are the proposed base, not a replacement for insurer forms. Optional fields stay collapsed.
Every form has source attachment, draft save, validation and duplicate review.

Client: person/business, legal/display name, relevant identity reference when required, contact method,
owner and address if needed. Contact: name, role, verified contact details and linked client/insurer. Do
not require sensitive identifiers before they are needed.

Opportunity/quote: client or prospect, insurance class, risk description, proposed dates, mandate status,
owner and evidence. Tender mode adds deadline and separate risk/policy lines. Quote mode adds
insurer, premium breakdown, cover terms, conditions and validity; an entered premium is not an issued
quote without evidence.

Policy: client, insurer, class, reference, cover period, covered risk/items, premium/currency, source
schedule and confirmation status. Unknown details allow Draft only. Importing an existing policy does
not rerun its historic sale as if it were new business.

Claim: client, incident date/time/location, description, candidate policy, contact, insurer reference when
available and supporting evidence. Missing policy keeps a draft with a clear linking task. Service:
policy/period, type, requested change, effective time, instruction and recipient/insurer.

Payment: direction/type, payer, payee, amount, currency, date, bank/receipt reference,
client/policy/invoice allocation and source. Premium receipt by insurer, commission cash to broker and
claim settlement are distinct types. Invoice: issuer, payer, type, reference, issue/due date, amounts,
currency and linked policy. Imported insurer documents retain issuer identity.

Work: desired outcome, linked Space/record, owner, due date, reason, evidence and completion
condition. Response/note: sender/actor, event time, content, linked request and evidence type. Call
notes never masquerade as insurer documents.

Servicing subtype fields: TOR adds meaning, purpose, item, start/end time and issuing insurer;
endorsement adds before/after and effective time; certificate adds purpose, item, issuer and recipient.
Transfer of ownership adds old/new party, authority and required supporting documents.

State-to-Space coverage

 Economic state               Main screen paths                 Evidence required to move

 S0-S1: possible and                                            Risk enquiry, fit and pursuit/no-bid
                              S01, S02, S20
 qualified business                                             decision

 S2: mandate or renewal
                              S02, S11                          Client request/authority and target period
 request

                                                                Reviewed facts, source and resolved
 S3: usable risk facts        O04, S02, S14, X03
                                                                material conflicts

                                                                Actual submission evidence, not just a
 S4: market approached        S02, S15, J02
                                                                draft

                                                                Valid insurer terms and disclosed missing
 S5: usable terms             S02, S03
                                                                conditions

                                                                Exact chosen quote version and client
 S6: client instruction       S03, S04, X01
                                                                instruction

                                                                Insurer receipt or verified permitted
 S7: payment condition        S04, S12, S13
                                                                condition

 S8: cover confirmed          S04, S05, X01                     Matching insurer confirmation and dates

 S9: complete policy                                            Correct source documents and delivery
                              S04, S05, S09, S14
 evidence                                                       evidence

                                                                Change/claim evidence and tracked
 S10: active service          S05-S10, S15, S16
                                                                outcomes

 S11: commission                                                Agreement basis, statement, cash and tax
                              S12, S13
 matched and collected                                          records

                                                                New-period instruction or supported exit
 S12: renewal or exit         S11, S20
                                                                reason

                                                                Cleared money, claims, service, evidence
 S13: economic closure        S20
                                                                and complaints

 M0-M3: possible to due                                         Quote, choice, invoice and payment
                              S02-S04, S12
 premium                                                        requirement

 Economic state               Main screen paths                  Evidence required to move

 M4-M6: insurer receipt
                              S12, S13                           Receipt, agreement and insurer statement
 to stated commission

 M7-M8: net cash and                                             Bank match, tax evidence and supported
                              S12, S13, S20
 final settlement                                                adjustments

How Spaces morph with follow-up questions
Acme: Find Acme opens S01. Show policies replaces the centre with policy cards. Only those expiring
this year filters that view. What changed on the motor renewal opens/resumes S11 for the selected
policy-year. Compare terms shows S03 inside that renewal. Why did APA increase the price shows
cover/price differences and X02 evidence. Back restores the previous comparison; nothing overwrites
the Client Space.

Claim: What is happening with Jane's claim opens S10 timeline. What is missing swaps to
MissingDocuments. Draft a follow-up opens S15 as a linked communication task. Record the response
updates the original claim after matching and review. The thread and claim keep separate identities.

Money: Who owes us money? opens S12 with explicit debtor scope. Only Acme filters it. Match this
receipt opens S13. Why is commission lower? shows the statement difference and rule source. Prepare
a query opens S15; it does not write off the difference.

Management: Why are renewals slipping? opens S18. Show James's cases narrows scope. Reassign
these opens X04 with a review of each item. Watch this weekly opens A02 as a draft. The earlier analysis
remains saved.

First-time user: sign-in to useful work
Step 1: O01 authenticates. Step 2: O02 accepts the invitation or creates/selects the company. Step 3:
H01 opens immediately with an empty but usable Discover. No forced import wizard or long role quiz.

Step 4: Add records opens O03. The user adds a PDF plus a client spreadsheet; extraction runs in J02.
Step 5: O04 shows ready items and only the exceptions that need a decision. X03 resolves a duplicate
client. Save ready items confirms the proposed records.

Step 6: The first Client/Policy Space opens. H01 now reflects actual data. Step 7: Connect email opens
O05, asks for data scope, then O06 shows sync and unmatched messages. The user can skip this and
keep working. Step 8: Ask What should I do today? opens the current priorities; no fake activity is shown
while data is missing.

Employee: complete daily workflow
Start at H01 with three sourced priorities: an expiring renewal, a missing claim document and a
commission mismatch. Open the renewal directly at S11's missing terms, not a generic client overview.
Review the prepared request in S15. In manual mode, open it in email and record actual submission; in
approved-send mode, X01 authorises the specific message.

Return to Discover. Open S10 at the missing claim document. Add the received evidence through
O03/S14; confirm the link. The checklist refreshes and ASAP prepares submission. The employee reviews
it and records actual handoff. Claim status becomes Submitted/Waiting only when supported, not when
the draft was generated.

Open the commission mismatch in S13. Review the policy and statement references. If authorised,
approve the correct allocation in X01. If not, assign the finance decision through X04. The original Work
card keeps the remaining blocker visible.

During the day, incoming messages propose linked internal Work. The employee can inspect J01 without
leaving an unfinished draft. At day end, S16 shows Done, Waiting with named parties, and remaining
Work. Any logged effort is optional through X07. Closing the browser does not complete tasks or cancel
supported background Jobs.

Manager: complete daily workflow
Open H01 with team scope. Ask What is at risk this week? to generate S19/S17. Open a renewal cohort
and inspect why cases are urgent. Reassign eligible work through X04; exceptions remain assigned to the
original owner until resolved.

Review the X01 queue. Inspect actual evidence, approve one valid action, return another for changes
and reject an unsupported financial adjustment. A bulk approval must show every action and obey per-
item permissions; there is no blind Approve everything control.

Ask Which clients take more service time than they earn? S17 shows measured commission and effort
coverage. Missing cost is labelled. Investigate a pattern in S18, open underlying cases and create focused
Work. The manager does not judge employees from invented effort estimates.

Create a renewal-preparation rule in A02, test it without production changes, review approval and
exception handling, then activate the permitted version. A03 shows which future events triggered it. End
with commission exceptions and renewal risks still owned and visible, not hidden by task-completion
totals.

Ten economic scenario checks

 Source scenario              Screens to demonstrate              What must be visibly true

                                                                  New cover and commission proven
 Successful motor renewal     S11, S03, S04, S05, S13
                                                                  separately

 Retained corporate
                              S01, S11, S17                       Multiple policies and periods stay distinct
 account

 Quote lost to another
                              S02, S20, X07                       Loss reason and incurred effort remain
 broker

 Client pays late             S04, S12, S16                       No unsupported Active cover indicator

                                                                  Both sources visible; material action
 Vehicle value conflict       O04, X03, S08
                                                                  blocked

                                                                  Cover confirmed can coexist with missing
 Policy document late         S04, S14, S16
                                                                  document

                                                                  Workload shown; missing cost not
 Heavy medical servicing      S06, S10, X07, S17
                                                                  fabricated

 Commission                                                       Difference stays open until supported
                              S12, S13, S15
 underpayment                                                     resolution

                                                                  Service evidence linked to recorded exit
 Claim delay loses renewal    S10, S11, S20
                                                                  reason

                                                                  Meaning, item, period and insurer
 Urgent TOR request           S07, S04, S09
                                                                  outcome confirmed

Automation trigger and action coverage
All 12 triggers from [I] use the same A02 builder. Email received and document uploaded need the
approved source event; approaching expiry needs the policy period and a validated offset; quote
received needs an identified quote; claim created/status changed needs the claim and recorded
transition. Payment received/invoice overdue need the correct ledger event; record changed needs the
field/version; overdue Work needs owner and due date; scheduled time needs timezone; user action
needs the explicit triggering control.

All 14 action types from [I] remain available when supported: create/assign Work, prepare
email/document, extract information, update safe internal fields, check requirements, compare
information, run analysis, generate report, notify, request approval, flag an exception and start a

workflow. They use the same Spaces and controls as manual intents. Every run links its rule, source
event, Job and affected Space.

Conditions expose client/record scope and permissions. Repeated or out-of-order events must not
duplicate work or move a state backwards without review. Limit recursive triggers and repeated failures;
pause with a clear owner. A rule cannot give its owner permissions they do not already have.

Implementation and acceptance checks
Every visible control has a named target, result and return path from this map. Decorative clickable-
looking elements must either work or be styled as information. No button simply shows Success while
leaving the task unchanged. Prototype-only integrations are labelled Demo and show their intended
pending/error states.

Demonstrate happy, empty, loading, Waiting, Work, failed, partial-success, uncertainty, stale-data and
permission-denied states. Test fresh sign-in, invitation, returning deep links, browser Back, refresh and
two tabs editing the same record. Repeated submission must not duplicate a record, email or financial
entry.

Prove isolation using two companies and two different roles. Hidden records must not appear in search
counts, summaries, exports or linked sources. Recheck permission and prepared-data versions at
execution, not only when a button is drawn.

Save context and relevant drafts when leaving a Space. Test all 49 surfaces on desktop and mobile with
keyboard/focus behaviour. Run the ten scenario checks above and trace all 163 named skills in the next
section before calling the source coverage complete.

## Part 4. Named skill coverage
The supplied map names 163 skills. Each line below shows its primary catalogue paths. The screen entry
defines the action, evidence and review behaviour; common permissions and failure rules still apply.

Analysis skills
    analysis.claims: S17
    analysis.clients: S17
    analysis.commission: S17
    analysis.explain_change: S17, S18
    analysis.insurers: S17, S18
    analysis.money: S17
    analysis.performance: S17, S18
    analysis.production: S17
    analysis.renewals: S17
    analysis.workload: S17

Automation skills
    automation.create: A01, A02
    automation.delete: A01
    automation.edit: A01, A02, A03
    automation.explain: A02, A03
    automation.history: A03
    automation.pause: A01, A03
    automation.resume: A01
    automation.test: A02

Certificate skills
    certificate.request: S09

Claim skills
    claim.check_coverage: S10
    claim.check_documents: S10
    claim.close: S10
    claim.create: S10
    claim.detect_blocker: S10
    claim.detect_from_email: S10

   claim.extract_incident: S10
   claim.find_policy: S10
   claim.follow_up: S10
   claim.prepare_submission: S10
   claim.record_response: S10
   claim.settlement_summary: S10
   claim.status: S10
   claim.timeline: S10
   claim.track: S10

Client skills
   client.activity: S01
   client.assign_owner: S01
   client.contacts: S01
   client.create: O04
   client.find: H04
   client.list_claims: S01
   client.list_opportunities: S01
   client.list_policies: S01
   client.money_summary: S01
   client.relationship_history: S01
   client.summary: S01
   client.update: O04, S01

Commission skills
   commission.expected: S12, S13
   commission.outstanding: S12, S13
   commission.received: S12, S13
   commission.reconcile: S13

Document skills
   document.check_missing: O04, S14
   document.classify: O03, S14
   document.compare: S14
   document.detect_conflict: O03, S14
   document.extract: O03, S14
   document.find: H04, S09

   document.link_to_record: O04, S14
   document.summarize: O03, S14
   document.validate: O04, S14

Email skills
   email.classify: O06, S15
   email.detect_unhandled: O06, S15
   email.extract_action: O06, S15
   email.find: H04, S15
   email.identify_claim: O06, S15
   email.identify_client: O06, S15
   email.identify_policy: O06, S15
   email.identify_quote: O06, S15
   email.link_to_record: O06, S15
   email.prepare_follow_up: S15
   email.prepare_reply: S15
   email.thread_summary: S15

Endorsement skills
   endorsement.prepare: S08

Money skills
   money.client_balance: S12
   money.insurer_balance: S12
   money.match_payment: S12, S13
   money.outstanding: S12
   money.overdue: S12
   money.prepare_follow_up: S12
   money.reconcile: S13
   money.record_payment: S12

Opportunity skills
   opportunity.create: S02
   opportunity.detect_from_email: S02

Placement skills
   placement.check_requirements: S04

   placement.confirm: S04
   placement.prepare: S04
   placement.prepare_submission: S04
   placement.track_policy_issuance: S04

Policy skills
   policy.check_item: S05
   policy.compare_versions: S05, S08
   policy.coverage: S05
   policy.documents: S05, S09
   policy.expiry: S05
   policy.find: H04
   policy.history: S05
   policy.parties: S05
   policy.schedule: S05
   policy.summary: S05

Quote skills
   quote.check_completeness: S02
   quote.compare: S03
   quote.compare_cover: S03
   quote.extract_requirements: S02
   quote.extract_terms: S02
   quote.follow_up: S02
   quote.prepare: S02
   quote.prepare_client_options: S02, S03
   quote.prepare_request: S02
   quote.record_client_choice: S02, S03
   quote.select_insurers: S02
   quote.track_responses: S02

Renewal skills
   renewal.assess_risk: H01, S11
   renewal.check_documents: S11
   renewal.compare: S03, S11
   renewal.complete: S11
   renewal.explain_change: S03, S11

   renewal.extract_terms: S11
   renewal.find: S11
   renewal.follow_up: S11
   renewal.list_upcoming: H01, S11
   renewal.prepare: S11
   renewal.prepare_placement: S11
   renewal.prepare_recommendation: S11
   renewal.record_client_choice: S11
   renewal.request_terms: S11
   renewal.track_terms: S11

Search skills
   search.documents: H04
   search.email: H04
   search.global: H04
   search.records: H04
   search.relationships: H02, S18
   search.semantic: H02
   search.timeline: H02, S18

Service skills
   service.check_requirements: S06
   service.classify: S06
   service.complete: S06
   service.create: S06
   service.extract_request: S06
   service.follow_up: S06
   service.prepare_insurer_request: S06
   service.review_response: S06
   service.track: S06
   service.update_policy: S06, S08

Team skills
   team.activity: S19
   team.approvals: S19
   team.assign: S19
   team.overdue: S19

    team.performance: S19
    team.reassign: S19
    team.workload: S19

Tor skills
    tor.prepare: S07

Underwriting skills
    underwriting.record_terms: S04
    underwriting.resolve_queries: S04
    underwriting.track_requirements: S04

Work skills
    work.assign: S16
    work.blocked: H01, S16
    work.by_client: S16
    work.by_user: S16
    work.complete: S16
    work.explain: S16
    work.overdue: H01, S16
    work.prioritize: H01, S16
    work.reassign: S16
    work.today: H01, S16
    work.waiting: S16

Master screen list
The 49 surfaces below are the full proposed catalogue. Each screen ID links to its specification. All
shared source/approval/context controls follow Part 1. Record-specific buttons can also open their
linked Space, so the routes below list major explicit exits rather than every possible record instance.

 ID     Screen or Space                   Surface                      Main exits

 O01    Sign in and regain access         Full screen                  O02 H01

 O02    Choose or create a company        Full screen                  H01 O01

                                          Dialog; full screen on
 O03    Add files or paste information                                 O04 J02 X06
                                          mobile

 ID     Screen or Space                    Surface                         Main exits

 O04    Review an import                   Persistent review Space         X03 X02 S01 S05 H01 J02

 O05    Connect email                      Connection dialog               O06 H01

        Connection status and sync
 O06                                       Settings detail with Job link   O05 S15 J02 C03 H01
        review

 H01    Discover, including first use      Permanent destination           H02 S16 S18 O03 O05

                                           Persistent composer and
 H02    Ask ASAP                                                           H04 H03 J02 X01 X03
                                           expandable answer panel

 H03    Spaces library and lifecycle       Permanent destination           H02 X05

                                           Overlay; optional Search
 H04    Global search and saved search                                     S01 S05 S10 S14 S15 S17 J02 X02
                                           Space

 H05    + New                              Small chooser                   O03 H02 X06

 S01    Client Space                       Living Space                    S02 S05 S10 S11 S12 X04 X06

 S02    Opportunity and Quote Space        Living Space                    O03 S03 S04 S14 S15 S20 X01 X06

                                           Space recipe or view within
 S03    Quote and cover comparison                                         S02 S04 S11 S14 S15 X01 X02
                                           Quote/Renewal

 S04    Placement and underwriting         Living Space                    S03 S05 S12 S14 S15 S16 X01 X03

 S05    Policy Space                       Living Space                    S06 S07 S09 S10 S11 S12 S14 S20 X02

                                           Living Space; parent recipe
 S06    Servicing request                                                  S07 S08 S09 S14 S15 S20 X01 X03 X06
                                           for S07-S09

                                           Servicing variant, not a
 S07    TOR preparation                                                    S04 S05 S06 S09 S14 S15 X01
                                           primary destination

 S08    Endorsement and amendment          Servicing variant               S05 S12 S13 S15 X01 X03

 S09    Certificate request and delivery   Servicing variant               S05 S14 S15 X01 X02

 S10    Claim Space                        Living Space                    S12 S14 S15 X01 X02 X04 X06

 S11    Renewal Space                      Living Space                    S03 S04 S14 S15 S20 J02 X01 X06

 S12    Money Space                        Living Space                    S13 S15 S20 X01 X06

 S13    Reconciliation Space               Living Space                    O03 S14 S15 S16 S20 X01

        Document review and prepared       Space recipe; can open as
 S14                                                                       O04 S15 X01 X02 X03
        document                           focused view

 ID     Screen or Space                  Surface                       Main exits

                                         Living Space or scoped
 S15    Communication Space                                            S02 S06 S10 S16 X01 X02 X03
                                         thread view

                                         Generated collection and
 S16    Work Space                                                     X04 X07
                                         item detail

 S17    Report Space                     Saved generated view          S18 A02 X05

 S18    Investigation Space              Living analysis Space         S16 S17 A02 J02 X02 X04 X06

                                         Generated management
 S19    Team Operations Space                                          S16 S17 C02 X01 X04
                                         Space

        Exceptions, cancellation and     Shared case-resolution
 S20                                                                   S02 S05 S10 S11 S13 S15 S16 X01 X04
        economic closure                 recipe

 J01    Jobs                             Permanent destination         J02 X01 X03

 J02    Job detail and recovery          Detail page or panel          S14 C05 X01 X02 X03

 A01    Automations                      Permanent destination         A02 A03 J02

 A02    Automation builder and test      Space recipe                  A01 A03 J02 X01 X04

        Automation history and
 A03                                     History view                  A02 J02
        monitoring

                                         Shared dialog; focused full
 X01    Approval and action review                                     J02 X02 X03
                                         screen for long reviews

                                         Right-side drawer; full
 X02    Source evidence                                                S14 X03
                                         screen on mobile

        Missing facts, conflicts and
 X03                                     Shared resolution panel       O03 S15 S16 X01 X06
        duplicate choice

 X04    Assign or hand off work          Shared dialog                 S16 S19

 X05    Share, save and export scope     Shared dialog                 S14 S15 H03

        Manual creation and focused      Shared form; type-specific
 X06                                                                   O03 X01 X03
        editing                          fields

 X07    Effort and service-cost record   Optional shared panel         O03 S17 C06

                                                                       O01 O02 O05 O06 C02 C03 C04 C05
 C01    Profile and company settings     Menu plus settings landing
                                                                       C06

 ID     Screen or Space                  Surface                        Main exits

        Team membership and
 C02                                     Settings detail                C01 X01 X04
        permissions

        Data, access and security
 C03                                     Settings detail                C01 C05 O06 S14 J02 X01
        controls

 C04    Billing and subscription         Settings detail                C01

                                         Settings list/detail; scoped
 C05    Audit log and event detail                                      J02 X01 X02 X03 S20
                                         drawer

        Insurers, business rules and
 C06                                     Settings detail                C01 O03 S14 X01
        approval policy

Full navigation and transition map
Use the high-level diagram to understand the shared model, then the table for each business handoff.
Exact button-level transitions, close behaviour and error return paths are defined in the catalogue. No
route bypasses company/role checks.

Shared route: an answer stays in context; a task uses a saved Space and only adds a Job or approval when needed.

 Event                           Screen transition                           Result / guard

 Signed in / membership                                                      Existing authorised deep links skip
                                 O01 -> O02 -> H01
 verified                                                                    unnecessary setup.

 Files accepted /                                                            The upload dialog closes; batch review
                                 O03 -> J02 -> O04
 extraction ready                                                            persists.

 Import checked /                                                            Only approved ready items save;
                                 O04 -> S01/S05/other record Space
 committed                                                                   unresolved rows remain.

                                                                             Mailbox access is separate from send
 Email consent / first sync      O05 -> O06 -> J02 -> S15
                                                                             permission.

                                 H01/H02/H04/H05 -> existing or new          Simple answers stay inline; new tasks
 Intent understood
                                 Space                                       persist in H03.

 Risk ready / request            S02 -> S15 -> X01 or human handoff
                                                                             Actual submission evidence advances S4.
 submitted                       -> S02

 Usable terms / client                                                       Quote versions and client authority must
                                 S02/S11 -> S03 -> X01 -> S04
 choice                                                                      match.

 Payment / cover /                                                           Three independent checks; payment alone
                                 S04 -> S12/S13; S04 -> S14 -> S05
 documents                                                                   is not cover.

 Change requested /                                                          Only insurer-confirmed changes update
                                 S05 -> S06 -> S07/S08/S09 -> S05
 confirmed                                                                   effective cover.

 Claim reported /                S05/S15/H05 -> S10 -> S14/S15 ->            Case waits on named requirements/third
 submitted                       S10                                         parties.

 Claim settlement /                                                          Offer, acceptance and receipt remain
                                 S10 -> X01 -> S12 -> S10
 closure                                                                     separate.

                                                                             New policy-year linked; old obligations
 Renewal ready / placed          S05/H01 -> S11 -> S03 -> S04 -> S05
                                                                             remain open.

 Statement / match /
                                 O03/S12 -> S13 -> X01 -> S12                Failed or unmatched lines remain Work.
 posting

 Loss / lapse / cancellation     S02/S05/S11 -> S20 -> S13 if adjusted       Internal intent is not insurer confirmation.

                                                                             Keep evidence and restricted ownership;
 Complaint / late issue          Any related Space -> S20 -> S16/S18
                                                                             no silent close.

 Completion / later              Task checks -> H03 Completed; S20           Later claims/adjustments create a review
 reopening                       -> economic closure                         and preserve history.

 Manager asks / assigns          H02 -> S19/S17 -> X04 -> S16                Owner changes do not grant data access.

 Event                        Screen transition                         Result / guard

 Analysis becomes             S17/S18 -> A02 -> test -> activation ->   Test has no production side effects;
 monitoring                   A03                                       activation is versioned.

                              A01 rule -> A03 -> J02 -> related         No duplicate event creates duplicate
 Trigger / prepared work
                              Space                                     economic action.

                              J02 -> X03/X01 -> J02 -> related          Recheck versions/permissions; show
 Human input / result
                              Space                                     actual outcome.

                              Failed Job -> J02 -> check outcome ->     Successful sends/postings are not
 Failure / retry
                              retry failed step                         repeated.

                              Any source chip -> X02 -> exact           No business mutation; focus and scroll
 Evidence / return
                              parent view                               restored.

                              C01 -> O06 or C02-C06 -> C01 -> prior     Admin actions stay outside the primary
 Admin setting / return
                              Space                                     shell.

Shared reusable components
The AI chooses from these components. It does not invent arbitrary controls, routes or permissions.
Components receive a versioned data shape, stable record references, source links, action IDs and
allowed states. An unsupported component falls back to a safe summary with a supported action, not
executable invented UI.

 Component family          Components and main uses

 Shell and context         AppShell, AskComposer, ContextChip, SpaceHeader, RelatedSpaceLink, ActionMenu

                           ClientHeader, ContactCard, PolicyCard, CoverageTable, PolicyTimeline,
 Client and policy
                           PolicySchedule, ExpiryIndicator, ClaimPartyCard

                           QuoteCard, QuoteComparison, CoverageComparison, InsurerResponseTracker,
 Quote and renewal
                           RenewalReadiness, RenewalTimeline, TermComparison

                           ClaimStatus, ClaimTimeline, MissingDocuments, ServiceProgress,
 Claims and service
                           BeforeAfterChange, EffectiveDateReview

                           DocumentCard, DocumentViewer, DocumentChecklist, ExtractionReview,
 Documents and email
                           EmailThread, DraftEmail, CommunicationSummary

                           OutstandingPremiumCard, InvoiceTable, PaymentTimeline,
 Money and effort
                           CommissionReconciliation, AllocationEditor, TaxEvidenceCard, EffortEntry

 Component family           Components and main uses

                            WorkCard, WaitingCard, ExceptionCard, ApprovalCard, AssignmentCard,
 Human work
                            CompletionChecklist

                            RecommendationCard, Metric, Table, Chart, Timeline, Checklist, Alert, ActivityFeed,
 Analysis
                            SourceEvidence

                            JobProgress, StepOutcome, TriggerConditionEditor, ApprovalRule, TestResult,
 AI and rules
                            AutomationRunHistory

                            EmptyState, LoadingStep, MissingData, ConflictReview, PartialSuccess, StaleData,
 Shared states
                            PermissionNotice, ErrorRecovery

Every component supports readable empty/loading/error states and role checks. Evidence chips are
local to the fact they support. Use one reusable approval, source, assignment and record picker rather
than designing a different interaction in every Space.

Missing screens, unclear flows and decisions to confirm
These source gaps have proposed screen paths, but their rules need confirmation. This is not a live-app
audit or a claim that the current app lacks these features.

1. TOR meaning and authority
[E] uses Time on Risk, while [I] only names TOR. Confirm its meaning, issuing process, required fields and
whether it is standalone cover or a service request. S07 supports either route explicitly. Do not expand
this abbreviation differently in different screens.

2. External execution policy
Default to drafts that humans send. [I] also allows approved sending and configurable automation.
Confirm whether approved-send is included, who enables it and which connectors report reliable
outcomes. Keep manual sending usable. This does not authorise autonomous binding, claim settlement
decisions or money transfers.

3. Company-specific rules
Confirm rate agreements, tax treatment, deadlines, start/stop events, approval limits, required
documents and insurer appointment scope. C06 stores validated versions. The source report's
profit/WHT inconsistency must be resolved before financial reporting is accepted. Compliance review is
required before legal timers or tax calculations become production rules.

4. Exceptions not named as skills
The economic model requires no-bid, lost quote, lapse, cancellation, refund, commission clawback,
complaint and economic closure. [I] does not name all these skills. S20 supplies their screen paths. Add
or verify the matching backend actions, permissions and evidence checks; do not drop these features.

5. Service cost and profitability
The economic model asks whether service cost exceeds revenue, but neither document supplies
measured staff effort, rates or overhead allocation. X07 is a proposed low-friction path. Confirm data
sources and whether reporting shows direct contribution, allocated profit or only workload. Never use
elapsed waiting time as labour cost.

6. Manual record and connector limits
Confirm supported file formats, batch/size limits, duplicate/merge rules, rollback limits, email providers
and shared-mailbox permissions. O03-O06/X06 define the user experience, not a promise that any file or
mailbox already works. Unknown types need a clear manual fallback, not silent failure.

7. Access, data, billing and sharing
Confirm actual identity provider, invitation rules, approval delegation, retention, security controls,
export rights, billing provider and external sharing policy. C01-C05 and X05 supply the necessary
surfaces without inventing prices or backend support. Server-side enforcement is essential; hidden
buttons are not security.

8. Product breadth and legacy preservation
[E] focuses on Kenyan general-insurance brokerages. Medical, life, specialist placement and tied
agencies need their own requirements and permitted markets. All 163 supplied skills have paths here.
Before migration, also map every legacy action to a screen; keep any unmatched feature until its
replacement is verified.

Final product test
A new employee can sign in, add records, connect email, ask for work, check evidence and act without
learning a menu tree. A manager can review risk, assign work, approve decisions and test rules. The
detail appears with the task; the main screen stays simple.
