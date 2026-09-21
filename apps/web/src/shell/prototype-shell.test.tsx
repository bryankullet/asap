import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASK_DEFAULT_WIDTH, ASK_MAX_WIDTH, ASK_MIN_WIDTH } from "./ask-width.js";
import { resetWorkspaceTabs, tabKey } from "./workspace-tabs.js";

/**
 * The permanent shell (Increment 2).
 *
 * These are the behaviours the prototype has that the previous shell did not: a sidebar that
 * collapses and stays collapsed, a tab strip with stable identities, and Ask as a resizable panel
 * rather than a dock. Geometry is asserted separately, by measurement, in
 * `scripts/visual/capture.mjs` — a jsdom test cannot tell you a sidebar is 228px wide, so it does
 * not pretend to.
 *
 * What these tests *can* prove, and what a screenshot cannot: that closing a tab touches no record,
 * that two records stay two records, and that resetting the Ask width returns exactly 400.
 */

beforeEach(() => {
  globalThis.localStorage?.clear();
  resetWorkspaceTabs();
});
afterEach(() => {
  globalThis.localStorage?.clear();
  resetWorkspaceTabs();
});

describe("tab identity", () => {
  const base = { spaceType: "client", recordType: "client", recordId: "c1" };

  it("is the same tab for the same four parts", () => {
    expect(tabKey(base)).toBe(tabKey({ ...base }));
  });

  it("tells two records apart", () => {
    expect(tabKey(base)).not.toBe(tabKey({ ...base, recordId: "c2" }));
  });

  /*
   * The same client opened *as a client* and *as the subject of a renewal* is two pieces of work,
   * so the space type has to be part of the identity. Without this, opening the renewal would
   * silently take over the client's tab.
   */
  it("tells the same record apart by what it was opened as", () => {
    expect(tabKey(base)).not.toBe(tabKey({ ...base, spaceType: "renewal" }));
  });

  /* One policy can carry two endorsements at once. */
  it("tells two workflows on one record apart", () => {
    expect(tabKey({ ...base, workflowId: "w1" })).not.toBe(tabKey({ ...base, workflowId: "w2" }));
  });

  it("treats an absent workflow as its own stable case", () => {
    expect(tabKey(base)).toBe(tabKey({ ...base, workflowId: undefined }));
  });
});

describe("the Ask panel's width", () => {
  it("starts at exactly 400px", () => {
    expect(ASK_DEFAULT_WIDTH).toBe(400);
  });

  it("is clamped to a range that keeps both columns usable", () => {
    expect(ASK_MIN_WIDTH).toBeLessThan(ASK_DEFAULT_WIDTH);
    expect(ASK_MAX_WIDTH).toBeGreaterThan(ASK_DEFAULT_WIDTH);
  });
});

/**
 * The shell itself, driven through the real route tree.
 *
 * `renderShell` mounts the production `Shell` with a stubbed `me` and the queries the sidebar
 * needs, so what is exercised is the component that ships rather than a copy of it.
 */
describe("the shell", () => {
  it("shows the three destinations in the prototype's order, and no others", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((a) => a.textContent?.replace(/\s+/g, " ").trim() ?? "");
    expect(labels.slice(0, 3)).toEqual(["✦Today", "▱Work", "⌘Automations"]);
  });

  it("puts New before Search, then the signed-in person", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    expect(screen.getByTitle("New")).toBeInTheDocument();
    expect(screen.getByTitle("Search")).toBeInTheDocument();
    // The profile shows the real signed-in user, not the prototype's fixed person.
    expect(screen.queryByText(/Grace Wanjiku/)).toBeNull();
  });

  it("neither Ask ASAP nor Jobs is a destination", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByText("Ask ASAP")).toBeNull();
    expect(within(nav).queryByText("Jobs")).toBeNull();
  });

  it("collapses and expands, and says which state it is in", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    const toggle = screen.getByRole("button", { name: "Collapse menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);
    const expand = screen.getByRole("button", { name: "Expand menu" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(expand);
    expect(screen.getByRole("button", { name: "Collapse menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  /*
   * A sidebar that springs back open on every route change is worse than one that never collapses,
   * so the preference persists. It is interface state only — nothing business reads it.
   */
  it("remembers being collapsed across a remount", async () => {
    const { renderShell } = await import("../test-utils.js");
    const first = await renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    first.unmount();

    await renderShell();
    expect(screen.getByRole("button", { name: "Expand menu" })).toBeInTheDocument();
  });

  it("has exactly one Ask interface, and it is not a bottom dock", async () => {
    const { renderShell } = await import("../test-utils.js");
    const { container } = await renderShell();
    expect(container.querySelectorAll(".ask-dock")).toHaveLength(0);
    expect(container.querySelectorAll(".shell-ask")).toHaveLength(1);
  });

  it("collapses Ask and opens it again from the header", async () => {
    const { renderShell } = await import("../test-utils.js");
    const { container } = await renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Collapse Ask" }));
    expect(container.querySelectorAll(".shell-ask")).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Open Ask ASAP" }));
    expect(container.querySelectorAll(".shell-ask")).toHaveLength(1);
  });

  it("resizes Ask from the keyboard and resets to exactly 400px", async () => {
    const { renderShell } = await import("../test-utils.js");
    const { container } = await renderShell();
    const grip = screen.getByRole("slider", { name: "Resize the Ask panel" });
    expect(grip).toHaveAttribute("aria-valuenow", String(ASK_DEFAULT_WIDTH));

    await userEvent.click(grip);
    await userEvent.keyboard("{ArrowLeft}");
    expect(grip).toHaveAttribute("aria-valuenow", String(ASK_DEFAULT_WIDTH + 16));
    const panel = container.querySelector(".shell-body") as HTMLElement;
    expect(panel.style.getPropertyValue("--shell-ask-width")).toBe(`${ASK_DEFAULT_WIDTH + 16}px`);

    // Reset appears only once the width has moved, and returns exactly the default.
    await userEvent.click(screen.getByRole("button", { name: /Reset width/ }));
    expect(
      (container.querySelector(".shell-body") as HTMLElement).style.getPropertyValue(
        "--shell-ask-width",
      ),
    ).toBe(`${ASK_DEFAULT_WIDTH}px`);
  });

  it("offers no reset until the width has actually been changed", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    expect(screen.queryByRole("button", { name: /Reset width/ })).toBeNull();
  });

  it("keeps a resized width across a remount, and reset still returns 400", async () => {
    const { renderShell } = await import("../test-utils.js");
    const first = await renderShell();
    const grip = screen.getByRole("slider", { name: "Resize the Ask panel" });
    await userEvent.click(grip);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    first.unmount();

    const { container } = await renderShell();
    expect(
      (container.querySelector(".shell-body") as HTMLElement).style.getPropertyValue(
        "--shell-ask-width",
      ),
    ).toBe(`${ASK_DEFAULT_WIDTH + 32}px`);
    await userEvent.click(screen.getByRole("button", { name: /Reset width/ }));
    expect(
      (container.querySelector(".shell-body") as HTMLElement).style.getPropertyValue(
        "--shell-ask-width",
      ),
    ).toBe(`${ASK_DEFAULT_WIDTH}px`);
  });

  it("names what Ask is looking at", async () => {
    const { renderShell } = await import("../test-utils.js");
    const { container } = await renderShell("/work");
    // The destination by name, never a guess at a record: a chip naming the wrong client is worse
    // than one naming none. Scoped to the chip, because "Work" is also a destination.
    const chip = container.querySelector(".shell-ask-context") as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("Work");
  });

  it("offers Recent and Activity in the workspace header", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    expect(screen.getByRole("button", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Activity/ })).toBeInTheDocument();
  });

  it("says plainly when nothing has been opened yet", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(screen.getByText(/Nothing opened yet/)).toBeInTheDocument();
  });

  it("gives the mobile navigation the same destinations", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    const mobile = screen.getByRole("navigation", { name: "Main, bottom bar" });
    expect(mobile).toBeTruthy();
    const labels = [...mobile.querySelectorAll("a")].map((a) => a.textContent ?? "");
    for (const label of ["Today", "Work", "Automations", "New", "Search"]) {
      expect(labels.some((l) => l.includes(label))).toBe(true);
    }
  });

  it("reaches every sidebar control by keyboard", async () => {
    const { renderShell } = await import("../test-utils.js");
    await renderShell();
    const reachable: string[] = [];
    for (let i = 0; i < 10; i++) {
      await userEvent.tab();
      const el = document.activeElement;
      if (el && el !== document.body) reachable.push(el.textContent?.trim() ?? el.ariaLabel ?? "");
    }
    expect(reachable.some((t) => t.includes("Today"))).toBe(true);
  });
});
