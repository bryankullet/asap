import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding.js";
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
 * First-use onboarding (D-082).
 *
 * What these lock is that the four steps do real things and claim nothing else:
 *
 *  - a brand-new person creates a brokerage through the real, idempotent creation call;
 *  - somebody joining one is shown its details and given no control that could overwrite them;
 *  - upload and import go to the real pipelines, not to an onboarding-shaped copy;
 *  - a skip is sent to the server as a decision, not used as a way of navigating;
 *  - a deployment with no Google credentials says so and never shows a connection that worked;
 *  - a finished setup is a summary, and Finish pressed twice finishes once.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

const COMPANY = {
  id: ORG,
  name: "Acme Brokers",
  country: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
  canEdit: true,
  createdByYou: true,
};

function onboarding(over: Record<string, unknown> = {}) {
  return {
    onboarding: {
      step: 1,
      recordsChoice: null,
      mailboxChoice: null,
      completedAt: null,
      company: COMPANY,
      progress: { documents: 0, imports: 0, clients: 0, mailboxConnected: false },
      gmailConfigured: true,
      gmailUnavailableReason: null,
      ...over,
    },
  };
}

let sent: { url: string; method: string; body: unknown }[] = [];
let state: Record<string, unknown>;

function stubApi(initial = onboarding()) {
  sent = [];
  state = initial;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method !== "GET") {
      sent.push({ url: u, method, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    }
    if (u.endsWith("/me")) return json(ME);
    if (u.endsWith("/onboarding/complete")) {
      const o = state["onboarding"] as Record<string, unknown>;
      // The server's own answer: a second press returns the first completion.
      o["completedAt"] = o["completedAt"] ?? "2026-09-22T10:00:00.000Z";
      return json(state);
    }
    if (u.endsWith("/onboarding") && method === "PUT") {
      const patch = JSON.parse(String((init as RequestInit).body ?? "{}")) as Record<string, unknown>;
      const o = state["onboarding"] as Record<string, unknown>;
      if (patch["step"] !== undefined) o["step"] = patch["step"];
      if (patch["recordsChoice"] !== undefined) o["recordsChoice"] = patch["recordsChoice"];
      if (patch["mailboxChoice"] !== undefined) o["mailboxChoice"] = patch["mailboxChoice"];
      return json(state);
    }
    if (u.endsWith("/onboarding")) return json(state);
    if (u.endsWith("/organizations")) return json({ organization_id: ORG });
    if (u.endsWith("/mailboxes/connect")) {
      return json({ outcome: "authorise", url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
    }
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

const put = () => sent.filter((s) => s.url.endsWith("/onboarding") && s.method === "PUT");

describe("step one — the brokerage", () => {
  it("asks a brand-new person for their brokerage, and creates it through the real call", async () => {
    stubApi(onboarding({ company: null }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getByText("Welcome to ASAP")).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/What is the brokerage called/), "Acme Brokers");
    await userEvent.click(screen.getByRole("button", { name: "Create the workspace" }));

    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/organizations"))).toBe(true));
    const created = sent.find((s) => s.url.endsWith("/organizations"))!;
    expect(created.body).toMatchObject({ name: "Acme Brokers", accepted_terms: true });
    // Idempotent by construction: the request key is what makes a double submit one brokerage.
    expect((created.body as { request_key: string }).request_key).toBeTruthy();
  });

  it("carries one request key across two submits, so two clicks are one brokerage", async () => {
    stubApi(onboarding({ company: null }));
    await renderInRouter(<Onboarding />, "/onboarding");
    await waitFor(() => expect(screen.getByLabelText(/What is the brokerage called/)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/What is the brokerage called/), "Acme Brokers");

    const button = screen.getByRole("button", { name: "Create the workspace" });
    await userEvent.click(button);
    await userEvent.click(button);

    const creates = sent.filter((s) => s.url.endsWith("/organizations"));
    const keys = new Set(creates.map((c) => (c.body as { request_key: string }).request_key));
    expect(keys.size).toBe(1);
  });

  it("shows a joiner the brokerage, with nothing that could overwrite it", async () => {
    stubApi(onboarding({ company: { ...COMPANY, canEdit: false, createdByYou: false } }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getByText("Welcome to Acme Brokers")).toBeInTheDocument());
    expect(screen.getByText(/Only an administrator can change them/)).toBeInTheDocument();
    // No form, so nothing to submit over the top of it.
    expect(screen.queryByLabelText(/What is the brokerage called/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Create the workspace|Save and continue/ })).toBeNull();
  });
});

describe("step two — records", () => {
  it("sends a skip to the server as a decision", async () => {
    stubApi(onboarding({ step: 2 }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getAllByText("Put some records in").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(put()).toHaveLength(1));
    expect(put()[0]!.body).toMatchObject({ recordsChoice: "skip", step: 3 });
  });

  it("records the choice before leaving for the real import screen", async () => {
    stubApi(onboarding({ step: 2 }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getAllByText("Put some records in").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Import a spreadsheet" }));

    await waitFor(() => expect(put()).toHaveLength(1));
    expect(put()[0]!.body).toMatchObject({ recordsChoice: "import" });
  });

  it("offers a real file picker, not a description of one", async () => {
    stubApi(onboarding({ step: 2 }));
    await renderInRouter(<Onboarding />, "/onboarding");
    await waitFor(() =>
      expect(screen.getByLabelText("Choose a file", { selector: "input" })).toBeInTheDocument(),
    );
  });

  it("says what is already on file, from the counts rather than from the step", async () => {
    stubApi(onboarding({ step: 2, progress: { documents: 2, imports: 1, clients: 5, mailboxConnected: false } }));
    await renderInRouter(<Onboarding />, "/onboarding");
    await waitFor(() => expect(screen.getByText(/2 documents and 5 clients on file/)).toBeInTheDocument());
  });
});

describe("step three — the mailbox", () => {
  it("starts the real OAuth flow and records the choice", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    stubApi(onboarding({ step: 3 }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getAllByText("Connect your email").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));

    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/mailboxes/connect"))).toBe(true));
    expect(put()[0]!.body).toMatchObject({ mailboxChoice: "connect" });
    // Off to Google's own page. Nothing here claims a connection.
    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining("accounts.google.com")));
    expect(screen.queryByText(/connected/i)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("says Gmail is not configured, and offers no connection that would fail", async () => {
    stubApi(
      onboarding({
        step: 3,
        gmailConfigured: false,
        gmailUnavailableReason: "Gmail connection is not configured. Whoever administers this deployment can add the Google credentials.",
      }),
    );
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getByText("Gmail connection is not configured.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeEnabled();
    expect(screen.queryByText(/is connected/i)).toBeNull();
  });

  it("sends a mailbox skip to the server", async () => {
    stubApi(onboarding({ step: 3 }));
    await renderInRouter(<Onboarding />, "/onboarding");
    await waitFor(() => expect(screen.getAllByText("Connect your email").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(put()).toHaveLength(1));
    expect(put()[0]!.body).toMatchObject({ mailboxChoice: "skip", step: 4 });
  });

  it("says a mailbox is connected only when one is", async () => {
    stubApi(onboarding({ step: 3, progress: { documents: 0, imports: 0, clients: 0, mailboxConnected: true } }));
    await renderInRouter(<Onboarding />, "/onboarding");
    await waitFor(() => expect(screen.getByText("Your mailbox is connected")).toBeInTheDocument());
  });
});

describe("step four — finishing", () => {
  it("finishes once however many times it is pressed", async () => {
    stubApi(onboarding({ step: 4 }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getByText("That is the setup done")).toBeInTheDocument());
    const button = screen.getByRole("button", { name: "Finish and open Today" });
    await userEvent.click(button);
    await userEvent.click(button);

    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/complete"))).toBe(true));
    expect(sent.filter((s) => s.url.endsWith("/complete"))).toHaveLength(1);
  });
});

describe("coming back after it is done", () => {
  it("shows what is set up rather than asking again, and writes nothing", async () => {
    stubApi(
      onboarding({
        step: 4,
        completedAt: "2026-09-20T10:00:00.000Z",
        recordsChoice: "skip",
        mailboxChoice: "skip",
        progress: { documents: 3, imports: 1, clients: 7, mailboxConnected: false },
      }),
    );
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getByText("Your setup is done")).toBeInTheDocument());
    expect(screen.getByText("Skipped for now")).toBeInTheDocument();
    // Looking is not doing: no step, no choice, no completion is written by arriving.
    expect(sent).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Finish and open Today" })).toBeNull();
    // And there is a deliberate way back in.
    expect(screen.getByRole("button", { name: "Start again" })).toBeInTheDocument();
  });
});

describe("moving between steps", () => {
  it("saves the step server-side, so a refresh returns to it", async () => {
    stubApi(onboarding({ step: 3 }));
    await renderInRouter(<Onboarding />, "/onboarding");

    await waitFor(() => expect(screen.getAllByText("Connect your email").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(put()).toHaveLength(1));
    expect(put()[0]!.body).toMatchObject({ step: 2 });
    // The screen followed the server's answer, not a local counter.
    await waitFor(() => expect(screen.getAllByText("Put some records in").length).toBeGreaterThan(0));
  });
});
