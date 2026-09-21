import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { searchResponseSchema, SEARCH_HIT_LABELS } from "@asap/schema";
import { searchSpace } from "../live/search-space.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";
import { renderInRouter } from "../test-utils.js";

/**
 * The Search Space.
 *
 * Two properties matter more than the rest. A result must open the Space the **server** named —
 * a route composed in the browser drifts from the one the API serves, and a result that goes
 * nowhere is what makes search feel like a lie. And the kinds that cannot be searched yet must be
 * on the screen, because silence there is the difference between "there is no such vehicle" and
 * "vehicles are not on file yet", and only one of those is true.
 */

const hit = (over: Record<string, unknown>) => ({
  id: "b0000000-0000-4000-8000-000000000001",
  kind: "client",
  title: "A client",
  subtitle: "Corporate client",
  to: "/clients/b0000000-0000-4000-8000-000000000001",
  clientName: null,
  ...over,
});

const response = (results: Record<string, unknown>[], degraded: unknown[] = []) =>
  searchResponseSchema.parse({ query: "tam", results, degraded });

const READY = { typing: false, loading: false, error: null };

describe("the Search Space", () => {
  it("is a Space with the prototype's head, not a page", () => {
    const space = searchSpace("tam", response([hit({})]), READY);
    expect(space.self.label).toBe("SEARCH");
    expect(space.title).toBe("Results for “tam”");
    expect(space.status.label).toBe("1 result");
  });

  it("groups results by kind, in a fixed order", () => {
    const space = searchSpace(
      "tam",
      response([
        hit({ kind: "run", id: "b0000000-0000-4000-8000-00000000000a", title: "A run", to: "/jobs?filter=all" }),
        hit({ kind: "client" }),
        hit({ kind: "document", id: "b0000000-0000-4000-8000-00000000000b", title: "schedule.pdf", to: "/documents/x" }),
      ]),
      READY,
    );
    expect(space.blocks.map((b) => b.id)).toEqual([
      "hits-client",
      "hits-document",
      "hits-run",
      "not-yet-searchable",
    ]);
  });

  /* The server said where this opens. Nothing here may improve on it. */
  it("opens each result at the route the server named", () => {
    const space = searchSpace(
      "tam",
      response([hit({ kind: "claim", to: "/r/99999999-0000-4000-8000-000000000001" })]),
      READY,
    );
    const block = space.blocks[0];
    if (block?.type !== "rows") throw new Error("expected rows");
    expect(block.rows[0]?.related?.path).toBe("/r/99999999-0000-4000-8000-000000000001");
    expect(block.rows[0]?.actions[0]?.to?.path).toBe("/r/99999999-0000-4000-8000-000000000001");
  });

  /* The kind is part of the identity: a client and a claim about it are two tabs, not one. */
  it("preserves record identity, kind included", () => {
    const space = searchSpace(
      "tam",
      response([
        hit({ kind: "client", id: "c0000000-0000-4000-8000-000000000001" }),
        hit({ kind: "claim", id: "c0000000-0000-4000-8000-000000000001", to: "/r/x" }),
      ]),
      READY,
    );
    const refs = space.blocks
      .filter((b) => b.type === "rows")
      .flatMap((b) => (b.type === "rows" ? b.rows : []))
      .map((r) => r.related)
      .filter((r) => r !== null);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.spaceKind).toBe("client");
    expect(refs[1]!.spaceKind).toBe("claim");
    expect(refs[0]!.recordId).toBe(refs[1]!.recordId);
  });

  it("names the client a result belongs to, and does not repeat a client's own name", () => {
    const space = searchSpace(
      "tam",
      response([
        hit({ kind: "document", title: "schedule.pdf", subtitle: "Policy schedule", clientName: "Tamarind Exporters Ltd", to: "/documents/x" }),
        hit({ kind: "client", title: "Tamarind Exporters Ltd" }),
      ]),
      READY,
    );
    const rows = space.blocks.filter((b) => b.type === "rows").flatMap((b) => (b.type === "rows" ? b.rows : []));
    expect(rows.find((r) => r.title === "schedule.pdf")?.note).toBe("Tamarind Exporters Ltd · Policy schedule");
    expect(rows.find((r) => r.title === "Tamarind Exporters Ltd")?.note).toBe("Corporate client");
  });

  it("says what cannot be searched yet, whether or not anything matched", () => {
    for (const space of [
      searchSpace("tam", response([hit({})]), READY),
      searchSpace("tam", response([]), READY),
      searchSpace("", undefined, READY),
    ]) {
      const block = space.blocks.find((b) => b.id === "not-yet-searchable");
      expect(block?.type).toBe("missing");
      const text = block?.type === "missing" ? block.items.map((i) => i.text).join(" ") : "";
      expect(text).toMatch(/Vehicles/);
      expect(text).toMatch(/Quotes/);
      expect(text).toMatch(/Invoices/);
    }
  });

  it("distinguishes nothing typed from nothing found", () => {
    expect(searchSpace("", undefined, READY).status.label).toBe("Nothing typed");
    expect(searchSpace("tam", response([]), READY).status.label).toBe("0 results");
  });

  it("draws a loading state rather than an empty result while it searches", () => {
    const space = searchSpace("tam", undefined, { typing: false, loading: true, error: null });
    expect(space.blocks[0]?.state).toBe("loading");
    expect(space.status.label).toBe("Searching");
  });

  it("says the search failed, in the API's own words", () => {
    const space = searchSpace("tam", undefined, { typing: false, loading: false, error: "Please sign in again." });
    expect(space.state).toBe("error");
    expect(space.emptyState?.body).toBe("Please sign in again.");
  });

  /* Partial success: the kinds that did answer are shown, and the one that did not is named. */
  it("passes on a kind the server could not read", () => {
    const space = searchSpace(
      "tam",
      response([hit({})], [{ what: "Documents", because: "They could not be read." }]),
      READY,
    );
    expect(space.degraded[0]?.what).toBe("Documents");
    expect(space.blocks.some((b) => b.id === "hits-client")).toBe(true);
  });

  it("labels every kind the contract knows", () => {
    for (const label of Object.values(SEARCH_HIT_LABELS)) expect(label.length).toBeGreaterThan(0);
  });
});

describe("the Search Space on screen", () => {
  it("renders a result as a link to the server's route", async () => {
    const space = searchSpace("tam", response([hit({ title: "Tamarind Exporters Ltd" })]), READY);
    await renderInRouter(<SpaceFrameView space={space} />);
    expect(screen.getByRole("heading", { level: 1, name: "Results for “tam”" })).toBeInTheDocument();
    const row = screen.getByText("Tamarind Exporters Ltd").closest(".sp-row") as HTMLElement;
    expect(within(row).getByRole("link", { name: "Open →" })).toHaveAttribute(
      "href",
      "/clients/b0000000-0000-4000-8000-000000000001",
    );
  });

  it("shows what cannot be searched yet on screen", async () => {
    await renderInRouter(<SpaceFrameView space={searchSpace("tam", response([]), READY)} />);
    expect(screen.getByText(/Vehicles and other insured items/)).toBeInTheDocument();
  });
});
