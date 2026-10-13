import type { InvestigateResponse, LivingSurface as Surface } from "@asap/schema";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, throughSupabaseBase: (u: string) => u }));

/*
 * Client investigations (D-167): Home recognises a request to look across a client; the server says
 * which client, or asks; a single match replaces the address with the client's own.
 */
const C1 = "33333333-3333-4333-8333-333333333333";
const C2 = "44444444-4444-4444-8444-444444444444";
const surface: Surface = {
  version: 1, surfaceId: `investigation:${C1}`, purpose: "investigation", subject: { kind: "client", id: C1, title: "Zawadi Haulage" }, stage: null,
  generatedAt: "2026-10-12T09:00:00Z", fingerprint: "f", ai: { available: false }, unavailable: [],
  blocks: [{ id: "header", component: "ContextHeader", version: 1, role: "lead", title: null, evidence: [], actions: [], hash: "h", props: { eyebrow: "Client", title: "Zawadi Haulage", client: null, facts: [{ label: "Open work", value: "3" }], status: { label: "1 needs someone", tone: "gold" }, owner: null } }],
};

describe("looking across a client", () => {
  it("recognises requests to look across a client, and leaves requests to act alone", async () => {
    const { looksLikeInvestigation } = await import("./panes.js");
    expect(looksLikeInvestigation("everything about Zawadi Haulage")).toBe(true);
    expect(looksLikeInvestigation("what's going on with Acme?")).toBe(true);
    expect(looksLikeInvestigation("look into Acme Motors")).toBe(true);
    expect(looksLikeInvestigation("send everything about Acme to the insurer")).toBe(false);
    expect(looksLikeInvestigation("renewals in the next 60 days")).toBe(false);
  });

  it("replaces the address with the client's own when one client matches", async () => {
    const { InvestigationPane } = await import("./panes.js");
    const onNavigate = vi.fn();
    const resolve = vi.fn(async (): Promise<InvestigateResponse> => ({ clientId: C1, unclear: null, candidates: [] }));
    render(<InvestigationPane viewRef={{ ws: "investigation", t: "everything about Zawadi" }} investigation={async () => surface} resolveClient={resolve} onOpen={() => {}} onNavigate={onNavigate} onAsk={() => {}} onTitle={() => {}} />);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith({ ws: "investigation", clientId: C1 }, true));
  });

  it("asks which client when more than one matches, and opens the one chosen", async () => {
    const { InvestigationPane } = await import("./panes.js");
    const onNavigate = vi.fn();
    const resolve = async (): Promise<InvestigateResponse> => ({ clientId: null, unclear: "More than one client matches. Which one?", candidates: [{ id: C1, name: "Zawadi Haulage" }, { id: C2, name: "Zawadi Logistics" }] });
    render(<InvestigationPane viewRef={{ ws: "investigation", t: "zawadi" }} investigation={async () => surface} resolveClient={resolve} onOpen={() => {}} onNavigate={onNavigate} onAsk={() => {}} onTitle={() => {}} />);
    expect(await screen.findByText("More than one client matches. Which one?")).toBeTruthy();
    fireEvent.click(screen.getByText("Zawadi Logistics"));
    expect(onNavigate).toHaveBeenCalledWith({ ws: "investigation", clientId: C2 }, false);
  });

  it("composes the client's workspace from the server", async () => {
    const { InvestigationPane } = await import("./panes.js");
    render(<InvestigationPane viewRef={{ ws: "investigation", clientId: C1 }} investigation={async () => surface} onOpen={() => {}} onNavigate={() => {}} onAsk={() => {}} onTitle={() => {}} />);
    expect(await screen.findByText("Zawadi Haulage")).toBeTruthy();
    expect(screen.getByText("1 needs someone")).toBeTruthy();
  });
});
