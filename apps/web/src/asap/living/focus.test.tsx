import type { LivingSurface as Surface, WorkspaceInterpretation } from "@asap/schema";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, throughSupabaseBase: (u: string) => u }));

/*
 * Ask inside a workspace (D-165): a request becomes a focus in the address, the server recomposes
 * around it, and the answer is a registered block whose values came from the server. A request
 * that cannot be read changes nothing and says why.
 */
const ID = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const surface = (focused: boolean): Surface => ({
  version: 1, surfaceId: `renewal:${ID}`, purpose: "renewal",
  subject: { kind: "work_item", id: ID, title: "Renew Acme motor fleet" },
  stage: { key: "comparing", label: "Comparing" }, generatedAt: "2026-10-12T09:00:00Z",
  fingerprint: `fp-${focused}`, ai: { available: false }, unavailable: [],
  blocks: [
    { id: "header", component: "ContextHeader", version: 1, role: "lead", title: null, evidence: [], actions: [], hash: "h1",
      props: { eyebrow: "Renewal", title: "Acme Logistics — Motor fleet", client: null, facts: [], status: { label: "Comparing", tone: "green" }, owner: null } },
    ...(focused ? [{ id: "focus", component: "FocusPanel" as const, version: 1, role: "main" as const, title: "The evidence", evidence: [], actions: [], hash: "f1",
      props: { question: "Bring up the document behind this exclusion", understood: "The evidence behind “Exclusions”", source: "rules" as const, empty: null, emphasis: ["quotes"],
        items: [{ label: "Jubilee quote.pdf", detail: "Exclusions — page 3", tone: "grey" as const, ref: { ws: "document", documentId: DOC } }] } }] : []),
    { id: "quotes", component: "QuoteComparison", version: 1, role: "main", title: "Quotes side by side", hash: "q", evidence: [], actions: [],
      props: { insurers: [{ name: "Jubilee", stage: "Quoted", premium: "KES 175,500.00", validUntil: null, revision: 1, terms: [], declineReason: null }], note: null } },
  ],
});

async function mount(interpret: (id: string, t: string) => Promise<WorkspaceInterpretation>, viewRef: Record<string, unknown> = {}) {
  const { LivingRenewalPane } = await import("./panes.js");
  const onOpen = vi.fn();
  const living = vi.fn(async (_id: string, view?: { focus?: string | null }) => surface(!!view?.focus));
  render(<LivingRenewalPane workItemId={ID} runId={null} viewRef={{ ws: "living", workItemId: ID, ...viewRef }} living={living} interpret={interpret} onOpen={onOpen} onAsk={() => {}} onTitle={() => {}} />);
  await screen.findByText("Acme Logistics — Motor fleet");
  return { onOpen, living };
}

const ask = async (text: string) => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByText("Change view")); });
};

describe("Ask inside a workspace", () => {
  it("turns a request into a focus in the address, never into chat", async () => {
    const interpret = vi.fn(async () => ({ focus: { intent: "evidence" as const, target: "Exclusions" }, explore: null, understood: "x", unclear: null, source: "rules" as const }));
    const { onOpen } = await mount(interpret);
    await ask("Bring up the document behind this exclusion");
    expect(interpret).toHaveBeenCalledWith(ID, "Bring up the document behind this exclusion");
    expect(onOpen).toHaveBeenCalledWith({ ws: "living", workItemId: ID, focus: "evidence", target: "Exclusions", fq: "Bring up the document behind this exclusion", fsrc: "rules" });
  });

  it("opens an exploration when the request is a what-if", async () => {
    const interpret = vi.fn(async () => ({ focus: { intent: "explore" as const, target: "Jubilee" }, explore: ["33333333-3333-4333-8333-333333333333"], understood: "x", unclear: null, source: "rules" as const }));
    const { onOpen } = await mount(interpret);
    await ask("what if they chose Jubilee");
    expect(onOpen).toHaveBeenCalledWith({ ws: "living", workItemId: ID, explore: "33333333-3333-4333-8333-333333333333" });
  });

  it("changes nothing and says why when the request cannot be read or is refused", async () => {
    const interpret = vi.fn(async () => ({ focus: null, explore: null, understood: null, unclear: "Asking does not act.", source: "none" as const }));
    const { onOpen } = await mount(interpret);
    await ask("approve it");
    expect(await screen.findByText("Asking does not act.")).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders the focus answer from the server, marks what it concerns, and opens its evidence", async () => {
    const { onOpen, living } = await mount(vi.fn(), { focus: "evidence", target: "Exclusions", fq: "Bring up the document behind this exclusion", fsrc: "rules" });
    expect(living).toHaveBeenCalledWith(ID, { explore: [], focus: "evidence", target: "Exclusions", fq: "Bring up the document behind this exclusion", fsrc: "rules" });
    expect(await screen.findByText("The evidence behind “Exclusions”")).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-block="quotes"]')?.classList.contains("lv-emphasis")).toBe(true));
    fireEvent.click(screen.getByText("Jubilee quote.pdf"));
    expect(onOpen).toHaveBeenCalledWith({ ws: "document", documentId: DOC });
    fireEvent.click(screen.getByText("Show the whole workspace"));
    expect(onOpen).toHaveBeenLastCalledWith({ ws: "living", workItemId: ID });
  });
});
