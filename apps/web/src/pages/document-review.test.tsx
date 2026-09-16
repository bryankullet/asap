import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentViewer } from "./Documents.js";
import { renderInRouter } from "../test-utils.js";

/*
 * A signed-in person: `api.ts` refuses to call anything without a token, so a screen test has to
 * be one or every request fails before it reaches the stub.
 */
vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * Extraction review — the Phase 3 gate (D-076).
 *
 * What these lock is the honesty of the screen:
 *
 *  - **an upload is never described as a read.** A file in the bucket that nothing has looked at
 *    says Uploaded;
 *  - a document that could not be read says so, offers a retry, and offers it from nowhere else;
 *  - a value's page reference can be opened — the region is drawn — and a value with no position
 *    says that instead of offering a citation that opens nothing;
 *  - a conflict outranks a gap in what the person is told, because "ready for review" over two
 *    contradictory policy numbers is a label that misleads.
 */

const DOC = "90000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "u1", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: "o1", name: "Acme", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

const field = (over: Record<string, unknown> = {}) => ({
  id: "91000000-0000-4000-8000-00000000000a",
  fieldKey: "policy_number",
  proposedValue: "MC-4471",
  correctedValue: null,
  state: "proposed",
  condition: "inferred",
  page: 1,
  region: { x: 100, y: 220, width: 160, height: 18 },
  reviewedBy: null,
  reviewedAt: null,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  document: {
    id: DOC,
    kind: "policy_schedule",
    filename: "acme-schedule.pdf",
    mimeType: "application/pdf",
    byteSize: 12345,
    pageCount: 2,
    extractionState: "extracted",
    extractionError: null,
    clientId: null,
    workItemId: null,
    createdAt: "2026-09-10T09:00:00Z",
    ...((over["document"] as Record<string, unknown>) ?? {}),
  },
  pages: [{ pageNumber: 1, width: 595, height: 842, text: "Policy MC-4471" }],
  fields: [field()],
  fileUrl: "https://example.test/signed",
  fileUrlExpiresAt: "2026-09-10T09:10:00Z",
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "document")),
});

let posted: string[] = [];

function stubApi(body: unknown) {
  posted = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    if (method === "POST") posted.push(u);
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/me")) return json(ME);
    if (u.includes("/extraction/retry")) {
      return json({
        document: { ...(body as { document: object }).document, extractionState: "queued" },
        retried: true,
      });
    }
    if (u.includes(`/documents/${DOC}`)) return json(body);
    return json({});
  });
}

afterEach(() => vi.restoreAllMocks());

const open = () => renderInRouter(<DocumentViewer />, `/documents/${DOC}`);

describe("what a person is told about a document", () => {
  it("never calls an unread upload read", async () => {
    stubApi(detail({ document: { extractionState: "not_started" }, fields: [] }));
    await open();
    await waitFor(() => expect(screen.getByText("Uploaded")).toBeInTheDocument());
    expect(screen.queryByText("Ready for review")).toBeNull();
    // And nothing offers to re-read something that has not been read once.
    expect(screen.queryByRole("button", { name: /Try reading it again/ })).toBeNull();
  });

  it("says Queued and Reading while the machine has it", async () => {
    stubApi(detail({ document: { extractionState: "queued" }, fields: [] }));
    await open();
    await waitFor(() => expect(screen.getByText("Queued")).toBeInTheDocument());
  });

  it("says Conflict found ahead of anything else, and keeps both readings", async () => {
    stubApi(
      detail({
        fields: [
          field({ condition: "conflicting", proposedValue: "MC-4471" }),
          field({ id: "91000000-0000-4000-8000-00000000000b", condition: "missing", proposedValue: null }),
        ],
      }),
    );
    await open();
    await waitFor(() => expect(screen.getByText("Conflict found")).toBeInTheDocument());
    expect(screen.queryByText("Missing information")).toBeNull();
  });

  it("counts what is waiting for a person", async () => {
    stubApi(detail({ fields: [field(), field({ id: "91000000-0000-4000-8000-00000000000b" })] }));
    await open();
    await waitFor(() => expect(screen.getByText("Ready for review")).toBeInTheDocument());
    expect(screen.getByText("2 values waiting for you")).toBeInTheDocument();
  });
});

describe("a failed read can be tried again", () => {
  it("offers a retry, says the file is not re-uploaded, and asks the API", async () => {
    const body = detail({
      document: { extractionState: "failed", extractionError: "The extractor could not be reached." },
      fields: [],
    });
    stubApi(body);
    await open();
    await waitFor(() => expect(screen.getByText("Failed")).toBeInTheDocument());
    expect(screen.getByText(/The extractor could not be reached/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is uploaded again/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Try reading it again/ }));
    await waitFor(() =>
      expect(posted.some((u) => u.includes(`/documents/${DOC}/extraction/retry`))).toBe(true),
    );
  });

  it("offers no retry once it has been read", async () => {
    stubApi(detail());
    await open();
    await waitFor(() => expect(screen.getByText("Ready for review")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Try reading it again/ })).toBeNull();
  });
});

describe("a citation you cannot open is not a citation", () => {
  it("draws the region a value was read from, at that page's own scale", async () => {
    stubApi(detail());
    await open();
    const show = await screen.findByRole("button", { name: /Show where it was read · page 1/ });
    await userEvent.click(show);

    const drawing = await screen.findByRole("img", {
      name: /Page 1, with the region policy number was read from marked/,
    });
    // The page's own coordinates, so the box places on any rendering of it.
    expect(drawing).toHaveAttribute("viewBox", "0 0 595 842");
    const rect = drawing.querySelector('rect[stroke-width="2"]');
    expect(rect).toHaveAttribute("x", "100");
    expect(rect).toHaveAttribute("y", "220");
    expect(rect).toHaveAttribute("width", "160");
    expect(rect).toHaveAttribute("height", "18");
    // And a way through to the file itself at that page.
    expect(screen.getByRole("link", { name: /Open the file at this page/ })).toHaveAttribute(
      "href",
      "https://example.test/signed#page=1",
    );
  });

  it("says a value could not be placed rather than offering a link that opens nothing", async () => {
    stubApi(detail({ fields: [field({ page: null, region: null, fieldKey: "sum_insured" })] }));
    await open();
    await waitFor(() =>
      expect(screen.getByText("ASAP could not place this on a page.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /Show where it was read/ })).toBeNull();
  });
});
