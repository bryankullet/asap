import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportBook } from "./ImportBook.js";
import { renderInRouter } from "../test-utils.js";

/*
 * A signed-in person. `api.ts` refuses to call anything without a token — which is the point of
 * it — so a screen test has to be one, or every request fails before it reaches the stub.
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
 * The import screen (D-070).
 *
 * What these lock is the promise the screen makes: **nothing is written until a person says so**,
 * and what they are shown is what would happen. A screen that quietly dropped the rows it could
 * not read, or that committed before the preview, would be worse than no import at all.
 */

const PREVIEW = {
  batch: {
    id: "b0000000-0000-4000-8000-000000000001",
    filename: "book.csv",
    rowCount: 3,
    premiumBasis: "gross",
    status: "previewed",
    clientsCreated: 0,
    contactsCreated: 0,
    policiesCreated: 0,
    periodsCreated: 0,
    rowsSkipped: 0,
    failureReason: null,
    createdAt: "2026-09-11T09:00:00Z",
    committedAt: null,
  },
  rows: [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      lineNumber: 2,
      outcome: "create",
      problem: null,
      clientName: "Tamarind Exporters Ltd",
      contactName: "Grace Otieno",
      contactEmail: "grace@tamarind.example",
      policyNumber: "MAR-4471",
      insurerName: "Jubilee Allianz",
      classOfBusiness: "Marine cargo",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      premiumAmount: "1250000.00",
      matchedClientId: null,
      candidates: [],
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      lineNumber: 3,
      outcome: "needs_review",
      problem: "More than one client here could be this one. Nothing was written for this row.",
      clientName: "Mara",
      contactName: null,
      contactEmail: null,
      policyNumber: null,
      insurerName: null,
      classOfBusiness: null,
      periodStart: null,
      periodEnd: null,
      premiumAmount: null,
      matchedClientId: null,
      candidates: [
        { id: "c0000000-0000-4000-8000-000000000001", name: "Mara Foods Limited" },
        { id: "c0000000-0000-4000-8000-000000000002", name: "Mara Holdings Ltd" },
      ],
    },
    {
      id: "a1000000-0000-4000-8000-000000000003",
      lineNumber: 4,
      outcome: "invalid",
      problem: "This line has 3 values but the file has 2 columns. It may contain an unquoted comma.",
      clientName: null,
      contactName: null,
      contactEmail: null,
      policyNumber: null,
      insurerName: null,
      classOfBusiness: null,
      periodStart: null,
      periodEnd: null,
      premiumAmount: null,
      matchedClientId: null,
      candidates: [],
    },
  ],
  summary: {
    rows: 3,
    clientsToCreate: 1,
    contactsToCreate: 1,
    policiesToCreate: 1,
    needsReview: 1,
    invalid: 1,
  },
  columns: [
    { header: "Client", meaning: "client_name" },
    { header: "Branch Code", meaning: null },
  ],
  blocking: [],
  source: "spreadsheet",
  mappedByModel: [],
};

const ME = {
  user: { id: "u1", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: "o1", name: "Acme", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

let posted: { url: string; body: unknown }[] = [];

function stubApi(preview: unknown = PREVIEW) {
  posted = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    if (method === "POST") {
      posted.push({ url: u, body: JSON.parse(String((init as RequestInit).body)) });
    }
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/me")) return json(ME);
    if (u.endsWith("/imports") && method === "GET") return json({ batches: [] });
    if (u.endsWith("/imports") && method === "POST") return json(preview);
    if (u.includes("/commit")) return json({ batch: PREVIEW.batch, failures: [] });
    return json({});
  });
}

const renderScreen = () => renderInRouter(<ImportBook />, "/import");

/**
 * A File whose bytes the screen can actually read.
 *
 * jsdom implements neither `.text()` nor `.arrayBuffer()` on File, and the screen now sends the
 * bytes rather than the text — every kind of file takes the same path to the server.
 */
function csvFile(name: string, text: string): File {
  const f = new File([text], name, { type: "text/csv" });
  const bytes = new TextEncoder().encode(text);
  Object.defineProperty(f, "text", { value: async () => text });
  Object.defineProperty(f, "arrayBuffer", { value: async () => bytes.buffer });
  Object.defineProperty(f, "size", { value: bytes.length, configurable: true });
  return f;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("choosing a file", () => {
  it("reads nothing until a person asks it to", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/choose a file/i),
      csvFile("book.csv", "Client\nAcme"),
    );
    await screen.findByText(/is ready to read/i);
    // Choosing a file is not sending it. Nothing has been posted.
    expect(posted).toEqual([]);
  });

  it("asks what the premium column means, and offers no default", async () => {
    stubApi();
    await renderScreen();
    const select = screen.getByLabelText(/what is in it/i) as HTMLSelectElement;
    expect(select.value).toBe("");
  });
});

describe("the preview", () => {
  async function openPreview(preview: unknown = PREVIEW) {
    stubApi(preview);
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/choose a file/i),
      csvFile("book.csv", "Client\nAcme"),
    );
    await user.click(screen.getByRole("button", { name: /read the file/i }));
    await screen.findByText(/what this would do/i);
    return user;
  }

  it("says what would happen without doing it", async () => {
    await openPreview();
    expect(screen.getByText(/nothing below has been written yet/i)).toBeTruthy();
    expect(posted.filter((p) => p.url.includes("/commit"))).toEqual([]);
  });

  it("shows every row, including the ones it could not read", async () => {
    await openPreview();
    // Scoped to the row table: the summary above it uses the same words as headings.
    const table = screen.getByRole("table");
    expect(within(table).getByText("New client")).toBeTruthy();
    expect(within(table).getByText("Needs a decision")).toBeTruthy();
    expect(within(table).getByText("Cannot be read")).toBeTruthy();
    // The reason, in the person's own words, against the line of their own file.
    expect(screen.getByText(/unquoted comma/i)).toBeTruthy();
  });

  it("names the candidates when a client is ambiguous rather than choosing one", async () => {
    await openPreview();
    expect(screen.getByText(/Mara Foods Limited, Mara Holdings Ltd/)).toBeTruthy();
  });

  it("says which columns it did not use, rather than dropping them silently", async () => {
    await openPreview();
    expect(screen.getByText(/does not have a place for this column/i)).toBeTruthy();
  });

  it("offers to write only the rows that can be written", async () => {
    await openPreview();
    // One row of the three is writable; the button counts what it would actually do.
    expect(screen.getByRole("button", { name: /import 1 rows/i })).toBeTruthy();
  });

  it("leaves a row out when a person unticks it, and says so in the count", async () => {
    const user = await openPreview();
    await user.click(screen.getByLabelText(/leave line 2 out/i));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /import 0 rows/i })).toBeTruthy();
    });
  });

  it("sends the lines a person left out when committing", async () => {
    const user = await openPreview();
    await user.click(screen.getByLabelText(/leave line 2 out/i));
    // Nothing is writable now, so re-tick and commit to see what is sent.
    await user.click(screen.getByLabelText(/leave line 2 out/i));
    await user.click(screen.getByRole("button", { name: /import 1 rows/i }));
    await waitFor(() => {
      const commit = posted.find((p) => p.url.includes("/commit"));
      expect(commit).toBeTruthy();
      expect((commit!.body as { skipLineNumbers: number[] }).skipLineNumbers).toEqual([]);
    });
  });

  it("will not let a blocked file be committed", async () => {
    await openPreview({
      ...PREVIEW,
      blocking: ["This file has a premium column. Say whether those figures are gross."],
    });
    expect(screen.getByText(/say whether those figures are gross/i)).toBeTruthy();
    const button = screen.getByRole("button", { name: /import 1 rows/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("any kind of file", () => {
  it("offers spreadsheets and PDFs, not only CSV", async () => {
    stubApi();
    await renderScreen();
    const input = screen.getByLabelText(/choose a file/i) as HTMLInputElement;
    expect(input.accept).toMatch(/\.xlsx/);
    expect(input.accept).toMatch(/\.pdf/);
    expect(input.accept).toMatch(/\.csv/);
  });

  it("says which reader understood the file, rather than implying every file is a CSV", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/choose a file/i), csvFile("book.csv", "Client\nAcme"));
    await user.click(screen.getByRole("button", { name: /read the file/i }));
    await screen.findByText(/what this would do/i);
    expect(screen.getByText(/first sheet of your spreadsheet/i)).toBeTruthy();
  });

  it("flags the headings the model worked out, so a person checks them", async () => {
    stubApi({ ...PREVIEW, mappedByModel: ["U/W", "Sum Ins."] });
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/choose a file/i), csvFile("book.csv", "Client\nAcme"));
    await user.click(screen.getByRole("button", { name: /read the file/i }));
    await screen.findByText(/what this would do/i);
    const note = screen.getByText(/worked out/i);
    expect(note.textContent).toMatch(/U\/W, Sum Ins\./);
    // The boundary, said on the screen: headings, never values.
    expect(note.textContent).toMatch(/read the headings, never the values/i);
  });

  it("refuses a file larger than it can read, before sending anything", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    const huge = csvFile("huge.xlsx", "x");
    Object.defineProperty(huge, "size", { value: 20_000_000 });
    await user.upload(screen.getByLabelText(/choose a file/i), huge);
    expect(await screen.findByText(/20MB/)).toBeTruthy();
    expect(posted).toEqual([]);
  });
});
