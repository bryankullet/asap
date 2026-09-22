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
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: {
    id: "10000000-0000-4000-8000-00000000000a",
    name: "Acme",
    country: "KE",
    currency: "KES",
    timezone: "UTC",
  },
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
    await waitFor(() => expect(screen.getAllByText("Uploaded").length).toBeGreaterThan(0));
    expect(screen.queryByText("Ready for review")).toBeNull();
    // Said plainly, not implied by the absence of anything else.
    expect(screen.getByText("On file. Nothing has read it yet")).toBeInTheDocument();
    // And nothing offers to re-read something that has not been read once.
    expect(screen.queryByRole("button", { name: /Read it again/ })).toBeNull();
  });

  it("says Queued and Reading while the machine has it", async () => {
    stubApi(detail({ document: { extractionState: "queued" }, fields: [] }));
    await open();
    await waitFor(() => expect(screen.getAllByText("Queued").length).toBeGreaterThan(0));
    expect(screen.getByText(/Nothing has been read from it yet/)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("Conflict found").length).toBeGreaterThan(0));
    expect(screen.queryByText("Missing information")).toBeNull();
    // Both readings are kept: neither is chosen for the person.
    expect(screen.getByText(/two readings disagree/i)).toBeInTheDocument();
  });

  it("counts what is waiting for a person", async () => {
    stubApi(detail({ fields: [field(), field({ id: "91000000-0000-4000-8000-00000000000b" })] }));
    await open();
    await waitFor(() => expect(screen.getAllByText("Ready for review").length).toBeGreaterThan(0));
    // The count is on the facts and in the sentence, both from the same derived number.
    expect(screen.getByText("AWAITING A DECISION")).toBeInTheDocument();
    expect(screen.getByText(/2 values were read/)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    expect(screen.getByText(/The extractor could not be reached/)).toBeInTheDocument();
    // The file is not sent again: the same stored object is read a second time.
    expect(screen.getByText(/re-reads the same file/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Read it again/ }));
    await waitFor(() =>
      expect(posted.some((u) => u.includes(`/documents/${DOC}/extraction/retry`))).toBe(true),
    );
  });

  it("offers no retry once it has been read", async () => {
    stubApi(detail());
    await open();
    await waitFor(() => expect(screen.getAllByText("Ready for review").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Read it again/ })).toBeNull();
  });
});

describe("a citation you cannot open is not a citation", () => {
  it("draws the region a value was read from, at that page's own scale", async () => {
    stubApi(detail());
    await open();
    const show = await screen.findByRole("button", { name: "Show where" });
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
      expect(screen.getByText(/ASAP could not place this on a page/)).toBeInTheDocument(),
    );
    // No reveal at all, rather than one that opens an invented page.
    expect(screen.queryByRole("button", { name: "Show where" })).toBeNull();
  });
});

/**
 * Applying to a record, and uploading honestly (D-077).
 *
 * The rules these hold: ASAP suggests and says why, a person chooses and confirms, nothing is
 * applied that a person has not ticked, and a premium is never written without saying what the
 * figure is. On upload: bytes moving is visible, cancelling is not a success, and a retry cannot
 * make a second document.
 */

const PERIOD = "91000000-0000-4000-8000-0000000000c1";

const TARGETS = {
  suggestions: [
    {
      targetType: "policy_period",
      targetId: PERIOD,
      label: "Acme Manufacturing Ltd · Commercial Motor · 2026",
      reason: 'This document is filed against the work "Acme — 2026 renewal", which is about this period of cover.',
      condition: "known",
    },
  ],
  whyNoTarget: null,
  applicableFields: {
    policy_period: ["period_start", "period_end", "premium"],
    policy: ["policy_number"],
    client: ["insured_name"],
  },
};

const PREVIEW = {
  target: {
    targetType: "policy_period",
    targetId: PERIOD,
    label: "Acme Manufacturing Ltd · Commercial Motor · 2026",
    reason: "Chosen by you.",
    condition: "known",
  },
  fields: [
    {
      documentFieldId: "91000000-0000-4000-8000-00000000000a",
      fieldKey: "premium",
      currentValue: null,
      proposedValue: "214500.00",
      page: 1,
      region: { x: 240, y: 292, width: 55, height: 15 },
      condition: "known",
      state: "accepted",
      unchanged: false,
      blockedBecause: null,
    },
    {
      documentFieldId: "91000000-0000-4000-8000-00000000000b",
      fieldKey: "period_end",
      currentValue: "2026-12-31",
      proposedValue: "2026-12-31",
      page: 1,
      region: null,
      condition: "known",
      state: "accepted",
      unchanged: true,
      blockedBecause: null,
    },
    {
      documentFieldId: "91000000-0000-4000-8000-00000000000c",
      fieldKey: "insured_name",
      currentValue: null,
      proposedValue: "Acme Manufacturing Ltd",
      page: 1,
      region: null,
      condition: "known",
      state: "accepted",
      unchanged: false,
      blockedBecause: "A policy period does not hold this.",
    },
  ],
  missing: ["period_start"],
};

let applied: unknown[] = [];

function stubApplyApi(reviewedDetail: unknown) {
  applied = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/me")) return json(ME);
    if (u.includes("/apply-targets")) return json(TARGETS);
    if (u.includes("/apply-preview")) return json(PREVIEW);
    if (u.includes("/apply") && method === "POST") {
      const body = JSON.parse(String((init as RequestInit).body));
      applied.push(body);
      return json({
        applicationId: "a9000000-0000-4000-8000-00000000000a",
        targetType: body.targetType,
        targetId: body.targetId,
        appliedAt: "2026-09-16T12:00:00Z",
        changes: body.fields.map((f: { fieldKey: string; from: string | null; to: string }) => ({
          fieldKey: f.fieldKey,
          documentFieldId: null,
          from: f.from,
          to: f.to,
          page: 1,
        })),
        repeat: false,
      });
    }
    if (u.includes(`/documents/${DOC}`)) return json(reviewedDetail);
    return json({});
  });
}

const reviewed = detail({
  fields: [
    field({ state: "accepted", condition: "known", reviewedAt: "2026-09-16T11:00:00Z" }),
  ],
});

describe("applying a document to a record", () => {
  it("names the suggested record and why, and applies to nothing until a person chooses", async () => {
    stubApplyApi(reviewed);
    await open();
    const suggestion = await screen.findByText("Acme Manufacturing Ltd · Commercial Motor · 2026");
    expect(suggestion).toBeInTheDocument();
    expect(screen.getByText(/filed against the work/)).toBeInTheDocument();
    // Nothing is applied by showing a suggestion.
    expect(applied).toHaveLength(0);
  });

  it("shows the record's value, the proposed one, what would not change and what it cannot hold", async () => {
    stubApplyApi(reviewed);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to this" }));

    // Two fields hold nothing on the record; both say so rather than showing a confident blank.
    expect((await screen.findAllByText(/now: nothing/)).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("The record already holds this. Applying it would change nothing."),
    ).toBeInTheDocument();
    expect(screen.getByText("A policy period does not hold this.")).toBeInTheDocument();
    // A field the record holds that the document never gave is stated, not omitted.
    expect(screen.getByText(/which the document did not give/)).toBeInTheDocument();
  });

  it("will not write a premium until the person says what the figure is", async () => {
    stubApplyApi(reviewed);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to this" }));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(
      screen.getByText(/Is this figure the gross premium, or everything payable\?/),
    ).toBeInTheDocument();
    const applyButton = screen.getByRole("button", { name: /Apply 1 value/ });
    expect(applyButton).toBeDisabled();

    await userEvent.selectOptions(screen.getByRole("combobox"), "gross");
    expect(applyButton).toBeEnabled();
    await userEvent.click(applyButton);

    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({
      targetType: "policy_period",
      targetId: PERIOD,
      fields: [{ fieldKey: "premium", from: null, to: "214500.00", premiumBasis: "gross" }],
    });
  });

  it("sends only the ticked field, and sends what the record held so the server can refuse a stale write", async () => {
    stubApplyApi(reviewed);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to this" }));
    // Only the premium is tickable: one is unchanged and one the record cannot hold.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByRole("combobox"), "total_payable");
    await userEvent.click(screen.getByRole("button", { name: /Apply 1 value/ }));

    await waitFor(() => expect(applied).toHaveLength(1));
    const body = applied[0] as { fields: { fieldKey: string }[]; idempotencyKey: string };
    expect(body.fields.map((f) => f.fieldKey)).toEqual(["premium"]);
    // One key for one press, so the server can write once however many times it arrives.
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it("lets a person correct a value before applying it", async () => {
    stubApplyApi(reviewed);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to this" }));
    const input = screen.getByLabelText("Value to apply for premium");
    await userEvent.clear(input);
    await userEvent.type(input, "214000.00");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByRole("combobox"), "gross");
    await userEvent.click(screen.getByRole("button", { name: /Apply 1 value/ }));

    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]).toMatchObject({ fields: [{ to: "214000.00" }] });
  });

  it("cancels without writing anything", async () => {
    stubApplyApi(reviewed);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to this" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(applied).toHaveLength(0);
    // Back to choosing, with the suggestion offered again.
    expect(await screen.findByRole("button", { name: "Apply to this" })).toBeInTheDocument();
  });

  it("shows a receipt naming both sides of every change, and the evidence link", async () => {
    stubApplyApi(reviewed);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Apply to this" }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByRole("combobox"), "gross");
    await userEvent.click(screen.getByRole("button", { name: /Apply 1 value/ }));

    expect(await screen.findByText("Applied to the record.")).toBeInTheDocument();
    expect(screen.getByText(/nothing → 214500.00/)).toBeInTheDocument();
    expect(screen.getByText(/read from page 1/)).toBeInTheDocument();
    expect(screen.getByText(/linked to the record as the evidence/)).toBeInTheDocument();
  });

  it("offers nothing to apply while every value is still only proposed", async () => {
    stubApplyApi(detail());
    await open();
    await waitFor(() => expect(screen.getAllByText("Ready for review").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Apply to this" })).toBeNull();
  });
});
