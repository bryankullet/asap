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

/*
 * A valid `/me`. `api.ts` validates every response, so an organization id that is not a uuid
 * fails the schema, `me.data` stays undefined and every query keyed on the organization is
 * silently disabled — a screen that renders its loading state for ever and a test that proves
 * nothing.
 */
const ORG = "10000000-0000-4000-8000-00000000000a";
const ME = {
  user: {
    id: "90000000-0000-4000-8000-000000000001",
    email: "a@b.test",
    display_name: "Amina",
    full_name: null,
  },
  memberships: [],
  active_organization: { id: ORG, name: "Acme", country: "KE", currency: "KES", timezone: "UTC" },
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
    if (u.endsWith("/documents")) {
      return json({ documents: [], limits: { maxBytes: 52_428_800, readableMimeTypes: [] } });
    }
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
    // Arriving sends nothing. The only POST that exists is the one a chosen file causes.
    expect(posted.filter((p) => p.url.endsWith("/imports"))).toEqual([]);
    // The promise is on the screen twice — as the block's heading and on the picker itself.
    expect(screen.getAllByText(/Nothing is saved until you confirm/).length).toBeGreaterThan(0);
  });

  it("asks what the premium column means, and offers no default", async () => {
    stubApi();
    await renderScreen();
    const select = (await screen.findByLabelText(/WHAT IS IN IT/i)) as HTMLSelectElement;
    // No default: guessing between gross and total payable misstates every premium in the book.
    expect(select.value).toBe("");
    expect(within(select).getByRole("option", { name: /Gross premium/ })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: /total payable/ })).toBeInTheDocument();
  });

  it("refuses a file larger than the server accepts, before sending anything", async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    // The limit comes from the server, so wait until the screen has it before testing against it.
    await screen.findByText(/Up to 50 MB/);
    const huge = csvFile("huge.xlsx", "x");
    Object.defineProperty(huge, "size", { value: 90_000_000 });
    await user.upload(screen.getByLabelText(/Choose a file/i), huge);
    expect(await screen.findByRole("alert")).toHaveTextContent(/larger than this deployment accepts/);
    expect(posted.filter((p) => p.url.endsWith("/imports"))).toEqual([]);
  });

  it("offers spreadsheets and CSV, not only CSV", async () => {
    stubApi();
    await renderScreen();
    const picker = screen.getByLabelText(/Choose a file/i) as HTMLInputElement;
    expect(picker.accept).toMatch(/csv/);
    expect(picker.accept).toMatch(/spreadsheetml/);
  });
});

describe("what the preview says", () => {
  const preview = async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/Choose a file/i),
      csvFile("book.csv", "Client,Branch Code\nTamarind,1"),
    );
    await screen.findByText(/3 rows staged/);
  };

  it("says what would happen without doing it", async () => {
    await preview();
    // Read, and nothing else: the only POST so far is the preview.
    expect(posted.filter((p) => p.url.includes("/commit"))).toEqual([]);
    expect(screen.getByText("CLIENTS TO CREATE")).toBeInTheDocument();
  });

  it("shows every row, including the ones it could not read", async () => {
    await preview();
    expect(screen.getByText("Tamarind Exporters Ltd")).toBeInTheDocument();
    expect(screen.getByText("Mara")).toBeInTheDocument();
    // The unreadable row is on the screen with its reason, not dropped — in the row list and
    // again in the list of what cannot be written.
    expect(screen.getAllByText(/Line 4/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/unquoted comma/).length).toBeGreaterThan(0);
  });

  it("names the candidates when a client is ambiguous rather than choosing one", async () => {
    await preview();
    expect(screen.getByText(/Could be: Mara Foods Limited, Mara Holdings Ltd/)).toBeInTheDocument();
    // And offers no way to pick one here: the preview is the server's reading of the file.
    expect(screen.queryByRole("button", { name: /It is Mara/ })).toBeNull();
  });

  it("says which columns it did not use, rather than dropping them silently", async () => {
    await preview();
    expect(screen.getByText("Branch Code")).toBeInTheDocument();
    expect(screen.getByText("Not used")).toBeInTheDocument();
  });

  it("says which reader understood the file, rather than implying every file is a CSV", async () => {
    await preview();
    expect(screen.getByText("Spreadsheet")).toBeInTheDocument();
  });

  it("offers to write only the rows that can be written", async () => {
    await preview();
    // One row of three: the ambiguous and the unreadable are not offered.
    expect(screen.getByRole("button", { name: /Confirm the import of 1 row/ })).toBeEnabled();
  });

  it("says why each blocked row cannot continue", async () => {
    await preview();
    const blocked = screen.getByText(/WHAT CANNOT BE WRITTEN, AND WHY/).parentElement!;
    expect(within(blocked).getByText(/Line 3.*Mara/)).toBeInTheDocument();
    expect(within(blocked).getByText(/Line 4.*unquoted comma/)).toBeInTheDocument();
  });
});

describe("leaving rows out, and committing", () => {
  const preview = async () => {
    stubApi();
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/Choose a file/i),
      csvFile("book.csv", "Client,Branch Code\nTamarind,1"),
    );
    await screen.findByText(/3 rows staged/);
    return user;
  };

  it("leaves a row out when a person says so, and says so in the count", async () => {
    const user = await preview();
    const row = screen.getByText("Tamarind Exporters Ltd").closest(".sp-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Leave it out" }));
    expect(await screen.findByRole("button", { name: /Confirm the import of 0 rows/ })).toBeDisabled();
    expect(screen.getByText("Left out")).toBeInTheDocument();
  });

  it("puts a row back when a person changes their mind", async () => {
    const user = await preview();
    const row = () => screen.getByText("Tamarind Exporters Ltd").closest(".sp-row") as HTMLElement;
    await user.click(within(row()).getByRole("button", { name: "Leave it out" }));
    await user.click(within(row()).getByRole("button", { name: "Put it back" }));
    expect(await screen.findByRole("button", { name: /Confirm the import of 1 row/ })).toBeEnabled();
  });

  it("sends the lines a person left out when committing", async () => {
    const user = await preview();
    const row = screen.getByText("Tamarind Exporters Ltd").closest(".sp-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Leave it out" }));
    // Nothing is writable now, so put it back and commit with the ambiguous line left out.
    await user.click(within(row).getByRole("button", { name: "Put it back" }));
    const ambiguous = screen.getByText("Mara").closest(".sp-row") as HTMLElement;
    await user.click(within(ambiguous).getByRole("button", { name: "Leave it out" }));
    await user.click(screen.getByRole("button", { name: /Confirm the import of 1 row/ }));
    await waitFor(() => expect(posted.some((p) => p.url.includes("/commit"))).toBe(true));
    const commit = posted.find((p) => p.url.includes("/commit"))!;
    expect((commit.body as { skipLineNumbers: number[] }).skipLineNumbers).toEqual([3]);
  });

  /* The write happens once however many times the button is pressed. */
  it("writes once when Confirm is pressed twice", async () => {
    const user = await preview();
    const button = screen.getByRole("button", { name: /Confirm the import of 1 row/ });
    await user.click(button);
    await user.click(button);
    await waitFor(() => expect(posted.some((p) => p.url.includes("/commit"))).toBe(true));
    expect(posted.filter((p) => p.url.includes("/commit"))).toHaveLength(1);
  });

  it("will not let a blocked file be committed", async () => {
    stubApi({ ...PREVIEW, blocking: ["No column in this file says who the client is."] });
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/Choose a file/i),
      csvFile("book.csv", "Branch Code\n1"),
    );
    const confirm = await screen.findByRole("button", { name: /Confirm the import/ });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/No column in this file says who the client is/)).toBeInTheDocument();
  });

  it("flags the headings the model worked out, so a person checks them", async () => {
    stubApi({
      ...PREVIEW,
      columns: [
        { header: "Client", meaning: "client_name" },
        { header: "Cover From", meaning: "period_start" },
      ],
      mappedByModel: ["Cover From"],
    });
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/Choose a file/i),
      csvFile("book.csv", "Client,Branch Code\nTamarind,1"),
    );
    expect(await screen.findByText(/matched by ASAP/)).toBeInTheDocument();
  });
});

describe("the receipt", () => {
  it("keeps a partial import partial, and names the rows that failed", async () => {
    stubApi();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "POST") posted.push({ url: u, body: JSON.parse(String((init as RequestInit).body)) });
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
      if (u.endsWith("/me")) return json(ME);
      if (u.endsWith("/documents")) return json({ documents: [], limits: { maxBytes: 52428800, readableMimeTypes: [] } });
      if (u.endsWith("/imports") && method === "POST") return json(PREVIEW);
      if (u.includes("/commit")) {
        return json({
          batch: { ...PREVIEW.batch, status: "committed", clientsCreated: 1, rowsSkipped: 1 },
          failures: [{ lineNumber: 4, problem: "The insurer named on this line is not on file." }],
        });
      }
      return json({});
    });
    await renderScreen();
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText(/Choose a file/i),
      csvFile("book.csv", "Client\nTamarind"),
    );
    await user.click(await screen.findByRole("button", { name: /Confirm the import/ }));

    expect(await screen.findByText("Partly written")).toBeInTheDocument();
    expect(screen.getByText(/Line 4 — The insurer named on this line is not on file/)).toBeInTheDocument();
    expect(screen.getByText(/This import is partly written/)).toBeInTheDocument();
    // And where the records now are.
    expect(screen.getByRole("link", { name: "Open client files" })).toHaveAttribute("href", "/files");
  });
});
