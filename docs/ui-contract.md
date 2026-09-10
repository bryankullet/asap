# ASAP UI contract

Ported from the v4 prototype's `interaction-contract.md` (UI Build Spec v1, Part 0) and updated to the Screen Map v3 vocabulary. The build spec wins where this file and it disagree; this file is the short version a reviewer checks a screen against.

## Navigation

The visible destinations are **Discover**, **Work** and **Automations**, in that order (D-060 renamed Today; the count is unchanged). **Ask** sits after them and is always available. The **Activity chip** comes last and renders only while a run is working, paused, or finished this session. New and Search are utilities. Profile stays at the bottom. Internal recipe names and insurance modules (Clients, Policies, Renewals, Claims, Money) are never navigation labels (Architecture v3.1 §45).

Work has four views: **Needs you**, **With others**, **Recent** and **Done**. Pinned is a personal marker, not a view. A title names the outcome or the record, never its internal recipe.

## Status is a typed contract

Each status word belongs to one layer only (`packages/schema/src/status.ts`; the test proves no label is shared):

| Layer | Allowed labels | Position |
|---|---|---|
| Task | Needs you · With {party} since {date} · In progress · Done | Card headline, record header |
| Evidence | Known · Inferred · Conflicting · Missing · Stale · Waiting for verification | Beside a fact, never in a status slot (D-060) |
| Run | Working · Paused · Finished · Couldn't finish · Stopped | Activity panel, run detail |
| Cover | Draft · Requested · Submitted · Confirmed · Active cover · Expired · Cancelled | Policy period line |
| Money | Not invoiced · Unpaid · Part paid · Paid · Received · Reconciled · Disputed · Due to insurer · Settled | Money row |
| File | Not started · Incomplete · In review · Cleared · Refresh due | Client header, `/files` |
| Stock | Allocated · Issued · Voided · Unaccounted | `/settings/certificates` |

Banned in rendered output: *Waiting*, *Failed*, *Success*, *Space*, *Job*, and *Completed* outside the task layer. A task with another party names the party, the since date and the next check; a bare "Waiting" never appears. Never infer cover from a task or a run result. Never infer cash from a policy result. Compliance and stock never reach a work card: an incomplete client file is a blocked step with a reason.

## Runs and Activity

Activity is optional. Every paused or could-not-finish run creates or updates human work in the same transaction. Every finished run has an output in its related work, and its completion message names the output ("Renewal pack prepared"), never a business outcome ("Policy renewed"). Hiding Activity must not hide any decision or failure.

## Draft and send

Copying a draft and opening an email app never create a sent event. An external send is recorded only after the person confirms it and supplies evidence. `sentAt` without `sentEvidence` is a defect. An unknown send outcome disables retry until an outcome check runs.

## Ask

Ask returns an intent (`UiIntent`), never markup, through the ASAP AI gateway. It opens and prepares things; it cannot send, bind, pay, clear a file, issue or void a certificate, or approve anything. In Phase 1 it only searches.

## Data

Reads go through `supabase-js` under RLS with the user's session. Domain writes go to the API. Local storage holds UI preferences only, never domain data. Hidden rows never appear in counts. A restricted field says "Not available to your role", never blank or zero.

## Mapping from the v1 catalogue

H01 maps to Discover (D-060; it was Today). H03 and S16 combine as the Work views. J01 maps to the optional Activity panel; J02 remains run detail. Other task recipes are reached through Ask, Search, New and related work. Status and navigation wording here supersedes earlier catalogue wording.

## What code checks do not prove

Code checks verify routing, labels, visibility and draft/send separation. They do not prove human learnability or insurance judgment; the day-three checks in Screen Map v3 Part 7 require observation with a real new hire.
