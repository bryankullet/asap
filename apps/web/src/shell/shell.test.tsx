/**
 * The permanent shell, against the approved demo (D-064).
 *
 * The nav is now five destinations — Discover · Ask ASAP · Work · Jobs · Automations — and Jobs
 * has left NEVER_NAV, because the approved demo gives it a surface and §45 rule 16 bans insurance
 * modules, which Jobs is not. What the banned list still holds is exactly that module tree.
 *
 * The record-view assertion is unchanged: no view may leak the word "Space" or a raw status word.
 */
import type { RunRow, WorkItemRow } from "@asap/schema";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItemView } from "../views/RecordViews.js";
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
  it("renders the approved five destinations in order (D-064)", async () => {
    expect(NAV.map((n) => [n.to, n.glyph, n.label])).toEqual([
      ["/discover", "✦", "Discover"],
      ["/ask", "⌁", "Ask ASAP"],
      ["/work", "▱", "Work"],
      ["/jobs", "◴", "Jobs"],
      ["/automations", "⌘", "Automations"],
    ]);
    await renderInRouter(<ShellNav />);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      "✦Discover",
      "⌁Ask ASAP",
      "▱Work",
      "◴Jobs",
      "⌘Automations",
    ]);
  });

  it("never offers an insurance module as a destination", async () => {
    await renderInRouter(<ShellNav />);
    for (const banned of NEVER_NAV) {
      expect(screen.queryByRole("link", { name: new RegExp(`^${banned}$`) })).toBeNull();
    }
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
      // "Space" must never surface — it is called Work on screen. The status words are no longer
      // banned: Active, Waiting, For review and Completed *are* the approved vocabulary (D-064),
      // and the old assertion forbade exactly the language the demo is built on.
      expect(html).not.toMatch(/Renewal Space|Space:/);
      expect(html).not.toMatch(/Needs you/);
      // Only "Space" stays banned — it is called Work on screen. Waiting, Active, For review and
      // Completed are now the approved vocabulary (D-064), so the old list forbade the very words
      // the demo is built from.
      expect(html).not.toMatch(/\bSpace\b/);
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

  it("is the ••• control beside the sidebar's own profile row (D-064)", async () => {
    await renderInRouter(
      <ProfileMenu me={me} switching={false} onSwitch={() => {}} onSignOut={() => {}} />,
    );
    // The approved demo draws the avatar, person and role in the sidebar itself; this is the
    // control beside them, so it carries no duplicate text of its own.
    const control = screen.getByRole("button", { name: "Profile and company" });
    expect(control).not.toHaveTextContent("Amina Otieno");
    expect(screen.queryByRole("menu")).toBeNull();
    // The approved demo's company paths (D-064).
    for (const name of [
      "Team and permissions",
      "Insurers and business rules",
      "Data and connections",
      "Audit history",
      "Client files",
      "Sign out",
    ]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    fireEvent.click(control);
    const menu = screen.getByRole("menu", { name: "Profile" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((e) => e.textContent?.trim()),
    ).toEqual([
      "Team and permissions",
      "Insurers and business rules",
      "Data and connections",
      "Audit history",
      "Client files",
      "Sign out",
    ]);
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
    fireEvent.click(screen.getByRole("button", { name: "Profile and company" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Active brokerage" }), {
      target: { value: "10000000-0000-4000-8000-00000000000b" },
    });
    expect(onSwitch).toHaveBeenCalledWith("10000000-0000-4000-8000-00000000000b");
  });
});

describe("profile control with one brokerage (D-055)", () => {
  it("names the only brokerage in the menu, never 'Choose a brokerage'", async () => {
    const one = {
      user: {
        id: "a0000000-0000-4000-8000-000000000001",
        email: "amina@acme.test",
        full_name: "Amina Otieno",
      },
      active_organization: null,
      memberships: [
        { organization: { id: ORG, name: "Acme Insurance Brokers" }, status: "active" },
      ],
      permissions: [],
    } as unknown as Parameters<typeof ProfileMenu>[0]["me"];
    await renderInRouter(
      <ProfileMenu me={one} switching={false} onSwitch={() => {}} onSignOut={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Profile and company" }));
    const menu = screen.getByRole("menu", { name: "Profile" });
    // One membership is never a choice: the switcher is not offered at all.
    expect(within(menu).queryByRole("combobox")).toBeNull();
    expect(within(menu).queryByText(/Choose a brokerage/)).toBeNull();
  });
});
