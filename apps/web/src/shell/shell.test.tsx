/**
 * Ported from the prototype's checks.mjs (UI Build Spec v1 Part 0, Part 1):
 *   line 26 — the nav order regex `['today','☀','Today'],['work','▣','Work'],['automations'`;
 *   line 19 — Today with Activity hidden still shows the KDA 482A item and a "Why here?" control;
 *   line 23 — every record view renders and contains none of
 *             /Renewal Space|Space:|>Waiting<|>Completed<|>Active</.
 * Insurance modules are never destinations (Architecture v3.1 §45).
 */
import type { RunRow, WorkItemRow } from "@asap/schema";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItemView } from "../views/RecordViews.js";
import { TodayView } from "../views/TodayView.js";
import { renderInRouter } from "../test-utils.js";
import { NAV, NEVER_NAV } from "./nav.js";
import { ProfileMenu } from "./ProfileMenu.js";
import { ShellNav } from "./ShellNav.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const item = (over: Partial<WorkItemRow>): WorkItemRow => ({
  id: "30000000-0000-4000-8000-000000000002",
  organization_id: ORG,
  title: "KDA 482A — motor certificate",
  kind: "certificate",
  client_id: null,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: null,
  task_next_check: null,
  cover_status: "confirmed",
  cover_inception_at: null,
  money_status: null,
  reason: "Cover is confirmed but no certificate number has been allocated.",
  steps: [
    {
      id: "s1",
      label: "Cover confirmed",
      actor: "insurer",
      state: "done",
      guards: [],
      reason: null,
      evidence: [],
      actions: [],
      party: null,
      recorded: [],
      runId: null,
    },
    {
      id: "s2",
      label: "Allocate a number",
      actor: "you",
      state: "now",
      guards: [],
      reason: null,
      evidence: [],
      actions: [],
      party: null,
      recorded: [],
      runId: null,
    },
  ],
  exception: null,
  version: 1,
  created_at: daysAgo(1),
  updated_at: daysAgo(0),
  completed_at: null,
  deleted_at: null,
  ...over,
});

const FIXTURES: WorkItemRow[] = [
  item({}),
  item({
    id: "30000000-0000-4000-8000-000000000001",
    title: "Acme Motors — renewal terms from Jubilee",
    kind: "renewal",
    task_status: "with_party",
    task_party: "Jubilee",
    task_since: daysAgo(3),
    task_next_check: daysAgo(1),
    cover_status: "active",
    money_status: "unpaid",
  }),
  item({
    id: "30000000-0000-4000-8000-000000000003",
    title: "Jane Wanjiku — claim review pack",
    kind: "claim",
    task_status: "in_progress",
    cover_status: "active",
  }),
  item({
    id: "30000000-0000-4000-8000-000000000004",
    title: "Acme Motors — Q2 statement reconciled",
    kind: "reconciliation",
    task_status: "done",
    cover_status: null,
    money_status: "reconciled",
    completed_at: daysAgo(2),
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
    started_at: daysAgo(0),
    ended_at: daysAgo(0),
    created_at: daysAgo(0),
    updated_at: daysAgo(0),
  },
];

describe("shell navigation", () => {
  it("renders Today, Work, Automations in that order (checks.mjs line 26)", async () => {
    expect(NAV.map((n) => [n.to, n.glyph, n.label])).toEqual([
      ["/today", "☀", "Today"],
      ["/work", "▣", "Work"],
      ["/automations", "⟳", "Automations"],
    ]);
    await renderInRouter(<ShellNav />);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual(["☀Today", "▣Work", "⟳Automations"]);
  });

  it("never offers an insurance module as a destination", async () => {
    await renderInRouter(<ShellNav />);
    for (const banned of NEVER_NAV) {
      expect(screen.queryByRole("link", { name: new RegExp(`^${banned}$`) })).toBeNull();
    }
  });
});

describe("Today with Activity hidden (checks.mjs line 19)", () => {
  it("shows the item that needs you and a Why here? control", async () => {
    // TodayView never renders the Activity chip; a run that could not finish reaches Today through its work item.
    await renderInRouter(<TodayView items={FIXTURES} runs={RUNS} orgName="Acme" />);
    expect(screen.getByText(/KDA 482A/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Why here?" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/could not finish: Check this file/)).toBeInTheDocument();
    // The overdue check with Jubilee is on Today too, named with its party.
    expect(screen.getByText(/With Jubilee since/)).toBeInTheDocument();
  });
});

describe("record views (checks.mjs line 23)", () => {
  it.each(FIXTURES.map((f) => [f.title, f] as const))(
    "%s renders without banned words",
    async (_title, fixture) => {
      const { container } = await renderInRouter(
        <WorkItemView item={fixture} runs={RUNS} />,
        `/r/${fixture.id}`,
      );
      const html = container.innerHTML;
      expect(html.length).toBeGreaterThan(30);
      expect(html).not.toMatch(/Renewal Space|Space:|>Waiting<|>Completed<|>Active</);
      expect(html).not.toMatch(/\b(Waiting|Failed|Success|Space|Job)\b/);
    },
  );
});

describe("profile control (C01)", () => {
  const me = {
    user: {
      id: "a0000000-0000-4000-8000-000000000001",
      email: "amina@acme.test",
      full_name: "Amina Otieno",
    },
    active_organization: { id: ORG, name: "Acme Insurance Brokers" },
    memberships: [
      { organization: { id: ORG, name: "Acme Insurance Brokers" }, status: "active" },
      {
        organization: { id: "10000000-0000-4000-8000-00000000000b", name: "Beta Risk" },
        status: "active",
      },
    ],
    permissions: [],
  } as unknown as Parameters<typeof ProfileMenu>[0]["me"];

  it("shows brokerage and person as one control, with the utilities behind it", async () => {
    await renderInRouter(
      <ProfileMenu me={me} switching={false} onSwitch={() => {}} onSignOut={() => {}} />,
    );
    const control = screen.getByRole("button", { name: /Acme Insurance Brokers/ });
    expect(control).toHaveTextContent("Amina Otieno");
    expect(screen.queryByRole("menu")).toBeNull();
    for (const name of ["Members", "Agreements", "Client files", "Sign out"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    fireEvent.click(control);
    const menu = screen.getByRole("menu", { name: "Profile" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((e) => e.textContent?.trim()),
    ).toEqual(["Members", "Agreements", "Client files", "Sign out"]);
    expect(within(menu).getByRole("combobox", { name: "Active brokerage" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("signs out and switches brokerage from the menu", async () => {
    const onSignOut = vi.fn();
    const onSwitch = vi.fn();
    await renderInRouter(
      <ProfileMenu me={me} switching={false} onSwitch={onSwitch} onSignOut={onSignOut} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Acme Insurance Brokers/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Active brokerage" }), {
      target: { value: "10000000-0000-4000-8000-00000000000b" },
    });
    expect(onSwitch).toHaveBeenCalledWith("10000000-0000-4000-8000-00000000000b");
  });
});
