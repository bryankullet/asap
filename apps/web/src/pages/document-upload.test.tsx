import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Documents } from "./Documents.js";
import { renderInRouter } from "../test-utils.js";

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * Uploading, honestly (D-077).
 *
 * The failure this locks out: a screen that says a file is on file when the bytes never arrived.
 * The upload goes straight to storage, so the browser is the only thing that knows how it went,
 * and every one of these outcomes has to be visible:
 *
 *  - bytes moving, with a percentage only where the transport measured one;
 *  - cancelled, which is not a success and not an error;
 *  - failed, with a retry that cannot make a second document;
 *  - the same bytes twice recognised as the same document.
 */

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

const DOC = {
  id: "90000000-0000-4000-8000-00000000000a",
  kind: "policy_schedule",
  filename: "schedule.pdf",
  mimeType: "application/pdf",
  byteSize: 8,
  pageCount: null,
  extractionState: "not_started",
  extractionError: null,
  clientId: null,
  workItemId: null,
  createdAt: "2026-09-16T09:00:00Z",
};

/** Every PUT the page made, and how each was resolved. */
type Sent = { aborted: boolean };
let puts: Sent[] = [];
let posted: { url: string; body: unknown }[] = [];
/** Held so a test can finish or fail a transfer at the moment it chooses. */
let settle: ((outcome: "load" | "error") => void) | null = null;

class StubXhr {
  status = 200;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private record: Sent = { aborted: false };
  open() {}
  setRequestHeader() {}
  abort() {
    this.record.aborted = true;
    this.onabort?.();
  }
  send() {
    puts.push(this.record);
    // A progress event the transport could measure.
    this.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 8 } as ProgressEvent);
    settle = (outcome) => {
      if (outcome === "load") {
        this.status = 200;
        this.onload?.();
      } else {
        this.onerror?.();
      }
    };
  }
}

function stubApi(uploadOutcome: "ready" | "already_on_file" = "ready") {
  puts = [];
  posted = [];
  settle = null;
  vi.stubGlobal("XMLHttpRequest", StubXhr);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method === "POST") posted.push({ url: u, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    if (u.endsWith("/me")) return json(ME);
    if (u.endsWith("/documents") && method === "GET") return json({ documents: [], limits: { maxBytes: 26214400, readableMimeTypes: ["application/pdf"] } });
    if (u.endsWith("/documents") && method === "POST") {
      return json(
        uploadOutcome === "already_on_file"
          ? { outcome: "already_on_file", document: DOC }
          : {
              outcome: "ready",
              document: DOC,
              uploadUrl: "https://storage.test/put/one",
              uploadToken: "tok",
              storagePath: "o1/unfiled/d1/schedule.pdf",
            },
      );
    }
    if (u.includes("/filed")) return json({ document: { ...DOC, extractionState: "queued" }, filed: true });
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const choose = async () => {
  const input = screen.getByLabelText("Choose a file", { selector: "input" });
  await userEvent.upload(input, new File(["abcdefgh"], "schedule.pdf", { type: "application/pdf" }));
};

describe("uploading a document", () => {
  it("says bytes are moving, with the percentage the transport actually reported", async () => {
    stubApi();
    await renderInRouter(<Documents />, "/documents");
    await choose();
    await waitFor(() => expect(screen.getByText(/Uploading — 50% of 1KB sent/)).toBeInTheDocument());
    // And while it is in flight it does not claim the file is on file.
    expect(screen.queryByText(/ASAP reads it next/)).toBeNull();
  });

  it("cancels the transfer itself, and calls that neither a success nor an error", async () => {
    stubApi();
    await renderInRouter(<Documents />, "/documents");
    await choose();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByText("Upload cancelled. Nothing was filed.")).toBeInTheDocument(),
    );
    // The request was aborted, not merely abandoned.
    expect(puts[0]?.aborted).toBe(true);
    // And nothing told the API the bytes arrived.
    expect(posted.some((p) => p.url.includes("/filed"))).toBe(false);
  });

  it("offers a retry after a failure, and the retry cannot make a second document", async () => {
    stubApi();
    await renderInRouter(<Documents />, "/documents");
    await choose();
    await waitFor(() => expect(settle).not.toBeNull());
    settle?.("error");

    await waitFor(() =>
      expect(screen.getByText(/The file store could not be reached/)).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/Nothing was filed/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    /*
     * The retry asks the API for a home again with the same hash, and the API answers with the
     * document already on file rather than a second one — which is what stops a flaky connection
     * turning one schedule into three.
     */
    const asks = posted.filter((p) => p.url.endsWith("/documents"));
    expect(asks).toHaveLength(2);
    expect(asks[0]?.body).toMatchObject({ contentSha256: expect.any(String) });
    expect((asks[1]?.body as { contentSha256: string }).contentSha256).toBe(
      (asks[0]?.body as { contentSha256: string }).contentSha256,
    );
  });

  it("recognises the same bytes as the document already on file", async () => {
    stubApi("already_on_file");
    await renderInRouter(<Documents />, "/documents");
    await choose();
    await waitFor(() =>
      expect(screen.getByText(/was already on file — nothing was filed twice/)).toBeInTheDocument(),
    );
    // No transfer at all: there is nothing to send.
    expect(puts).toHaveLength(0);
  });

  it("only says the file is on file once the bytes have actually arrived", async () => {
    stubApi();
    await renderInRouter(<Documents />, "/documents");
    await choose();
    await waitFor(() => expect(settle).not.toBeNull());
    expect(screen.queryByText(/ASAP reads it next/)).toBeNull();

    settle?.("load");
    await waitFor(() => expect(screen.getByText(/ASAP reads it next/)).toBeInTheDocument());
    // And only then is the API told, which is what puts it in the queue to be read.
    expect(posted.some((p) => p.url.includes("/filed"))).toBe(true);
  });
});
