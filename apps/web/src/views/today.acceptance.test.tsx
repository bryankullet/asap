/**
 * Today's acceptance fixture (docs/click-through.md). The rows below are the rows Amina Otieno
 * actually receives from hosted through RLS — copied from the live query, not invented — so this
 * test fails if the seed stops producing the five cards the click-through document promises.
 */
import type { RunRow, WorkItemRow } from "@asap/schema";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { attentionFixture, renderInRouter } from "../test-utils.js";
import { TodayView } from "./TodayView.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

const item = (over: Partial<WorkItemRow> & Pick<WorkItemRow, "id" | "title">): WorkItemRow => ({
  organization_id: ORG,
  kind: "renewal",
  client_id: null,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: null,
  task_next_check: null,
  cover_status: null,
  cover_inception_at: null,
  money_status: null,
  reason: null,
  steps: [],
  exception: null,
  version: 1,
  created_at: iso(6 * DAY),
  updated_at: iso(DAY),
  completed_at: null,
  deleted_at: null,
  ...over,
});

const CLAIM_REASON =
  "The incident came in by email and is still a draft. Choose the policy period that covers 2 September before anything is sent to Jubilee.";
const ENDORSEMENT_REASON =
  "Jubilee has answered every item: one vehicle accepted, one rejected. Applying the answer writes a new policy version.";
const PLACEMENT_REASON = "Approval is blocked until Acme Motors' client file is cleared.";
const CERTIFICATE_REASON =
  "Cover is confirmed but no certificate number has been allocated for this vehicle.";
const RENEWAL_REASON =
  "Terms were requested from Jubilee five days ago and the check was due yesterday.";

const ITEMS: WorkItemRow[] = [
  item({
    id: "30000000-0000-4000-8000-000000000003",
    title: "Jane Wanjiku — claim, incident 2 September",
    kind: "claim",
    cover_status: "active",
    reason: CLAIM_REASON,
    updated_at: iso(5 * 60_000),
  }),
  item({
    id: "30000000-0000-4000-8000-000000000006",
    title: "Acme Motors — add KDC 900T to the Motor commercial policy",
    kind: "endorsement",
    cover_status: "active",
    reason: ENDORSEMENT_REASON,
    updated_at: iso(2 * 3_600_000),
  }),
  item({
    id: "30000000-0000-4000-8000-000000000005",
    title: "Acme Motors — Motor commercial placement with Jubilee",
    kind: "placement",
    cover_status: "requested",
    reason: PLACEMENT_REASON,
  }),
  item({
    id: "30000000-0000-4000-8000-000000000002",
    title: "KDA 482A — motor certificate",
    kind: "certificate",
    cover_status: "confirmed",
    reason: CERTIFICATE_REASON,
    updated_at: iso(20 * 60_000),
  }),
  item({
    id: "30000000-0000-4000-8000-000000000001",
    title: "Acme Motors — renewal terms from Jubilee",
    task_status: "with_party",
    task_party: "Jubilee",
    task_since: iso(5 * DAY),
    task_next_check: iso(DAY),
    cover_status: "active",
    money_status: "unpaid",
    reason: RENEWAL_REASON,
  }),
];

const RUNS: RunRow[] = [
  {
    id: "40000000-0000-4000-8000-000000000003",
    organization_id: ORG,
    work_item_id: "30000000-0000-4000-8000-000000000002",
    title: "Certificate extraction",
    status: "could_not_finish",
    next_step: "Check this file",
    started_by: null,
    boot_token: null,
    started_at: iso(3_600_000),
    ended_at: iso(3_300_000),
    created_at: iso(3_600_000),
    updated_at: iso(3_300_000),
  },
];

describe("Amina's Today (acceptance)", () => {
  it("shows five cards: four that need her and one check that is due", async () => {
    await renderInRouter(<TodayView data={attentionFixture(ITEMS, RUNS)} />);
    expect(screen.getAllByTestId("work-card")).toHaveLength(5);

    const needsYou = screen.getByRole("region", { name: "Needs you" });
    const cards = within(needsYou).getAllByTestId("work-card");
    expect(cards).toHaveLength(4);
    // The status word on each card, not the section heading of the same name.
    for (const card of cards) expect(within(card).getByText("Needs you")).toBeInTheDocument();

    const checksDue = screen.getByRole("region", { name: "Checks due" });
    expect(within(checksDue).getAllByTestId("work-card")).toHaveLength(1);
    expect(within(checksDue).getByText(/^With Jubilee since /)).toBeInTheDocument();
  });

  it("names every item and the step that is waiting", async () => {
    await renderInRouter(<TodayView data={attentionFixture(ITEMS, RUNS)} />);
    for (const title of [
      "Jane Wanjiku — claim, incident 2 September",
      "Acme Motors — add KDC 900T to the Motor commercial policy",
      "Acme Motors — Motor commercial placement with Jubilee",
      "KDA 482A — motor certificate",
      "Acme Motors — renewal terms from Jubilee",
    ]) {
      expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
    }
  });

  it("gives every card a Why here? that states the reason", async () => {
    await renderInRouter(<TodayView data={attentionFixture(ITEMS, RUNS)} />);
    const why = screen.getAllByRole("button", { name: "Why here?" });
    expect(why).toHaveLength(5);
    for (const b of why) fireEvent.click(b);
    for (const reason of [
      CLAIM_REASON,
      ENDORSEMENT_REASON,
      PLACEMENT_REASON,
      CERTIFICATE_REASON,
      RENEWAL_REASON,
    ]) {
      expect(screen.getByText(reason)).toBeInTheDocument();
    }
  });

  it("says on the certificate card that ASAP could not finish, and why", async () => {
    await renderInRouter(<TodayView data={attentionFixture(ITEMS, RUNS)} />);
    expect(screen.getByText(/ASAP could not finish: Check this file\./)).toBeInTheDocument();
  });
});
