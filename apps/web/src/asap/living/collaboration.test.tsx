import type { LivingSurface as Surface } from "@asap/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, throughSupabaseBase: (u: string) => u }));

/*
 * Arrived email, handover, related work, response patterns and the last round's decisions (D-166):
 * the server's values rendered as text, ASAP's reading labelled "Not a fact", estimates marked, and
 * every link opening a governed place.
 */
const ID = "11111111-1111-4111-8111-111111111111";
const W2 = "99999999-9999-4999-8999-999999999999";
const DOC = "22222222-2222-4222-8222-222222222222";
const blk = (id: string, component: string, role: "main" | "side", title: string, props: unknown) => ({ id, component, version: 1, role, title, props, evidence: [], actions: [], hash: id }) as unknown as Surface["blocks"][number];
const surface: Surface = {
  version: 1, surfaceId: `claim:${ID}`, purpose: "claim", subject: { kind: "work_item", id: ID, title: "Claim" }, stage: null,
  generatedAt: "2026-10-12T09:00:00Z", fingerprint: "f", ai: { available: false }, unavailable: [],
  blocks: [
    blk("header", "ContextHeader", "main", "", { eyebrow: "Claim", title: "Acme — windscreen", client: null, facts: [], status: { label: "Draft", tone: "gold" }, owner: null }),
    blk("handover", "HandoverNote", "main", "Handed to you", { from: "Brian Kamau", to: "Amina Otieno", at: "2026-10-11T08:00:00Z", done: "Notified Jubilee", open: "Police abstract outstanding", watch: "Client asked for a call", acknowledgedAt: null, forViewer: true, earlier: 1 }),
    blk("arrived", "ArrivedMail", "main", "Arrived and not yet dealt with", { items: [{ id: "55555555-5555-4555-8555-555555555555", from: "underwriting@jubilee.test", subject: "Re: terms", at: "2026-10-11T08:00:00Z", party: "Jubilee", reading: "ASAP's reading: an insurer's quotation or terms", proposal: { summary: "KES 189,000.00", words: "Premium KES 189,000" }, proposed: "Confirm it as read, or record it differently on the quotes." }], note: "Filing an email records nothing." }),
    blk("related", "RelatedWork", "side", "Related work", { items: [{ title: "Acme — policy change", kind: "Policy change", status: "In progress", why: "A change to this policy is open.", certainty: "potential", ref: { ws: "living", workItemId: W2 } }] }),
    blk("patterns", "ResponsePatterns", "side", "What usually happens", { items: [{ party: "CIC", measure: "Too little on file to say: 2 delivered requests in the last year.", sample: 2, enough: false }], basis: "An estimate, not a promise." }),
    blk("trail", "DecisionTrail", "side", "Decided last time", { round: "Acme motor 2025, closed 3 Nov 2025", items: [{ at: "2025-10-10", text: "CIC declined — outside appetite", by: null, tone: "red", ref: { ws: "document", documentId: DOC } }], note: "A starting point, not this year's decision." }),
  ],
};

describe("collaboration blocks", () => {
  it("renders each from the server's values, labels the reading, and opens governed places", async () => {
    const { LivingSurface } = await import("./LivingSurface.js");
    const onOpen = vi.fn();
    render(<LivingSurface identity={ID} load={async () => surface} onOpen={onOpen} onAsk={() => {}} />);
    expect(await screen.findByText("Notified Jubilee")).toBeTruthy();
    expect(screen.getByText("Not acknowledged yet")).toBeTruthy();
    expect(screen.getByText(/1 earlier handover/)).toBeTruthy();
    expect(screen.getByText("Not a fact")).toBeTruthy();
    expect(screen.getByText("KES 189,000.00")).toBeTruthy();
    expect(screen.getByText(/Too little on file to say/).className).toContain("lv-missing");
    fireEvent.click(screen.getByText("Acme — policy change"));
    expect(onOpen).toHaveBeenCalledWith({ ws: "living", workItemId: W2 });
    fireEvent.click(screen.getByText("Open the evidence"));
    expect(onOpen).toHaveBeenCalledWith({ ws: "document", documentId: DOC });
  });
});
