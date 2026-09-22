import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CREATE_KINDS, createSpace, createSpaceTitle } from "../live/create-space.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";
import { renderInRouter } from "../test-utils.js";

/**
 * The creation Spaces behind "+ New".
 *
 * Two promises are worth more than the rest. Arriving at one creates nothing — the form is where
 * a person decides, and the sheet that opened it wrote nothing. And every field the old six-form
 * page carried is still here: a claim still asks when it happened and what the client said, and
 * neither is optional.
 */

const IDLE = { busy: false, error: null, outcome: null };

describe("every creation Space", () => {
  it("has its own identity, so two of them are two tabs", () => {
    const refs = CREATE_KINDS.map((k) => createSpace(k, IDLE).self);
    expect(new Set(refs.map((r) => `${r.recordType}|${r.recordId}|${r.path}`)).size).toBe(
      CREATE_KINDS.length,
    );
    for (const ref of refs) expect(ref.path).toMatch(/^\/new\//);
  });

  it("creates nothing by being opened", () => {
    for (const kind of CREATE_KINDS) {
      const space = createSpace(kind, IDLE);
      expect(space.status.label, kind).toBe("Nothing created yet");
      // One form, one submit, and it is the only thing that writes.
      const form = space.blocks.find((b) => b.id === "form");
      expect(form?.type, kind).toBe("form");
      expect(form?.type === "form" ? form.actions : [], kind).toHaveLength(1);
    }
  });

  it("disables its submit while a write is in flight, so one click is one write", () => {
    const form = createSpace("client", { ...IDLE, busy: true }).blocks.find((b) => b.id === "form");
    expect(form?.type === "form" ? form.busy : false).toBe(true);
  });

  it("says nothing was created when a request failed", () => {
    const space = createSpace("claim", { ...IDLE, error: "Please sign in again." });
    const note = space.blocks.find((b) => b.id === "error");
    expect(note?.type === "note" ? note.title : "").toBe("Nothing was created");
  });
});

/* Every field, and every `required`, that the six-form page carried. Moved, not rewritten. */
describe("the fields the old page asked for", () => {
  const fieldsOf = (kind: (typeof CREATE_KINDS)[number]) => {
    const form = createSpace(kind, IDLE).blocks.find((b) => b.id === "form");
    if (form?.type !== "form") throw new Error("expected form");
    return form.fields;
  };

  it("asks a client for a name and whether it is a company or a person", () => {
    const fields = fieldsOf("client");
    expect(fields.map((f) => f.name)).toEqual(["clientName", "clientKind"]);
    expect(fields[0]?.required).toBe(true);
    expect(fields[1]?.options.map((o) => o.value)).toEqual(["corporate", "individual"]);
  });

  it("asks cover for the insurer, the class, the number and both dates", () => {
    const fields = fieldsOf("policy");
    expect(fields.map((f) => f.name)).toEqual([
      "clientName",
      "insurerName",
      "classOfBusiness",
      "policyNumber",
      "periodStart",
      "periodEnd",
    ]);
    // The policy number is the one optional field, as it was before: the insurer issues it later.
    expect(fields.find((f) => f.name === "policyNumber")?.required).toBe(false);
    expect(fields.filter((f) => f.kind === "date").map((f) => f.name)).toEqual([
      "periodStart",
      "periodEnd",
    ]);
  });

  it("asks a claim when it happened and what the client said, and needs both", () => {
    const fields = fieldsOf("claim");
    const when = fields.find((f) => f.name === "incidentOn")!;
    const said = fields.find((f) => f.name === "incidentSummary")!;
    expect(when.kind).toBe("date");
    expect(when.required).toBe(true);
    expect(said.required).toBe(true);
    // In their words, not a classification — the wording is the point.
    expect(said.placeholder).toMatch(/not a classification/);
  });

  it("asks a renewal which insurers to approach, and does not insist", () => {
    const insurers = fieldsOf("renewal").find((f) => f.name === "insurers")!;
    expect(insurers.required).toBe(false);
    expect(insurers.hint).toMatch(/commas/);
  });

  it("asks a policy change what is wanted and from when", () => {
    const fields = fieldsOf("endorsement");
    expect(fields.find((f) => f.name === "requestText")?.required).toBe(true);
    expect(fields.find((f) => f.name === "effectiveOn")?.required).toBe(false);
  });
});

/* None of these is a failure: a name matching two clients is a question. */
describe("what the server answers with", () => {
  it("offers the possible duplicates, and makes creating anyway a separate decision", () => {
    const space = createSpace("client", {
      ...IDLE,
      outcome: {
        outcome: "possible_duplicates",
        candidates: [
          { id: "20000000-0000-4000-8000-000000000001", name: "Tamarind Exporters Ltd", kind: "corporate" },
        ],
      } as never,
    });
    const rows = space.blocks.find((b) => b.id === "possible-duplicates");
    expect(rows?.type).toBe("rows");
    const gate = space.blocks.find((b) => b.id === "create-anyway");
    expect(gate?.type).toBe("approval_gate");
    expect(gate?.type === "approval_gate" ? gate.actions[0]?.stepId : "").toBe("confirm-new");
  });

  it("asks which client, when a name matched more than one", () => {
    const space = createSpace("claim", {
      ...IDLE,
      outcome: {
        outcome: "ambiguous",
        name: "Tamarind",
        candidates: [
          { id: "20000000-0000-4000-8000-000000000001", name: "Tamarind Exporters Ltd", kind: "corporate" },
          { id: "20000000-0000-4000-8000-000000000002", name: "Tamarind Holdings", kind: "corporate" },
        ],
      } as never,
    });
    const rows = space.blocks.find((b) => b.id === "which-client");
    if (rows?.type !== "rows") throw new Error("expected rows");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.actions[0]?.stepId).toBe("choose:20000000-0000-4000-8000-000000000001");
  });

  it("says a client has to exist first, and does not offer to make one here", () => {
    const space = createSpace("renewal", {
      ...IDLE,
      outcome: { outcome: "no_client", name: "Nobody Ltd" } as never,
    });
    const note = space.blocks.find((b) => b.id === "no-client");
    expect(note?.type === "note" ? note.title : "").toMatch(/No client on file/);
    expect(note?.type === "note" ? note.text : "").toMatch(/does not create clients from this form/);
  });

  it("says a change needs a policy, and that nothing was created", () => {
    const space = createSpace("endorsement", {
      ...IDLE,
      outcome: { outcome: "no_policy" } as never,
    });
    const note = space.blocks.find((b) => b.id === "no-policy");
    expect(note?.type === "note" ? note.text : "").toMatch(/nothing has been created/i);
  });
});

describe("on screen", () => {
  it("renders the claim form with its own title and fields", async () => {
    await renderInRouter(<SpaceFrameView space={createSpace("claim", IDLE)} />, "/new/claim");
    expect(screen.getByRole("heading", { level: 1, name: createSpaceTitle("claim") })).toBeInTheDocument();
    expect(screen.getByLabelText(/WHEN DID IT HAPPEN/)).toHaveAttribute("type", "date");
    expect(screen.getByRole("button", { name: "Register the claim" })).toBeEnabled();
  });

  it("will not submit an empty required field, and sends nothing", async () => {
    const sent: unknown[] = [];
    await renderInRouter(
      <SpaceFrameView space={createSpace("claim", IDLE)} onAct={(a) => sent.push(a)} />,
      "/new/claim",
    );
    await userEvent.click(screen.getByRole("button", { name: "Register the claim" }));
    expect(sent).toEqual([]);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("offers each duplicate candidate somewhere to open", async () => {
    const space = createSpace("client", {
      ...IDLE,
      outcome: {
        outcome: "possible_duplicates",
        candidates: [
          { id: "20000000-0000-4000-8000-000000000001", name: "Tamarind Exporters Ltd", kind: "corporate" },
        ],
      } as never,
    });
    await renderInRouter(<SpaceFrameView space={space} />, "/new/client");
    const row = screen.getByText("Tamarind Exporters Ltd").closest(".sp-row") as HTMLElement;
    expect(within(row).getByRole("link", { name: "Open this one" })).toHaveAttribute(
      "href",
      "/files/20000000-0000-4000-8000-000000000001",
    );
  });
});
