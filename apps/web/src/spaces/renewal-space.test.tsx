/**
 * The Renewal Space renderer. It renders a validated plan, in order, and nothing else.
 *
 * The plan's *content* is proven where it is built — `apps/api/test/space-plan.test.ts`. These
 * tests cover the renderer's own promises: the focus block leads, only the blocks in the plan
 * appear, a follow-up changes the blocks rather than navigating, a draft is never shown as sent,
 * an unknown block is said out loud, and no banned word reaches the page.
 */
import type { SpaceBlock, SpacePlanResponse, WorkItemRow } from "@asap/schema";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { RenewalSpace, viewForQuestion } from "./RenewalSpace.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const RECORD = "30000000-0000-4000-8000-000000000001";
const iso = "2026-09-05T09:00:00.000Z";

const item: WorkItemRow = {
  id: RECORD,
  organization_id: ORG,
  title: "Acme Motors — renewal terms from Jubilee",
  kind: "renewal",
  client_id: null,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "with_party",
  task_party: "Jubilee",
  task_since: iso,
  task_next_check: iso,
  cover_status: "active",
  cover_inception_at: null,
  money_status: "unpaid",
  reason: "Terms were requested from Jubilee five days ago.",
  steps: [],
  exception: null,
  version: 4,
  created_at: iso,
  updated_at: iso,
  completed_at: null,
  deleted_at: null,
};

const focus: SpaceBlock = {
  component: "RenewalReadiness",
  version: 1,
  props: {
    eyebrow: "Next step",
    headline: "Chase Jubilee for the renewal terms",
    why: "Terms were requested five days ago and the check was due yesterday.",
    blockedBy: null,
    ready: ["Client file checked", "Expiring policy reviewed"],
    outstanding: ["Terms received"],
  },
  evidence: [],
  actions: [
    { verb: "draft", label: "Draft the request", stepId: "request_terms", disabledReason: null },
    {
      verb: "record_send",
      label: "I sent this",
      stepId: "request_terms",
      disabledReason: "Record what you sent first.",
    },
  ],
};

const tracker: SpaceBlock = {
  component: "InsurerResponseTracker",
  version: 1,
  props: {
    insurers: [
      { name: "Jubilee", state: "not_on_file", reference: null, recordedAt: null },
      { name: "APA", state: "on_file", reference: "APA terms, email 2 September", recordedAt: iso },
    ],
  },
  evidence: [
    { label: "APA terms", reference: "APA terms, email 2 September", recordedBy: "Amina", recordedAt: iso },
  ],
  actions: [],
};

const draft: SpaceBlock = {
  component: "DraftEmail",
  version: 1,
  props: {
    to: "renewals@jubilee.example",
    subject: "Acme motor renewal — outstanding terms",
    body: "Please share the outstanding terms.",
    sentAt: null,
    sentEvidence: null,
  },
  evidence: [],
  actions: [],
};

const response = (blocks: SpaceBlock[], suggestions: string[] = []): SpacePlanResponse => ({
  plan: {
    spaceType: "renewal",
    view: "summary",
    recordId: RECORD,
    title: item.title,
    blocks,
    source: "recipe",
    suggestions,
  },
  registry: blocks.map((b) => ({ component: b.component, version: b.version })),
});

const noop = () => {};

describe("the Renewal Space", () => {
  it("is titled as the record and leads with the focus block", async () => {
    const { container } = await renderInRouter(
      <RenewalSpace
        data={response([focus, tracker])}
        item={item}
        view="summary"
        onView={noop}
        onAct={noop}
      />,
      `/r/${RECORD}`,
    );
    expect(
      screen.getByRole("heading", { name: "Acme Motors — renewal terms from Jubilee", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Next step")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Chase Jubilee for the renewal terms" }),
    ).toBeInTheDocument();
    // The focus block comes first, before any supporting panel.
    const html = container.innerHTML;
    expect(html.indexOf("Chase Jubilee")).toBeLessThan(html.indexOf("Insurer terms"));
  });

  it("renders only the blocks the plan carries", async () => {
    await renderInRouter(
      <RenewalSpace data={response([focus])} item={item} view="blocker" onView={noop} onAct={noop} />,
    );
    expect(screen.getByText("Next step")).toBeInTheDocument();
    // Not every panel for every question: nothing else was in the plan, so nothing else renders.
    expect(screen.queryByText("Insurer terms")).toBeNull();
    expect(screen.queryByText("Prepared for you")).toBeNull();
    expect(screen.queryByText("Current cover period")).toBeNull();
  });

  it("offers the plan's actions and disables a blocked one with its own reason", async () => {
    const onAct = vi.fn();
    await renderInRouter(
      <RenewalSpace data={response([focus])} item={item} view="summary" onView={noop} onAct={onAct} />,
    );
    const draftButton = screen.getByRole("button", { name: "Draft the request" });
    expect(draftButton).toBeEnabled();
    const blocked = screen.getByRole("button", { name: "I sent this" });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute("title", "Record what you sent first.");
    fireEvent.click(draftButton);
    expect(onAct).toHaveBeenCalledWith(focus.actions[0]);
  });

  it("puts evidence beside the fact it supports", async () => {
    await renderInRouter(
      <RenewalSpace data={response([tracker])} item={item} view="summary" onView={noop} onAct={noop} />,
    );
    expect(screen.getByText(/On file/)).toBeInTheDocument();
    expect(screen.getByText("Not on file")).toBeInTheDocument();
    expect(screen.getByText(/APA terms, email 2 September/)).toBeInTheDocument();
  });

  it("shows a prepared draft as a draft, never as sent", async () => {
    await renderInRouter(
      <RenewalSpace data={response([draft])} item={item} view="summary" onView={noop} onAct={noop} />,
    );
    expect(screen.getByText("Draft — you send it")).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).toBeNull();
  });

  it("changes the blocks on a follow-up instead of navigating", async () => {
    const onView = vi.fn();
    const { router } = await renderInRouter(
      <RenewalSpace
        data={response([focus], ["Compare the terms", "What is outstanding?"])}
        item={item}
        view="summary"
        onView={onView}
        onAct={noop}
      />,
      `/r/${RECORD}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compare the terms" }));
    expect(onView).toHaveBeenCalledWith("comparison");
    // Still the same record: no insurance module was navigated through.
    expect(router.state.location.pathname).toBe(`/r/${RECORD}`);
  });

  it("says so when the server sends a block this build cannot render", async () => {
    const future: SpaceBlock = {
      component: "PremiumBreakdown",
      version: 1,
      props: {},
      evidence: [],
      actions: [],
    };
    await renderInRouter(
      <RenewalSpace
        data={response([focus, future])}
        item={item}
        view="summary"
        onView={noop}
        onAct={noop}
      />,
    );
    // Skipped, and said out loud. Never guessed at, never silently dropped.
    expect(screen.getByText(/needs a newer version of the app: PremiumBreakdown/)).toBeInTheDocument();
  });

  it("closes with the record footer", async () => {
    const { container } = await renderInRouter(
      <RenewalSpace data={response([focus])} item={item} view="summary" onView={noop} onAct={noop} />,
    );
    const footer = container.querySelector("footer")!;
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toMatch(/Evidence on record/);
    expect(footer.textContent).toMatch(/History/);
  });

  it("renders no banned status word anywhere", async () => {
    const { container } = await renderInRouter(
      <RenewalSpace
        data={response([focus, tracker, draft])}
        item={item}
        view="summary"
        onView={noop}
        onAct={noop}
      />,
    );
    const text = container.textContent ?? "";
    for (const banned of ["Waiting", "Failed", "Success", "Space", "Job"]) {
      expect(text, `${banned} must not render`).not.toMatch(new RegExp(`\\b${banned}\\b`));
    }
  });
});

describe("follow-up routing", () => {
  it("maps the questions the prototype answers onto views", () => {
    expect(viewForQuestion("Compare the terms")).toBe("comparison");
    expect(viewForQuestion("Why did APA increase the premium?")).toBe("comparison");
    expect(viewForQuestion("What is outstanding?")).toBe("blocker");
    expect(viewForQuestion("Show me the current policy")).toBe("policy");
    expect(viewForQuestion("What has ASAP done?")).toBe("timeline");
    // Anything else keeps the view it was already on.
    expect(viewForQuestion("hello", "summary")).toBe("summary");
  });
});
