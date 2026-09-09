import type { RunRow, WorkItemRow } from "@asap/schema";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { WorkItemView } from "./RecordViews.js";

/** UI Build Spec v1 Part 14: the focus card leads, the recipe follows, the footer closes. */
const ORG = "10000000-0000-4000-8000-00000000000a";
const iso = () => new Date().toISOString();

const item = (over: Partial<WorkItemRow>): WorkItemRow => ({
  id: "30000000-0000-4000-8000-000000000005",
  organization_id: ORG,
  title: "Acme Motors — Motor commercial placement with Jubilee",
  kind: "placement",
  client_id: null,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: null,
  task_next_check: null,
  cover_status: null,
  cover_inception_at: null,
  money_status: null,
  reason: "Approval is blocked until Acme Motors' client file is cleared.",
  steps: [
    {
      id: "prepare",
      label: "Placement prepared",
      actor: "asap",
      state: "done",
      guards: [],
      evidence: [],
      actions: [],
      party: null,
      reason: null,
      recorded: [],
      runId: null,
    },
    {
      id: "approve",
      label: "Placement approved",
      actor: "you",
      state: "now",
      guards: ["client_file_cleared"],
      evidence: [],
      actions: [],
      party: null,
      reason: null,
      recorded: [],
      runId: null,
    },
  ],
  exception: null,
  version: 1,
  created_at: iso(),
  updated_at: iso(),
  completed_at: null,
  deleted_at: null,
  ...over,
});

const RUNS: RunRow[] = [];

describe("record page composition", () => {
  it("leads with a Next step focus card naming the decision in business words", async () => {
    const { container } = await renderInRouter(
      <WorkItemView item={item({})} runs={RUNS} actions={<button type="button">Approve</button>} />,
      "/r/30000000-0000-4000-8000-000000000005",
    );
    expect(screen.getByText("Next step")).toBeInTheDocument();
    const headline = screen.getByRole("heading", { name: "Approve this placement" });
    expect(headline).toBeInTheDocument();
    // The step's own label is not the headline; it belongs to the list below.
    expect(headline.textContent).not.toBe("Placement approved");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Why here?" })).toBeInTheDocument();
    // The focus card comes before the full step list.
    const html = container.innerHTML;
    expect(html.indexOf("Approve this placement")).toBeLessThan(html.indexOf("Every step"));
  });

  it("keeps the full step list as supporting context below", async () => {
    await renderInRouter(<WorkItemView item={item({})} runs={RUNS} />);
    const steps = screen.getByText("Every step").closest("section")!;
    expect(within(steps).getByText("Placement approved")).toBeInTheDocument();
    expect(within(steps).getByText("Placement prepared")).toBeInTheDocument();
  });

  it("Why here? discloses the reason and what has been recorded", async () => {
    await renderInRouter(<WorkItemView item={item({})} runs={RUNS} />);
    fireEvent.click(screen.getByRole("button", { name: "Why here?" }));
    expect(
      screen.getAllByText("Approval is blocked until Acme Motors' client file is cleared.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Nothing has been recorded against this record yet."),
    ).toBeInTheDocument();
  });

  it("renders only the panels the kind calls for", async () => {
    // reconciliation lists no servicing and no drafts section, so neither renders even when passed.
    await renderInRouter(
      <WorkItemView
        item={item({ kind: "reconciliation" })}
        runs={RUNS}
        aside={<p>servicing panel</p>}
        drafts={<p>draft panel</p>}
      />,
    );
    expect(screen.queryByText("servicing panel")).toBeNull();
    expect(screen.queryByText("draft panel")).toBeNull();
    expect(screen.getByText("Every step")).toBeInTheDocument();
  });

  it("renders the servicing and drafts panels for a claim", async () => {
    await renderInRouter(
      <WorkItemView
        item={item({ kind: "claim" })}
        runs={RUNS}
        aside={<p>servicing panel</p>}
        drafts={<p>draft panel</p>}
      />,
    );
    expect(screen.getByText("servicing panel")).toBeInTheDocument();
    expect(screen.getByText("draft panel")).toBeInTheDocument();
  });

  it("closes with the record footer: evidence, Activity and History", async () => {
    await renderInRouter(<WorkItemView item={item({})} runs={RUNS} />);
    expect(screen.getByRole("button", { name: /Evidence on record/ })).toBeInTheDocument();
    expect(screen.getByText("No runs on this record yet")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });
});
