import type { LivingSurface as Surface } from "@asap/schema";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, throughSupabaseBase: (u: string) => u }));

/*
 * The Living surface renderer (D-156): registered blocks only, values exactly as the server sent
 * them, calm reconciliation when the surface changes, and a designed state for every failure.
 */
const ID = "11111111-1111-4111-8111-111111111111";
const surface = (over: { premium?: string; extra?: boolean; unavailable?: Surface["unavailable"] } = {}): Surface => ({
  version: 1, surfaceId: `renewal:${ID}`, purpose: "renewal",
  subject: { kind: "work_item", id: ID, title: "Renew Acme motor fleet" },
  stage: { key: "comparing", label: "Comparing" }, generatedAt: "2026-10-12T09:00:00Z",
  fingerprint: `fp-${over.premium ?? "a"}-${over.extra ? 1 : 0}`, ai: { available: false }, unavailable: over.unavailable ?? [],
  blocks: [
    { id: "header", component: "ContextHeader", version: 1, role: "lead", title: null, evidence: [], actions: [], hash: "h1",
      props: { eyebrow: "Renewal", title: "Acme Logistics — Motor fleet P-4471", client: null, facts: [{ label: "Cover ends", value: "31 Oct 2026 · 19 days" }], status: { label: "Comparing", tone: "green" }, owner: "Wanjiru" } },
    { id: "quotes", component: "QuoteComparison", version: 1, role: "main", title: "Quotes side by side", hash: `q-${over.premium ?? "a"}`,
      evidence: [{ label: "Jubilee's answer", reference: "Jubilee quote.pdf", documentId: "22222222-2222-4222-8222-222222222222", recordedAt: null }],
      actions: [{ kind: "open", label: "Open the quotation", ref: { ws: "quote", opportunityId: "o1" }, primary: true }],
      props: { insurers: [{ name: "Jubilee", stage: "Quoted", premium: over.premium ?? "KES 175,500.00", validUntil: "2026-11-01", revision: 1, terms: [], declineReason: null }], note: "ASAP does not pick a winner." } },
    ...(over.extra ? [{ id: "consequences", component: "ConsequencePanel" as const, version: 1, role: "side" as const, title: "What this means", evidence: [], actions: [], hash: "c1", props: { items: [{ certainty: "potential" as const, text: "Nothing on file yet confirms cover." }] } }] : []),
    { id: "rogue", component: "NotRegistered" as never, version: 1, role: "side", title: "Rogue", evidence: [], actions: [], hash: "r", props: {} },
  ],
});

async function mount(load: (id: string) => Promise<Surface>, onOpen = vi.fn()) {
  localStorage.clear();
  const { LivingSurface } = await import("./LivingSurface.js");
  render(<LivingSurface identity={ID} runId="r1" load={() => load(ID)} onOpen={onOpen} onAsk={() => {}} />);
  return onOpen;
}

describe("LivingSurface", () => {
  it("renders registered blocks with the server's values, and nothing unregistered", async () => {
    const onOpen = await mount(async () => surface());
    expect(await screen.findByText("Acme Logistics — Motor fleet P-4471")).toBeTruthy();
    expect(screen.getByText("KES 175,500.00")).toBeTruthy();
    expect(screen.queryByText("Rogue")).toBeNull();
    fireEvent.click(screen.getByText("Open the quotation"));
    expect(onOpen).toHaveBeenCalledWith({ ws: "quote", opportunityId: "o1" });
    fireEvent.click(screen.getByText("Renewal steps"));
    expect(onOpen).toHaveBeenCalledWith({ ws: "renewal", runId: "r1" });
  });

  it("marks a changed block Updated and a new one New, in place, on refresh", async () => {
    let n = 0;
    await mount(async () => (n++ === 0 ? surface() : surface({ premium: "KES 189,000.00", extra: true })));
    await screen.findByText("KES 175,500.00");
    const before = document.querySelector('[data-block="quotes"]');
    await act(async () => { fireEvent.click(screen.getByText("Refresh")); });
    await screen.findByText("KES 189,000.00");
    expect(document.querySelector('[data-block="quotes"]')).toBe(before);
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("keeps a block collapsed for this person across a remount, through the server store", async () => {
    const saved = new Map<string, unknown>();
    const store = { get: vi.fn(async (k: string) => (saved.get(k) as never) ?? { pinned: [], collapsed: [], selection: {}, lastSeenAt: null }), put: vi.fn(async (k: string, p: unknown) => { saved.set(k, p); }) };
    const { LivingSurface } = await import("./LivingSurface.js");
    localStorage.clear();
    const first = render(<LivingSurface identity={ID} runId={null} load={async () => surface()} prefsStore={store} onOpen={() => {}} onAsk={() => {}} />);
    await screen.findByText("KES 175,500.00");
    fireEvent.click(screen.getAllByTitle("Collapse")[0]!);
    expect(screen.queryByText("KES 175,500.00")).toBeNull();
    await waitFor(() => expect((saved.get(`renewal:${ID}`) as { collapsed: string[] } | undefined)?.collapsed).toEqual(["quotes"]), { timeout: 2000 });
    expect(store.get).toHaveBeenCalledWith(`renewal:${ID}`);
    expect(localStorage.length).toBe(0);
    first.unmount();
    render(<LivingSurface identity={ID} runId={null} load={async () => surface()} prefsStore={store} onOpen={() => {}} onAsk={() => {}} />);
    await screen.findByText("Quotes side by side");
    await waitFor(() => expect(screen.queryByText("KES 175,500.00")).toBeNull());
  });

  it("keeps what the person arranged before their saved arrangement arrived", async () => {
    let release: (v: unknown) => void = () => {};
    const saved = new Map<string, unknown>();
    const store = { get: vi.fn(() => new Promise<never>((r) => { release = r as never; })), put: vi.fn(async (k: string, p: unknown) => { saved.set(k, p); }) };
    const { LivingSurface } = await import("./LivingSurface.js");
    render(<LivingSurface identity={ID} load={async () => surface()} prefsStore={store as never} onOpen={() => {}} onAsk={() => {}} />);
    await screen.findByText("KES 175,500.00");
    fireEvent.click(screen.getAllByTitle("Collapse")[0]!);
    release({ pinned: [], collapsed: [], selection: {}, lastSeenAt: null });
    await waitFor(() => expect(store.put).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("KES 175,500.00")).toBeNull();
    expect((saved.get(`renewal:${ID}`) as { collapsed: string[] }).collapsed).toEqual(["quotes"]);
  });

  it("renders record text as text: markup in a title is never interpreted", async () => {
    const evil = surface();
    (evil.blocks[0]!.props as { title: string }).title = `<img src=x onerror="window.__pwned=1">Acme`;
    await mount(async () => evil);
    expect(await screen.findByText(`<img src=x onerror="window.__pwned=1">Acme`)).toBeTruthy();
    expect(document.querySelector(".lv-root img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("says which sources could not be read, instead of showing them as missing", async () => {
    await mount(async () => surface({ unavailable: [{ part: "The placement", reason: "restricted" }] }));
    expect(await screen.findByText(/Part of this renewal could not be read for you/)).toBeTruthy();
    expect(screen.getByText(/The placement \(not available to your role\)/)).toBeTruthy();
  });

  it("says when it is not available, and never shows an example instead", async () => {
    const { ApiRequestError } = await import("../../lib/api.js");
    await mount(async () => { throw new ApiRequestError(404, "not_found"); });
    expect(await screen.findByText("This renewal is not available to you")).toBeTruthy();
    expect(screen.queryByText("Open the renewal steps")).toBeNull();
  });
});
