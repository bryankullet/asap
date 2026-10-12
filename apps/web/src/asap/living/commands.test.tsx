import type { LivingBlock } from "@asap/schema";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../../lib/api.js";

vi.mock("../../lib/supabase.js", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } }, throughSupabaseBase: (u: string) => u }));
const calls: { path: string; body: Record<string, unknown> }[] = [];
let answer: { outcome: string; reason?: string | null } = { outcome: "done" };
vi.mock("../../lib/api.js", async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: { ...real.api, livingCommand: async (path: string, body: Record<string, unknown>) => { calls.push({ path, body }); return answer; } } };
});

/*
 * Governed commands in place (D-157): the browser addresses the owning endpoint from its own table,
 * sends the frozen fields plus what the person filled in, and shows the endpoint's answer — never a
 * success it did not get.
 */
const ID = "11111111-1111-4111-8111-111111111111";
const block = (actions: LivingBlock["actions"]): LivingBlock => ({ id: "placement", component: "PlacementProgress", version: 1, role: "main", title: "Placement", evidence: [], hash: "x", actions,
  props: { insurerName: "Jubilee", steps: [], coverLine: "Requested from Jubilee — not confirmed.", blockers: [] } });

async function mount(actions: LivingBlock["actions"]) {
  calls.length = 0;
  const { BlockActions } = await import("./blocks.js");
  const refresh = vi.fn();
  render(<BlockActions actions={block(actions).actions} env={{ open: () => {}, ask: () => {}, refresh }} />);
  return refresh;
}

describe("governed commands", () => {
  const record: LivingBlock["actions"][number] = {
    kind: "command", label: "Record how the request was sent", command: "placement.record_submission", target: ID, tone: "primary", confirm: null,
    payload: { action: "record_submission", placementRequestId: "22222222-2222-4222-8222-222222222222" },
    inputs: [
      { name: "method", label: "How it was sent", kind: "select", required: true, options: [{ value: "recorded_portal", label: "Portal" }], hint: null },
      { name: "recipient", label: "Who received it", kind: "text", required: true, options: [], hint: null },
    ],
  };
  it("asks for what is missing, then posts the frozen fields and inputs to the owning endpoint once", async () => {
    answer = { outcome: "done" };
    const refresh = await mount([record]);
    fireEvent.click(screen.getByRole("button", { name: "Record how the request was sent" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Record how the request was sent" })[1]!);
    expect(await screen.findByText(/Still needed: How it was sent, Who received it/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "recorded_portal" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "portal ref 7781" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Record how the request was sent" })[1]!);
    await screen.findByText("Done.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`/placements/${ID}/actions`);
    expect(calls[0]!.body).toMatchObject({ action: "record_submission", placementRequestId: "22222222-2222-4222-8222-222222222222", method: "recorded_portal", recipient: "portal ref 7781" });
    expect(typeof calls[0]!.body["idempotencyKey"]).toBe("string");
    expect(refresh).toHaveBeenCalled();
  });
  it("shows the endpoint's refusal and its reason, and does not claim success", async () => {
    answer = { outcome: "blocked", reason: "Your role cannot approve what leaves the brokerage. Nothing was approved." };
    const refresh = await mount([{ kind: "command", label: "Approve and send", command: "workflow_approval.decide", target: ID, tone: "primary", payload: { decision: "approve", bundleSha256: "a".repeat(64) }, inputs: [], confirm: { title: "Approve and send?", body: "2 messages will leave." } }]);
    fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
    expect(screen.getByText("2 messages will leave.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Approve and send" })[1]!);
    await waitFor(() => expect(screen.getByText(/Nothing was approved/)).toBeTruthy());
    expect(calls[0]!.path).toBe(`/workflow-approvals/${ID}/decide`);
    expect(screen.queryByText("Done.")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps an open form on its own command when commands are reordered, and closes it if the command leaves", async () => {
    const { BlockActions } = await import("./blocks.js");
    const env = { open: () => {}, ask: () => {}, refresh: () => {} };
    const follow: LivingBlock["actions"][number] = { kind: "command", label: "Follow up now", command: "run.follow_up_now", target: ID, tone: "default", payload: {}, inputs: [], confirm: null };
    const escalate: LivingBlock["actions"][number] = { kind: "command", label: "Escalate", command: "run.escalate", target: ID, tone: "default", payload: {}, inputs: [{ name: "reason", label: "Why it is escalated", kind: "textarea", required: true, options: [], hint: null }], confirm: null };
    const pause: LivingBlock["actions"][number] = { kind: "command", label: "Pause ASAP", command: "run.pause", target: ID, tone: "default", payload: {}, inputs: [{ name: "reason", label: "Why (optional)", kind: "textarea", required: false, options: [], hint: null }], confirm: null };
    const view = render(<BlockActions actions={[follow, escalate, pause]} env={env} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Client wants terms this week" } });
    // The run moved on: "Follow up now" is no longer offered, so the other commands move up.
    view.rerender(<BlockActions actions={[escalate, pause]} env={env} />);
    expect(screen.getByText("Why it is escalated")).toBeTruthy();
    expect(screen.queryByText("Why (optional)")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Client wants terms this week");
    view.rerender(<BlockActions actions={[pause]} env={env} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/“Escalate” is no longer offered here/)).toBeTruthy();
  });
});
