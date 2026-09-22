import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  SpaceBlockType,
  parseSpaceBlock,
  spaceFrameBlockSchema,
  type SpaceFrameBlock,
} from "@asap/schema";
import { SpaceBlockView, isRenderableBlock } from "./blocks.js";
import { renderInRouter } from "../test-utils.js";

/**
 * The Space renderer, block by block.
 *
 * The rule these tests exist to hold is §45 rule 9: a component not in the registry does not
 * render, and a displayed business value never comes from model text. The first is provable — an
 * unknown type has no branch in the union and no entry in the registry — and the rest is a matter
 * of every block drawing what it was given and nothing else.
 */

const envelope = {
  label: null,
  evidence: [],
  actions: [],
  state: "ready" as const,
  stateNote: null,
};

/** One valid block of every registered type, so the registry can be walked rather than sampled. */
const SAMPLES: { [T in SpaceFrameBlock["type"]]: Extract<SpaceFrameBlock, { type: T }> } = {
  facts: {
    ...envelope,
    id: "f",
    type: "facts",
    facts: [
      { key: "INSURER", value: "CIC General", missing: false, evidence: [] },
      { key: "POLICY NUMBER", value: "", missing: true, evidence: [] },
    ],
  },
  rows: {
    ...envelope,
    id: "r",
    type: "rows",
    rows: [
      {
        id: "row-1",
        title: "Confirm cover with CIC",
        note: "Acme Manufacturing · Placement · With CIC since 12 Aug",
        badge: "High",
        badgeTone: "attention",
        why: "No confirmation is recorded against the request sent on 12 Aug.",
        related: {
          spaceKind: "placement",
          recordType: "work_item",
          recordId: "00000000-0000-4000-8000-000000000001",
          workflowId: null,
          path: "/r/00000000-0000-4000-8000-000000000001",
          title: "Confirm cover with CIC",
          label: "PLACEMENT",
        },
        region: null,
        actions: [],
        evidence: [],
      },
    ],
  },
  missing: { ...envelope, id: "m", type: "missing", items: [{ text: "No KRA PIN on file." }] },
  note: {
    ...envelope,
    id: "n",
    type: "note",
    tone: "active",
    title: "Observed",
    text: "Ranking is computed from your own rows.",
  },
  compare: {
    ...envelope,
    id: "c",
    type: "compare",
    termHeading: "TERM",
    columns: [{ label: "CIC" }, { label: "Jubilee" }],
    rows: [
      {
        label: "Excess",
        cells: [
          { value: "KES 20,000", tone: "neutral" },
          { value: "Not stated", tone: "waiting" },
        ],
      },
    ],
  },
  table: {
    ...envelope,
    id: "t",
    type: "table",
    columns: [{ label: "DATE" }, { label: "AMOUNT" }],
    rows: [
      {
        id: "t1",
        cells: [
          { value: "12 Aug", tone: "neutral" },
          { value: "KES 41,000", tone: "neutral" },
        ],
      },
    ],
  },
  calculation: {
    ...envelope,
    id: "calc",
    type: "calculation",
    lines: [
      { key: "Premium", value: "KES 100,000", emphasis: false },
      { key: "Total payable", value: "KES 100,450", emphasis: true },
    ],
  },
  document: {
    ...envelope,
    id: "d",
    type: "document",
    name: "Motor schedule.pdf",
    documentKind: "Policy schedule",
    title: "CERTIFICATE OF INSURANCE",
    lines: [
      {
        parts: [
          { text: "Sum insured ", highlighted: false },
          { text: "KES 3,400,000", highlighted: true },
        ],
      },
    ],
    note: "Every highlighted figure opens its page.",
  },
  email: {
    ...envelope,
    id: "e",
    type: "email",
    headLabel: "DRAFT",
    headMeta: "Not sent",
    tone: "waiting",
    to: "underwriting@example.test",
    subject: "Cover confirmation",
    body: "Please confirm cover.",
    attachments: [{ name: "schedule.pdf" }],
  },
  upload: {
    ...envelope,
    id: "u",
    type: "upload",
    prompt: "Add the insurer's schedule",
    multiple: true,
    accept: "application/pdf,image/png",
    maxBytes: 52_428_800,
    busy: false,
    progress: [{ name: "schedule.pdf", state: "reading", percent: 40, tone: "active" }],
  },
  assignment: {
    ...envelope,
    id: "a",
    type: "assignment",
    ownerId: null,
    dueAt: null,
    people: [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Amina Yusuf" }],
    permissionNote: "Assignment changes owner. It does not grant data access.",
  },
  automation_builder: {
    ...envelope,
    id: "b",
    type: "automation_builder",
    fields: [{ name: "name", label: "NAME", value: "", placeholder: "Chase unconfirmed cover" }],
  },
  approval_gate: {
    ...envelope,
    id: "g",
    type: "approval_gate",
    heading: "Approve this placement",
    detail: "The insurer's confirmation and the client's instruction are both on file.",
    blockedNote: null,
  },
  form: {
    ...envelope,
    id: "form",
    type: "form",
    submitLabel: "Add the client",
    busy: false,
    fields: [
      {
        name: "name",
        label: "WHAT IS THE CLIENT CALLED?",
        kind: "text",
        value: "",
        placeholder: "As it appears on their documents",
        required: true,
        options: [],
        hint: "",
        error: null,
      },
      {
        name: "kind",
        label: "COMPANY OR PERSON",
        kind: "choice",
        value: "corporate",
        placeholder: "",
        required: true,
        options: [
          { value: "corporate", label: "A company" },
          { value: "individual", label: "A person" },
        ],
        hint: "",
        error: null,
      },
    ],
    actions: [
      {
        verb: "prepare" as const,
        label: "Add the client",
        to: null,
        stepId: "create",
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
  },
  evidence_region: {
    ...envelope,
    id: "region",
    type: "evidence_region",
    what: "Sum insured",
    pageNumber: 2,
    pageWidth: 595,
    pageHeight: 842,
    region: { x: 100, y: 200, width: 180, height: 24 },
    fileUrl: "https://storage.example.invalid/signed",
  },
  timeline: {
    ...envelope,
    id: "tl",
    type: "timeline",
    events: [
      {
        id: "ev1",
        when: "12 AUG",
        text: "Cover requested from CIC",
        tone: "active",
        link: "Request email",
        related: null,
      },
    ],
  },
};

describe("the registry", () => {
  it("has a component for every registered block type, and the sample list covers them all", () => {
    for (const type of SpaceBlockType.options) {
      expect(isRenderableBlock(type), type).toBe(true);
      expect(SAMPLES[type], type).toBeDefined();
    }
    expect(Object.keys(SAMPLES).sort()).toEqual([...SpaceBlockType.options].sort());
  });

  /*
   * §45 rule 9, as a parse. A block type outside the enum has no branch in the discriminated
   * union, so it cannot be constructed — which is what makes "the model cannot invent UI" a
   * property of the contract rather than a promise about prompts.
   */
  it("refuses a block type that is not registered", () => {
    expect(() =>
      parseSpaceBlock({ id: "x", type: "iframe", src: "https://example.test" }),
    ).toThrow();
    expect(isRenderableBlock("iframe")).toBe(false);
    expect(
      spaceFrameBlockSchema.safeParse({ id: "x", type: "html", html: "<b>hi</b>" }).success,
    ).toBe(false);
  });

  /* There is nowhere to put markup, a class name or a script, even on a type that does exist. */
  it("has no slot for markup on a block that does parse", () => {
    const parsed = parseSpaceBlock({
      ...SAMPLES.note,
      html: "<script>alert(1)</script>",
      className: "danger",
    });
    expect(parsed).not.toHaveProperty("html");
    expect(parsed).not.toHaveProperty("className");
  });

  it("renders an honest error for a block the registry does not know, rather than nothing", () => {
    // Deliberately bypassing the contract, which is the only way this state can arise in the wild:
    // a stored block naming a component this build has deprecated.
    const unknown = { id: "z", type: "gauge", ...envelope } as unknown as SpaceFrameBlock;
    render(<SpaceBlockView block={unknown} />);
    expect(screen.getByText(/cannot be shown in this version/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is missing from the record itself/i)).toBeInTheDocument();
  });
});

describe("every registered block renders what it was given", () => {
  it("parses every sample against the contract", () => {
    for (const type of SpaceBlockType.options) {
      expect(() => parseSpaceBlock(SAMPLES[type]), type).not.toThrow();
    }
  });

  it("facts: shows a recorded value, and says so when one is not on file", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.facts} />);
    expect(screen.getByText("CIC General")).toBeInTheDocument();
    // Abstention is a state, not a blank (§36).
    expect(screen.getByText("Not on file")).toBeInTheDocument();
  });

  it("rows: shows the title, the supporting line and the badge", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.rows} />);
    expect(screen.getByText("Confirm cover with CIC")).toBeInTheDocument();
    expect(screen.getByText(/With CIC since 12 Aug/)).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  /* Behind one click, and the answer is the engine's recorded reason. */
  it("rows: answers 'Why is this here?' with the recorded reason", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.rows} />);
    expect(screen.queryByText(/No confirmation is recorded/)).toBeNull();
    const why = screen.getByRole("button", { name: "Why is this here?" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(why);
    expect(
      screen.getByText(/No confirmation is recorded against the request sent on 12 Aug/),
    ).toBeInTheDocument();
    expect(why).toHaveAttribute("aria-expanded", "true");
  });

  it("rows: the title links to the row's own Space", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.rows} />);
    expect(screen.getByRole("link", { name: "Confirm cover with CIC" })).toHaveAttribute(
      "href",
      "/r/00000000-0000-4000-8000-000000000001",
    );
  });

  it("missing: names what is not on file", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.missing} />);
    expect(screen.getByText("No KRA PIN on file.")).toBeInTheDocument();
  });

  it("note: shows its title and text in its tone", async () => {
    const { container } = await renderInRouter(<SpaceBlockView block={SAMPLES.note} />);
    expect(screen.getByText("Observed")).toBeInTheDocument();
    expect(container.querySelector('.sp-note[data-tone="active"]')).toBeTruthy();
  });

  it("compare: keeps an unstated term visible rather than scoring it away", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.compare} />);
    expect(screen.getByText("Excess")).toBeInTheDocument();
    expect(screen.getByText("Not stated")).toBeInTheDocument();
    expect(screen.getByText("Jubilee")).toBeInTheDocument();
  });

  it("table: draws its columns and cells", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.table} />);
    expect(screen.getByText("AMOUNT")).toBeInTheDocument();
    expect(screen.getByText("KES 41,000")).toBeInTheDocument();
  });

  it("calculation: marks the total so it can be checked rather than believed", async () => {
    const { container } = await renderInRouter(<SpaceBlockView block={SAMPLES.calculation} />);
    expect(screen.getByText("KES 100,450")).toBeInTheDocument();
    expect(container.querySelector('.sp-calc-line[data-emphasis="true"]')).toBeTruthy();
  });

  it("document: highlights the lines that were read out of it", async () => {
    const { container } = await renderInRouter(<SpaceBlockView block={SAMPLES.document} />);
    expect(screen.getByText("Motor schedule.pdf")).toBeInTheDocument();
    const hit = container.querySelector(".sp-doc-hit");
    expect(hit?.textContent).toBe("KES 3,400,000");
  });

  /* Nothing here sends anything: the verb is record_send and a person does the sending (rule 13). */
  it("email: shows the draft and never offers to send it itself", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.email} />);
    expect(screen.getByText("Cover confirmation")).toBeInTheDocument();
    expect(screen.getByText(/underwriting@example.test/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send$/ })).toBeNull();
  });

  it("upload: says nothing is saved until a person confirms, and shows a file's own progress", async () => {
    const { container } = await renderInRouter(<SpaceBlockView block={SAMPLES.upload} />);
    expect(screen.getByText(/Nothing is saved until you confirm/)).toBeInTheDocument();
    expect((container.querySelector(".sp-progress-fill") as HTMLElement).style.width).toBe("40%");
    // The server's own limit, stated before a person waits for a transfer that would be refused.
    expect(screen.getByText(/Up to 50 MB/)).toBeInTheDocument();
  });

  it("upload: refuses a file over the server's limit without uploading it", async () => {
    const picked: unknown[] = [];
    const withPicker = {
      ...SAMPLES.upload,
      maxBytes: 10,
      actions: [
        {
          verb: "prepare" as const,
          label: "Choose files",
          to: null,
          stepId: "pick",
          disabledReason: null,
          notPermittedReason: null,
        },
      ],
    };
    await renderInRouter(<SpaceBlockView block={withPicker} onAct={(a) => picked.push(a)} />);
    const input = screen.getByLabelText("Add the insurer's schedule") as HTMLInputElement;
    await userEvent.upload(input, new File(["far too many bytes"], "big.pdf", { type: "application/pdf" }));
    expect(picked).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/larger than this deployment accepts/);
  });

  it("upload: hands a chosen file to the page rather than uploading it itself", async () => {
    const picked: { files?: File[] }[] = [];
    const withPicker = {
      ...SAMPLES.upload,
      actions: [
        {
          verb: "prepare" as const,
          label: "Choose files",
          to: null,
          stepId: "pick",
          disabledReason: null,
          notPermittedReason: null,
        },
      ],
    };
    await renderInRouter(
      <SpaceBlockView block={withPicker} onAct={(a) => picked.push(a as { files?: File[] })} />,
    );
    const input = screen.getByLabelText("Add the insurer's schedule") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "schedule.pdf", { type: "application/pdf" }));
    expect(picked).toHaveLength(1);
    expect(picked[0]?.files?.[0]?.name).toBe("schedule.pdf");
  });

  it("assignment: offers owner and due date, and says what assignment does not do", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.assignment} />);
    expect(screen.getByLabelText("OWNER")).toBeInTheDocument();
    expect(screen.getByLabelText("DUE")).toBeInTheDocument();
    expect(
      screen.getByText(/does not grant data access|cannot change the owner/i),
    ).toBeInTheDocument();
  });

  it("automation builder: says a saved automation starts paused", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.automation_builder} />);
    expect(screen.getByLabelText("NAME")).toBeInTheDocument();
    expect(screen.getByText(/start paused/)).toBeInTheDocument();
  });

  it("approval gate: shows what is being permitted", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.approval_gate} />);
    expect(screen.getByText("Approve this placement")).toBeInTheDocument();
  });

  it("timeline: shows when, what, and the evidence behind it", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.timeline} />);
    expect(screen.getByText("12 AUG")).toBeInTheDocument();
    expect(screen.getByText("Cover requested from CIC")).toBeInTheDocument();
    expect(screen.getByText("Request email")).toBeInTheDocument();
  });
});

describe("the evidence region block", () => {
  it("draws the region at the page's own scale", async () => {
    const { container } = await renderInRouter(<SpaceBlockView block={SAMPLES.evidence_region} />);
    const svg = container.querySelector("svg")!;
    // The page's own coordinates, so the rectangle lands where the extractor said it did.
    expect(svg.getAttribute("viewBox")).toBe("0 0 595 842");
    const mark = svg.querySelectorAll("rect")[1]!;
    expect(mark.getAttribute("x")).toBe("100");
    expect(mark.getAttribute("width")).toBe("180");
  });

  it("opens the file at that page", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.evidence_region} />);
    expect(screen.getByRole("link", { name: /Open the file at this page/ })).toHaveAttribute(
      "href",
      "https://storage.example.invalid/signed#page=2",
    );
  });

  /* A region drawn to the wrong scale is a confident lie about where to look. */
  it("says so when the page's size was never recorded, and keeps the region exact", async () => {
    const { container } = await renderInRouter(
      <SpaceBlockView
        block={{ ...SAMPLES.evidence_region, pageWidth: null, pageHeight: null }}
      />,
    );
    expect(screen.getByText(/drawn against a standard page/)).toBeInTheDocument();
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 595 842");
    expect(container.querySelectorAll("rect")[1]!.getAttribute("x")).toBe("100");
  });
});

describe("the form block", () => {
  it("marks a required field before anything is sent, and sends nothing", async () => {
    const sent: unknown[] = [];
    await renderInRouter(<SpaceBlockView block={SAMPLES.form} onAct={(a) => sent.push(a)} />);
    await userEvent.click(screen.getByRole("button", { name: "Add the client" }));
    expect(sent).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/needed before anything is created/);
  });

  it("hands the typed values to the page rather than creating anything itself", async () => {
    const sent: { values?: Record<string, string> }[] = [];
    await renderInRouter(
      <SpaceBlockView block={SAMPLES.form} onAct={(a) => sent.push(a as { values?: Record<string, string> })} />,
    );
    await userEvent.type(screen.getByLabelText(/WHAT IS THE CLIENT CALLED/), "Tamarind Exporters");
    await userEvent.click(screen.getByRole("button", { name: "Add the client" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.values).toMatchObject({ name: "Tamarind Exporters", kind: "corporate" });
  });

  /* One click is one write, however fast the second click is. */
  it("cannot be submitted twice while a write is in flight", async () => {
    const sent: unknown[] = [];
    await renderInRouter(
      <SpaceBlockView block={{ ...SAMPLES.form, busy: true }} onAct={(a) => sent.push(a)} />,
    );
    const button = screen.getByRole("button", { name: "Working…" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(sent).toEqual([]);
  });

  it("shows the server's own message against the field it belongs to", async () => {
    const withError = {
      ...SAMPLES.form,
      fields: [{ ...SAMPLES.form.fields[0]!, error: "A client with this name is already on file." }],
    };
    await renderInRouter(<SpaceBlockView block={withError} />);
    expect(screen.getByRole("alert")).toHaveTextContent("A client with this name is already on file.");
  });

  it("offers a choice as a real radio group", async () => {
    await renderInRouter(<SpaceBlockView block={SAMPLES.form} />);
    const group = screen.getByRole("radiogroup", { name: /COMPANY OR PERSON/ });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
  });
});

describe("a block's own states", () => {
  it("draws a loading state rather than an empty card", async () => {
    const { container } = await renderInRouter(
      <SpaceBlockView
        block={{ ...SAMPLES.rows, state: "loading", stateNote: "Reading the records." }}
      />,
    );
    expect(container.querySelector('[data-state="loading"]')).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Confirm cover with CIC")).toBeNull();
  });

  it("says why it is empty, in its own words", async () => {
    await renderInRouter(
      <SpaceBlockView
        block={{
          ...SAMPLES.rows,
          rows: [],
          state: "empty",
          stateNote: "No item is with an outside party.",
        }}
      />,
    );
    expect(screen.getByText("No item is with an outside party.")).toBeInTheDocument();
  });

  it("says a part could not be read rather than showing it as empty", async () => {
    await renderInRouter(
      <SpaceBlockView
        block={{
          ...SAMPLES.facts,
          state: "error",
          stateNote: "The policy rows could not be read.",
        }}
      />,
    );
    expect(screen.getByText("The policy rows could not be read.")).toBeInTheDocument();
  });
});

describe("actions", () => {
  const blockedOpen = {
    ...SAMPLES.approval_gate,
    actions: [
      {
        verb: "approve" as const,
        label: "Approve",
        to: null,
        stepId: "approve",
        disabledReason: "The client file is not cleared, so this placement cannot be approved.",
        notPermittedReason: null,
      },
    ],
  };

  /* §34: a blocked action is shown disabled with the guard's own words, never hidden. */
  it("shows a blocked action disabled, with the guard's own reason beside it", async () => {
    await renderInRouter(<SpaceBlockView block={blockedOpen} />);
    const button = screen.getByRole("button", { name: "Approve" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/The client file is not cleared/)).toBeInTheDocument();
  });

  it("shows an action the caller's role does not permit, and says so", async () => {
    await renderInRouter(
      <SpaceBlockView
        block={{
          ...SAMPLES.assignment,
          actions: [
            {
              verb: "assign" as const,
              label: "Save assignment",
              to: null,
              stepId: "assign",
              disabledReason: null,
              notPermittedReason: "Your role can read this work but not change who owns it.",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Save assignment" })).toBeDisabled();
    expect(screen.getByText(/not change who owns it/)).toBeInTheDocument();
  });

  /*
   * A business verb is handed to the page, which goes through the validated action API. A generic
   * presentation component that wrote to the database would put a mutation in fourteen places.
   */
  it("hands a business verb to the page rather than performing it", async () => {
    const seen: string[] = [];
    await renderInRouter(
      <SpaceBlockView
        block={{
          ...SAMPLES.approval_gate,
          actions: [
            {
              verb: "approve" as const,
              label: "Approve",
              to: null,
              stepId: "approve",
              disabledReason: null,
              notPermittedReason: null,
            },
          ],
        }}
        onAct={(a) => seen.push(`${a.verb}:${a.stepId}`)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(seen).toEqual(["approve:approve"]);
  });

  it("renders navigation as a real link, so it is addressable", async () => {
    const withOpen: SpaceFrameBlock = {
      ...SAMPLES.rows,
      rows: [
        {
          ...SAMPLES.rows.rows[0]!,
          actions: [
            {
              verb: "open",
              label: "Open →",
              to: SAMPLES.rows.rows[0]!.related,
              stepId: null,
              disabledReason: null,
              notPermittedReason: null,
            },
          ],
        },
      ],
    };
    await renderInRouter(<SpaceBlockView block={withOpen} />);
    const link = screen.getByRole("link", { name: "Open →" });
    expect(link).toHaveAttribute("href", "/r/00000000-0000-4000-8000-000000000001");
  });

  it("refuses an action that navigates nowhere, and one that acts on no step", () => {
    const base = {
      label: "x",
      to: null,
      stepId: null,
      disabledReason: null,
      notPermittedReason: null,
    };
    expect(
      spaceFrameBlockSchema.safeParse({ ...SAMPLES.note, actions: [{ ...base, verb: "open" }] })
        .success,
    ).toBe(false);
    expect(
      spaceFrameBlockSchema.safeParse({ ...SAMPLES.note, actions: [{ ...base, verb: "approve" }] })
        .success,
    ).toBe(false);
  });
});

describe("evidence", () => {
  it("cites what a fact came from", async () => {
    await renderInRouter(
      <SpaceBlockView
        block={{
          ...SAMPLES.facts,
          facts: [
            {
              key: "SUM INSURED",
              value: "KES 3,400,000",
              missing: false,
              evidence: [
                {
                  label: "Policy schedule",
                  reference: "Motor schedule.pdf, page 2",
                  recordedBy: "Amina Yusuf",
                  recordedAt: null,
                },
              ],
            },
          ],
        }}
      />,
    );
    const item = screen.getByText(/Motor schedule.pdf, page 2/);
    expect(within(item.closest("li")!).getByText(/Policy schedule/)).toBeInTheDocument();
    expect(item.closest("li")?.textContent).toContain("Amina Yusuf");
  });
});
