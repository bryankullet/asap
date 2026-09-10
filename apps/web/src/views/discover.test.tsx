/**
 * Discover as a surface, not just a renamed Today (D-060).
 *
 * The ranking itself belongs to the API and is proven in apps/api/test/attention.test.ts. These
 * tests cover what the view promises a person: every card says why it matters, names its client
 * and period, states how well each fact is known, leads somewhere, and tells the truth when part
 * of the answer could not be loaded.
 */
import type { AttentionItem, AttentionResponse, WorkItemRow } from "@asap/schema";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { DiscoverView } from "./DiscoverView.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const ID = "30000000-0000-4000-8000-000000000005";
const iso = "2026-09-08T09:00:00.000Z";

const item = (over: Partial<WorkItemRow> = {}): WorkItemRow => ({
  id: ID,
  organization_id: ORG,
  title: "Acme Motors — Motor commercial placement with Jubilee",
  kind: "placement",
  client_id: "70000000-0000-4000-8000-00000000000a",
  policy_period_id: "60000000-0000-4000-8000-0000000000a1",
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: null,
  task_next_check: null,
  cover_status: "requested",
  cover_inception_at: null,
  money_status: null,
  reason: "Approval is blocked until Acme Motors' client file is cleared.",
  steps: [],
  exception: null,
  version: 2,
  created_at: iso,
  updated_at: iso,
  completed_at: null,
  deleted_at: null,
  ...over,
});

const row = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  section: "needs_you",
  rank: 1,
  score: 141,
  item: item(),
  reason: "Approval is blocked until Acme Motors' client file is cleared.",
  signals: [
    { id: "step_blocked", because: '"Placement approved" is blocked by client_file_cleared.', points: 55 },
    { id: "cover_uncertain", because: "Cover was requested and no insurer confirmation is recorded.", points: 48 },
    { id: "file_blocks_placement", because: "The client's file is not cleared, and it is blocking this placement.", points: 38 },
  ],
  nowStep: { id: "approve", label: "Placement approved", actor: "you" },
  client: { id: "70000000-0000-4000-8000-00000000000a", name: "Acme Motors" },
  period: {
    id: "60000000-0000-4000-8000-0000000000a1",
    classOfBusiness: "Motor commercial",
    insurerName: "Jubilee",
    policyNumber: "MC-4471",
    periodStart: "2025-10-14",
    periodEnd: "2026-10-14",
    daysToEnd: 30,
  },
  facts: [
    {
      label: "Cover for this period",
      condition: "waiting",
      reference: null,
      recordedBy: null,
      recordedAt: null,
      derivedFrom: "Requested. A request is not proof of cover; no insurer confirmation is recorded.",
    },
    { label: "Client instruction", condition: "known", reference: "Email 4 September", recordedBy: "Amina", recordedAt: iso, derivedFrom: null },
    { label: "Sum insured", condition: "conflicting", reference: null, recordedBy: null, recordedAt: null, derivedFrom: "Schedule KSh 4.2M vs spreadsheet KSh 3.8M" },
    { label: "Certificate", condition: "missing", reference: null, recordedBy: null, recordedAt: null, derivedFrom: null },
    { label: "Fleet list", condition: "stale", reference: "List of 2 Jan", recordedBy: "Brian", recordedAt: "2026-01-02T00:00:00.000Z", derivedFrom: "Recorded 250 days ago" },
    { label: "Cover is active from the inception date", condition: "inferred", reference: null, recordedBy: null, recordedAt: iso, derivedFrom: "Confirmed cover plus the recorded inception date" },
  ],
  runFailure: null,
  links: {
    work: `/r/${ID}`,
    client: "/files/70000000-0000-4000-8000-00000000000a",
    policy: "/r/60000000-0000-4000-8000-0000000000a1?kind=policy",
    ask: "Acme Motors — Motor commercial placement with Jubilee",
  },
  ...over,
});

const body = (over: Partial<AttentionResponse> = {}): AttentionResponse => ({
  organization: { id: ORG, name: "Acme Insurance Brokers" },
  generatedAt: iso,
  items: [row()],
  sections: [
    { key: "needs_you", label: "Needs you", visible: 1, returned: 1 },
    { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
  ],
  orphanRuns: [],
  degraded: [],
  cap: 12,
  ...over,
});

describe("Discover", () => {
  it("says why an item matters, in the engine's words and the ranking's", async () => {
    await renderInRouter(<DiscoverView data={body()} />);
    fireEvent.click(screen.getByRole("button", { name: "Why here?" }));
    expect(
      screen.getByText("Approval is blocked until Acme Motors' client file is cleared."),
    ).toBeInTheDocument();
    // The signals that ranked it, each naming the row it came from.
    expect(screen.getByText('"Placement approved" is blocked by client_file_cleared.')).toBeInTheDocument();
    expect(
      screen.getByText("Cover was requested and no insurer confirmation is recorded."),
    ).toBeInTheDocument();
    // The score itself is never shown to a person; it exists so the order is auditable.
    expect(screen.queryByText(/141/)).toBeNull();
  });

  it("names the client and the client-policy-year", async () => {
    await renderInRouter(<DiscoverView data={body()} />);
    expect(screen.getByRole("link", { name: "Acme Motors" })).toHaveAttribute(
      "href",
      "/files/70000000-0000-4000-8000-00000000000a",
    );
    expect(screen.getByRole("link", { name: "Motor commercial with Jubilee" })).toBeInTheDocument();
    expect(screen.getByText(/2025-10-14 to 2026-10-14/)).toBeInTheDocument();
    expect(screen.getByText(/ends in 30 days/)).toBeInTheDocument();
  });

  it("shows all six evidence conditions, and never a confidence", async () => {
    await renderInRouter(<DiscoverView data={body()} />);
    fireEvent.click(screen.getByRole("button", { name: /Evidence \(6\)/ }));
    for (const label of ["Known", "Inferred", "Conflicting", "Missing", "Stale", "Waiting for verification"]) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
    // Conflicting shows both sources and resolves neither.
    expect(screen.getByText(/Schedule KSh 4.2M vs spreadsheet KSh 3.8M/)).toBeInTheDocument();
    // Inferred always says what it came from.
    expect(screen.getByText(/Confirmed cover plus the recorded inception date/)).toBeInTheDocument();
    // The bare word "Waiting" is banned; the evidence condition is written out in full.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bWaiting\b(?!\sfor verification)/);
    expect(text).not.toMatch(/confidence/i);
    expect(text).not.toMatch(/\d+%/);
  });

  it("leads somewhere from every card", async () => {
    const { container } = await renderInRouter(<DiscoverView data={body()} />);
    const card = container.querySelector('[data-testid="work-card"]')!;
    expect(within(card as HTMLElement).getByRole("link", { name: /Open the work/ })).toHaveAttribute(
      "href",
      `/r/${ID}`,
    );
    // Ask opens on this item's own words, without leaving the shell.
    expect(within(card as HTMLElement).getByRole("link", { name: "Ask about this" })).toHaveAttribute(
      "href",
      expect.stringContaining("ask=") as unknown as string,
    );
  });

  it("says what it could not load rather than showing a gap", async () => {
    await renderInRouter(
      <DiscoverView
        data={body({ degraded: [{ what: "Periods of cover", because: "The policy period rows could not be read." }] })}
      />,
    );
    expect(screen.getByText("Some of this could not be loaded")).toBeInTheDocument();
    expect(screen.getByText(/The policy period rows could not be read/)).toBeInTheDocument();
    // And still renders the item it does have.
    expect(screen.getByText("Acme Motors — Motor commercial placement with Jubilee")).toBeInTheDocument();
  });

  it("says how many it left out when a section is capped", async () => {
    await renderInRouter(
      <DiscoverView
        data={body({
          sections: [
            { key: "needs_you", label: "Needs you", visible: 40, returned: 1 },
            { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Showing 1 of 40/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all in Work" })).toBeInTheDocument();
  });

  it("offers a way on when nothing needs anyone", async () => {
    await renderInRouter(<DiscoverView data={body({ items: [], sections: [
      { key: "needs_you", label: "Needs you", visible: 0, returned: 0 },
      { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
    ] })} />);
    expect(screen.getByText(/Nothing needs you right now/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See what is with others" })).toBeInTheDocument();
  });
});
