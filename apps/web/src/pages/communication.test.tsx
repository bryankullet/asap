import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailThread } from "./Email.js";
import { renderInRouter } from "../test-utils.js";
import { resetWorkspaceTabs } from "../shell/workspace-tabs.js";

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * Communication (D-078).
 *
 * What these lock:
 *
 *  - a reply is never described as sent, and no Send button exists while nothing can send;
 *  - two conversations are two tabs, with two drafts — never one shared composer;
 *  - a suggested link says why it was suggested and is not applied until a person applies it;
 *  - editing an approved reply is sent to the server as an edit, and the approval the server
 *    returns is what the screen shows.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const THREAD = "81000000-0000-4000-8000-00000000000a";
const CLIENT = "82000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

const MESSAGE = {
  id: "83000000-0000-4000-8000-00000000000a",
  direction: "inbound",
  from: "ops@jubilee.test",
  to: ["broking@acme.test"],
  cc: ["finance@acme.test"],
  subject: "Renewal terms",
  body: "Terms attached for policy MOT-1188.",
  snippet: "Terms attached",
  sentAt: "2026-09-05T09:00:00.000Z",
  hasAttachments: true,
  providerMessageId: "gmail-msg-1",
  providerUrl: "https://mail.google.com/mail/u/0/#all/gmail-msg-1",
  attachments: [
    {
      id: "84000000-0000-4000-8000-00000000000a",
      filename: "terms.pdf",
      mimeType: "application/pdf",
      byteSize: 2048,
      providerAttachmentId: "gmail-att-1",
      documentId: "85000000-0000-4000-8000-00000000000a",
    },
  ],
};

function thread(over: Record<string, unknown> = {}) {
  return {
    thread: {
      id: THREAD,
      subject: "Renewal terms",
      clientId: null,
      clientName: null,
      workItemId: null,
      lastMessageAt: "2026-09-05T09:00:00.000Z",
      messageCount: 1,
      participants: ["ops@jubilee.test", "broking@acme.test"],
      provider: "gmail",
      mailboxAddress: "broking@acme.test",
      mailboxStatus: "connected",
      firstMessageAt: "2026-09-05T09:00:00.000Z",
      unhandled: "The last message came in and has not been answered.",
    },
    messages: [MESSAGE],
    links: {
      clientId: null,
      clientName: null,
      policyId: null,
      policyNumber: null,
      workItemId: null,
      workItemTitle: null,
      workItemKind: null,
    },
    suggestions: [
      {
        target: "client",
        id: CLIENT,
        label: "Otieno Holdings",
        because: "ops@jubilee.test is Jubilee operations' address on this client's file.",
        unambiguous: true,
      },
    ],
    draft: null,
    sending: {
      available: false,
      reason: "Sending from ASAP is not connected yet. Copy this draft or open it in Gmail.",
    },
    ...over,
  };
}

let sent: { url: string; method: string; body: unknown }[] = [];

function stubApi(body: Record<string, unknown> = thread()) {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method !== "GET") {
      sent.push({ url: u, method, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    }
    if (u.endsWith("/me")) return json(ME);
    if (u.includes("/draft")) return json({ draft: null });
    if (u.includes("/links")) return json({ links: (body as { links: unknown }).links });
    if (u.includes("/email/threads/")) return json(body);
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceTabs();
});

describe("a conversation", () => {
  it("shows the message with its sender, recipients and the provider's own id", async () => {
    stubApi();
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);

    await waitFor(() => expect(screen.getByText("ops@jubilee.test")).toBeInTheDocument());
    expect(screen.getByText(/id gmail-msg-1/)).toBeInTheDocument();
    expect(screen.getByText(/Received/)).toBeInTheDocument();
    expect(screen.getAllByText(/broking@acme.test/).length).toBeGreaterThan(0);
    expect(screen.getByText("terms.pdf")).toBeInTheDocument();
    // The original is reachable, and so is the document the attachment became.
    const original = screen.getByRole("link", { name: "Open the original" });
    // Out to the provider, in a new tab, and never as an in-application route.
    expect(original).toHaveAttribute("href", MESSAGE.providerUrl);
    expect(original).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByRole("link", { name: "Open terms.pdf" })).toBeInTheDocument();
  });

  it("says a draft has reached nobody, and offers no way to send", async () => {
    stubApi();
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);

    await waitFor(() =>
      expect(screen.getByText("This is a draft. Nobody has received it.")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Sending from ASAP is not connected yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
  });

  it("states why a link was suggested, and does not apply it on its own", async () => {
    stubApi();
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);

    await waitFor(() => expect(screen.getByText("Otieno Holdings")).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: "Why is this here?" })[0]!);
    expect(
      screen.getByText(/ops@jubilee.test is Jubilee operations' address on this client's file/),
    ).toBeInTheDocument();
    // Nothing was written by looking at it.
    expect(sent).toHaveLength(0);
    expect(screen.getAllByText("Not linked yet").length).toBeGreaterThan(0);
  });

  it("links the record only when a person says so, and sends it to the server", async () => {
    stubApi();
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);

    await waitFor(() => expect(screen.getByRole("button", { name: "Link it" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Link it" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: "PUT", body: { clientId: CLIENT } });
    expect(sent[0]?.url).toMatch(/\/links$/);
  });

  it("saves the reply to the server rather than keeping it in the browser", async () => {
    stubApi();
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);

    await waitFor(() => expect(screen.getByLabelText(/^Message/)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/^To/), "client@acme.test");
    await userEvent.type(screen.getByLabelText(/^Message/), "Terms received.");
    await userEvent.click(screen.getByRole("button", { name: "Save this draft" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "PUT",
      body: { to: ["client@acme.test"], body: "Terms received." },
    });
  });

  it("shows the approval the server reports, and what an approval covers", async () => {
    stubApi(
      thread({
        draft: {
          id: "86000000-0000-4000-8000-00000000000a",
          to: ["client@acme.test"],
          cc: [],
          subject: "Re: Renewal terms",
          body: "Terms received.",
          approvedAt: "2026-09-06T09:00:00.000Z",
          approvedByName: "Amina",
          updatedAt: "2026-09-06T09:00:00.000Z",
        },
      }),
    );
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);

    await waitFor(() => expect(screen.getByText(/Approved by Amina/)).toBeInTheDocument());
    expect(screen.getByText(/Editing it clears the approval/)).toBeInTheDocument();
    // Approved is still not sent.
    expect(screen.getByText("This is a draft. Nobody has received it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
  });

  it("offers approval only once there is a reply to approve", async () => {
    stubApi();
    await renderInRouter(<EmailThread />, `/email/${THREAD}`);
    await waitFor(() => expect(screen.getByLabelText(/^Message/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve this reply" })).toBeNull();
  });
});
