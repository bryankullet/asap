import { z } from "zod";
import { ActionVerb } from "../actions.js";
import { uuidSchema } from "../api/common.js";
import { SpaceType, spaceEvidenceSchema } from "./plan.js";

/**
 * The Space frame — one contract, one renderer, every screen.
 *
 * The approved prototype has no per-screen layouts. Today, Work, a client, a renewal and a claim
 * are all the same thing: a titled workspace with a status, optional filters, and a column of
 * **typed blocks** drawn from a fixed set. That is the shape below, and it is why Increment 3
 * builds a renderer rather than two pages: a screen that is a block list costs a block list, and
 * Increment 4's remaining routes cost the same.
 *
 * How this relates to `plan.ts`. A `SpacePlan` is what a *recipe or a model* returns: component
 * ids from `component_definitions` with opaque props, validated server-side against the stored
 * JSON Schema. A `SpaceFrame` is what the *renderer* accepts: the same content after validation,
 * in the shapes the blocks actually draw. The plan is the wire format; the frame is the contract
 * at the React boundary. Evidence and the verb list are imported from the plan rather than
 * restated, so there is one of each.
 *
 * Three rules this shape exists to make enforceable (§45 rules 9, 10, 12):
 *
 *  - **Only registered block types render.** `SpaceBlockType` is a closed enum and the union is
 *    discriminated on it. There is no `html`, no `className`, no `component` and no slot for
 *    markup: a model choosing blocks cannot express a `<div>`, let alone a script.
 *  - **Business values come from records, not from prose.** Every block carries its content as
 *    data with its own evidence. A premium figure that came out of a language model is a defect
 *    however right it looks.
 *  - **Status is never authored here.** There is no progress percentage and no approval outcome
 *    in any block. Task, run, cover and money status keep their own slots
 *    (`packages/schema/src/status.ts`) and are derived from columns and steps.
 */

/**
 * What a Space is about.
 *
 * `SpaceType` covers the record Spaces the recipes build. Today and Work are boards rather than
 * records, and they are named here rather than added to that enum so recipe validation is
 * untouched: a board is not something a recipe may produce.
 */
export const SpaceKind = z.union([
  SpaceType,
  z.enum([
    "today",
    "work",
    "activity",
    /*
     * Two record kinds the recipes do not build yet. They are here rather than in `SpaceType` so
     * recipe validation stays exactly as it is — a recipe may not produce them — and they move
     * across when it can.
     */
    "client",
    "work_item",
    /*
     * A plain destination the application already serves — import, email, the composer — rather
     * than a Space about a record. Quick actions point at these, and naming them honestly keeps
     * them out of the tab strip: a route is not something you open a workspace on.
     */
    "route",
  ]),
]);
export type SpaceKind = z.infer<typeof SpaceKind>;

/**
 * Which record a Space is about, and which piece of work on it.
 *
 * The same four parts as a workspace tab's identity (`apps/web/src/shell/workspace-tabs.ts`), and
 * deliberately so: a Space and its tab are the same thing seen twice. One client opened *as a
 * client* and *as the subject of a renewal* is two Spaces, and one policy can carry two
 * endorsements at once — so the record id alone is not an identity.
 */
export const spaceRefSchema = z.object({
  spaceKind: SpaceKind,
  /** The table the record lives in, in the words the product uses: `client`, `policy`, `claim`. */
  recordType: z.string().min(1).max(40),
  /** Null for a board: Today and Work are about the brokerage, not about one record. */
  recordId: uuidSchema.nullable(),
  /** The particular renewal, endorsement or claim on that record, when there is more than one. */
  workflowId: uuidSchema.nullable().default(null),
  /** Where it opens. Always a route the application already serves. */
  path: z.string().min(1).max(300),
  /** What to call it on a tab and in a Related list. Read from a record, never composed. */
  title: z.string().min(1).max(300),
  /** The eyebrow above the title: CLIENT, RENEWAL, CLAIM. */
  label: z.string().min(1).max(40),
});
export type SpaceRef = z.infer<typeof spaceRefSchema>;

/**
 * An action a block offers.
 *
 * `open` navigates and changes nothing, so it carries a destination and no step. Every other verb
 * is a business action and must name the step it applies to — the renderer does not perform it. It
 * calls the handler it was given, which goes through the validated action API. A generic
 * presentation component that wrote to the database would put a mutation in fourteen places.
 */
export const spaceFrameActionSchema = z
  .object({
    verb: ActionVerb,
    label: z.string().min(1).max(120),
    /** Where `open` goes. Null for every other verb. */
    to: spaceRefSchema.nullable().default(null),
    /** The step a business verb applies to. Null only for `open`. */
    stepId: z.string().min(1).nullable().default(null),
    /** Null when available. Otherwise the guard's own words: shown disabled, never hidden (§34). */
    disabledReason: z.string().max(500).nullable().default(null),
    /**
     * Set when the caller's role does not permit it. Permission filtering happens server-side and
     * a block the caller may not see is removed before it reaches the browser (§34); this is for
     * the narrower case where the block is legitimately visible and one action is not.
     */
    notPermittedReason: z.string().max(500).nullable().default(null),
  })
  .refine((a) => (a.verb === "open" ? a.to !== null : a.stepId !== null), {
    message: "open needs a destination; every other verb needs a step",
    path: ["to"],
  });
export type SpaceFrameAction = z.infer<typeof spaceFrameActionSchema>;

/** The tone a badge or a note carries. Semantic and fixed; never re-mapped per screen. */
export const SpaceTone = z.enum(["neutral", "active", "waiting", "attention", "done"]);
export type SpaceTone = z.infer<typeof SpaceTone>;

/** The fourteen block types the prototype draws. Closed: anything else does not render. */
export const SpaceBlockType = z.enum([
  "facts",
  "rows",
  "missing",
  "note",
  "compare",
  "table",
  "calculation",
  "document",
  "email",
  "upload",
  "assignment",
  "automation_builder",
  "approval_gate",
  "timeline",
  /*
   * Added deliberately in Increment 4A, for the creation flows behind "+ New".
   *
   * Seven of them — a client, cover already placed, a renewal, quotation work, a claim, a policy
   * change, an automation — need typed fields with required marking and per-field errors, and no
   * existing block carries any of that: `automation_builder` is text inputs with no types, no
   * validation and no submit contract. Expressing a date of loss as free text would have been the
   * alternative, and that is how a date nobody can validate gets into a claim.
   *
   * It is still not a hole in the registry: the field types are a closed set, there is no slot for
   * markup, and the block cannot perform its own submit — it hands values to the page, which calls
   * the validated creation API.
   */
  "form",
  /*
   * Added in Increment 4A-2, for evidence that has coordinates.
   *
   * A citation you cannot open is not a citation, and "page 2" is not an answer to *where on the
   * page*. The `document` block shows a page's text with the read lines highlighted; this shows
   * the rectangle itself, drawn at the page's own scale. Neither expresses the other.
   */
  "evidence_region",
]);
export type SpaceBlockType = z.infer<typeof SpaceBlockType>;

/**
 * What every block carries, whatever its type.
 *
 * `state` is not decoration. §36 requires every system state to be designed, and a block is the
 * unit that knows: one block can be loading while another has already arrived, and one can be
 * unreadable without taking the Space down with it. `empty` carries its own words because "no
 * rows" and "nothing needs you" are different facts and the second one has to be earned.
 */
const blockEnvelope = {
  /** Stable within the Space, so a block can be keyed and re-rendered in place. */
  id: z.string().min(1).max(80),
  /** The small capitalised label above the block. Null when the block speaks for itself. */
  label: z.string().min(1).max(120).nullable().default(null),
  evidence: z.array(spaceEvidenceSchema).max(10).default([]),
  actions: z.array(spaceFrameActionSchema).max(6).default([]),
  state: z.enum(["ready", "loading", "empty", "error"]).default("ready"),
  /** Why it is empty or unreadable, in plain words. Required when the state is not `ready`. */
  stateNote: z.string().max(300).nullable().default(null),
};

/** A named value with how well it is known. The prototype's facts grid. */
export const spaceFactSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().max(400),
  /**
   * Abstention is a state, not a blank (§36). A fact nobody has recorded says so rather than
   * rendering a confident empty value.
   */
  missing: z.boolean().default(false),
  evidence: z.array(spaceEvidenceSchema).max(4).default([]),
});
export type SpaceFact = z.infer<typeof spaceFactSchema>;

/**
 * One row in a `rows` block: the unit Today and Work are made of.
 *
 * `note` is the supporting line — who it is about, what kind of work, who is holding it, when it
 * is next checked. `why` is the reason the engine recorded, behind one click, because a row that
 * cannot say why it is on the screen is a row a person learns to distrust.
 */
export const spaceRowSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(300),
  note: z.string().max(400).default(""),
  badge: z.string().max(40).nullable().default(null),
  badgeTone: SpaceTone.default("neutral"),
  /** The engine's own words. Never composed by a model, and never invented in React. */
  why: z.string().max(600).nullable().default(null),
  /** The Space this row is about, so Related and the tab strip agree on one identity. */
  related: spaceRefSchema.nullable().default(null),
  /**
   * Where on a page this row's value was read from, when the extractor placed it.
   *
   * Revealed by the row itself, like `why`, rather than by an action: showing a rectangle is an
   * interface reveal and not a business verb, and the verb list stays finite because of it.
   */
  region: z
    .object({
      what: z.string().min(1).max(200),
      pageNumber: z.number().int().min(1),
      pageWidth: z.number().positive().nullable(),
      pageHeight: z.number().positive().nullable(),
      rect: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
      fileUrl: z.string().max(2000).nullable(),
    })
    .nullable()
    .default(null),
  actions: z.array(spaceFrameActionSchema).max(4).default([]),
  evidence: z.array(spaceEvidenceSchema).max(4).default([]),
});
export type SpaceRow = z.infer<typeof spaceRowSchema>;

const cell = z.object({
  value: z.string().max(400),
  tone: SpaceTone.default("neutral"),
});

export const spaceFrameBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...blockEnvelope, type: z.literal("facts"), facts: z.array(spaceFactSchema).max(24) }),
  z.object({ ...blockEnvelope, type: z.literal("rows"), rows: z.array(spaceRowSchema).max(50) }),
  /** What is required and not on file. Never rendered as a confident empty value. */
  z.object({
    ...blockEnvelope,
    type: z.literal("missing"),
    items: z.array(z.object({ text: z.string().min(1).max(400) })).max(12),
  }),
  z.object({
    ...blockEnvelope,
    type: z.literal("note"),
    tone: SpaceTone.default("neutral"),
    title: z.string().min(1).max(200),
    text: z.string().min(1).max(1200),
  }),
  /** Terms side by side. Unclear and missing terms stay visible rather than being scored away. */
  z.object({
    ...blockEnvelope,
    type: z.literal("compare"),
    termHeading: z.string().max(40).default("TERM"),
    columns: z.array(z.object({ label: z.string().min(1).max(120) })).max(5),
    rows: z
      .array(z.object({ label: z.string().min(1).max(160), cells: z.array(cell).max(5) }))
      .max(30),
  }),
  z.object({
    ...blockEnvelope,
    type: z.literal("table"),
    columns: z.array(z.object({ label: z.string().min(1).max(120) })).max(8),
    rows: z.array(z.object({ id: z.string().max(80), cells: z.array(cell).max(8) })).max(50),
  }),
  /** A money calculation, line by line, so the total can be checked rather than believed. */
  z.object({
    ...blockEnvelope,
    type: z.literal("calculation"),
    lines: z
      .array(
        z.object({
          key: z.string().min(1).max(160),
          value: z.string().max(80),
          /** The total, or a subtotal: drawn heavier and on its own ground. */
          emphasis: z.boolean().default(false),
        }),
      )
      .max(24),
  }),
  /**
   * A source document, with the lines that were read out of it highlighted. Every cited figure is
   * tappable to its page and highlight region, so the highlight is part of the contract.
   */
  z.object({
    ...blockEnvelope,
    type: z.literal("document"),
    name: z.string().min(1).max(300),
    documentKind: z.string().min(1).max(120),
    title: z.string().max(300).default(""),
    lines: z
      .array(
        z.object({
          parts: z
            .array(z.object({ text: z.string().max(600), highlighted: z.boolean().default(false) }))
            .max(20),
        }),
      )
      .max(60),
    note: z.string().max(600).default(""),
  }),
  /**
   * A message, drafted or received. `canSend` never means "send it": the verb is `record_send`,
   * and the outside communication happens when a person does it (§45 rule 13).
   */
  z.object({
    ...blockEnvelope,
    type: z.literal("email"),
    headLabel: z.string().min(1).max(60),
    headMeta: z.string().max(160).default(""),
    tone: SpaceTone.default("neutral"),
    to: z.string().max(300).default(""),
    subject: z.string().max(400).default(""),
    body: z.string().max(8000).default(""),
    attachments: z.array(z.object({ name: z.string().min(1).max(300) })).max(10),
  }),
  /** Files are read from the device. Nothing is saved until a person confirms. */
  z.object({
    ...blockEnvelope,
    type: z.literal("upload"),
    prompt: z.string().min(1).max(300),
    multiple: z.boolean().default(true),
    /**
     * What this deployment accepts, from the server's own limits — never a guess.
     *
     * `accept` narrows the picker; `maxBytes` lets the screen refuse a file before a person waits
     * for an upload that the API would reject at the end. Both are stated, so a file the extractor
     * cannot read is still filed and simply never described as read.
     */
    accept: z.string().max(400).default(""),
    maxBytes: z.number().int().positive().nullable().default(null),
    /** True while bytes are moving: the picker is replaced by progress and a way to stop. */
    busy: z.boolean().default(false),
    progress: z
      .array(
        z.object({
          name: z.string().min(1).max(300),
          /** The words shown beside the bar: "reading", "saved", "could not be read". */
          state: z.string().min(1).max(80),
          /** 0 to 100. A file's own progress, never a Space's and never a confidence. */
          percent: z.number().min(0).max(100),
          tone: SpaceTone.default("active"),
        }),
      )
      .max(20),
  }),
  /** Owner and due date. Assignment changes owner; it never grants data access. */
  z.object({
    ...blockEnvelope,
    type: z.literal("assignment"),
    ownerId: uuidSchema.nullable(),
    dueAt: z.string().nullable(),
    people: z.array(z.object({ id: uuidSchema, name: z.string().min(1).max(200) })).max(100),
    /** What the caller's role permits here, in plain words. Never a bare "denied". */
    permissionNote: z.string().max(400).default(""),
  }),
  /** Saved automations start paused, and test mode writes nothing. */
  z.object({
    ...blockEnvelope,
    type: z.literal("automation_builder"),
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          label: z.string().min(1).max(120),
          value: z.string().max(600).default(""),
          placeholder: z.string().max(200).default(""),
        }),
      )
      .max(12),
  }),
  /**
   * The one place an approval is offered. The payload is frozen elsewhere; this block shows what
   * is being permitted and, when it is blocked, the guard's own reason rather than a grey button.
   */
  z.object({
    ...blockEnvelope,
    type: z.literal("approval_gate"),
    heading: z.string().min(1).max(200),
    detail: z.string().max(800).default(""),
    blockedNote: z.string().max(600).nullable().default(null),
  }),
  /**
   * A typed form. The one block that collects rather than shows.
   *
   * Validation is declared here and enforced twice: the browser marks a required field before a
   * request goes out, and the API validates every value again on arrival. The first is a courtesy;
   * the second is the one that counts, and this block never assumes the first replaces it.
   */
  z.object({
    ...blockEnvelope,
    type: z.literal("form"),
    fields: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          label: z.string().min(1).max(120),
          /** A closed set. There is no "html" and no "custom". */
          kind: z.enum(["text", "textarea", "date", "select", "choice"]),
          value: z.string().max(4000).default(""),
          placeholder: z.string().max(200).default(""),
          required: z.boolean().default(false),
          /** For `select` and `choice`. Empty for every other kind. */
          options: z
            .array(z.object({ value: z.string().max(120), label: z.string().min(1).max(160) }))
            .max(40)
            .default([]),
          /** One line under the field, saying what it is for. Never a validation message. */
          hint: z.string().max(300).default(""),
          /** What is wrong with what was typed, from the server or from the required check. */
          error: z.string().max(300).nullable().default(null),
        }),
      )
      .max(20),
    /** The words on the button that submits it. */
    submitLabel: z.string().min(1).max(80),
    /** True while the request is in flight: the button disables itself, so one click is one write. */
    busy: z.boolean().default(false),
  }),
  /**
   * Where on the page a value was read from.
   *
   * Drawn at the page's own scale when the extractor recorded the page's size, and against a
   * standard page with that assumption stated when it did not. The rectangle is always exactly
   * what was recorded: a region is never widened to look tidy, and never invented for a value
   * that has no placement.
   */
  z.object({
    ...blockEnvelope,
    type: z.literal("evidence_region"),
    /** What was read there, in the words on the row it belongs to. */
    what: z.string().min(1).max(200),
    pageNumber: z.number().int().min(1),
    /** The page's own size, when the extractor recorded it. Null means the drawing is an estimate. */
    pageWidth: z.number().positive().nullable(),
    pageHeight: z.number().positive().nullable(),
    region: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    /** A link that opens the file at that page. Null when no signed link is available. */
    fileUrl: z.string().max(2000).nullable().default(null),
  }),
  z.object({
    ...blockEnvelope,
    type: z.literal("timeline"),
    events: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          when: z.string().min(1).max(80),
          text: z.string().min(1).max(400),
          tone: SpaceTone.default("neutral"),
          /** The document, message or calculation behind the event. Openable, or it is not evidence. */
          link: z.string().max(200).nullable().default(null),
          related: spaceRefSchema.nullable().default(null),
        }),
      )
      .max(60),
  }),
]);
export type SpaceFrameBlock = z.infer<typeof spaceFrameBlockSchema>;

/** A filter pill. `to` is a route, so a filter changes what the server returns, not what is hidden. */
export const spaceFilterSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  active: z.boolean().default(false),
  /** Null while it is loading its own count. Never a guess. */
  count: z.number().int().min(0).nullable().default(null),
  to: z.string().min(1).max(300),
});
export type SpaceFilter = z.infer<typeof spaceFilterSchema>;

/**
 * A whole Space, as the renderer receives it.
 *
 * `state` is the Space's own: `loading` before anything arrived, `empty` when the brokerage has
 * nothing to show, `error` when the read failed. `degraded` is the case in between and the one
 * most screens get wrong — part of the answer could not be read, so the Space renders what it has
 * and says what it could not (§36 partial success), rather than failing whole or passing a gap off
 * as an empty result.
 */
export const spaceFrameSchema = z.object({
  self: spaceRefSchema,
  /** The eyebrow, the heading and the pill, in the prototype's three positions. */
  title: z.string().min(1).max(300),
  status: z.object({
    label: z.string().min(1).max(60),
    tone: SpaceTone.default("neutral"),
  }),
  /** One line of context under the title, when the title alone is not enough. */
  context: z.string().max(400).nullable().default(null),
  filters: z.array(spaceFilterSchema).max(8).default([]),
  blocks: z.array(spaceFrameBlockSchema).max(24),
  /** Where else this record is seen. The tab strip and Recent read the same identities. */
  related: z.array(spaceRefSchema).max(20).default([]),
  /** Actions on the Space as a whole, rather than on one block. */
  actions: z.array(spaceFrameActionSchema).max(8).default([]),
  evidence: z.array(spaceEvidenceSchema).max(10).default([]),
  /** What the caller's role allows. Resolved server-side from the session (§45 rule 5). */
  permission: z
    .object({
      canAssign: z.boolean().default(false),
      canApprove: z.boolean().default(false),
      /** Plain words for what is not permitted, shown where it matters rather than as a banner. */
      note: z.string().max(400).nullable().default(null),
    })
    .default({ canAssign: false, canApprove: false, note: null }),
  state: z.enum(["ready", "loading", "empty", "error"]).default("ready"),
  /** Required when the state is not `ready`: what a person is looking at, and what to do about it. */
  emptyState: z
    .object({
      heading: z.string().min(1).max(200),
      body: z.string().max(600).default(""),
      actions: z.array(spaceFrameActionSchema).max(4).default([]),
    })
    .nullable()
    .default(null),
  degraded: z
    .array(z.object({ what: z.string().min(1).max(200), because: z.string().min(1).max(300) }))
    .max(10)
    .default([]),
});
export type SpaceFrame = z.infer<typeof spaceFrameSchema>;

/**
 * Parse a block, rejecting anything not in the registry.
 *
 * This is the boundary §45 rule 9 describes: a component not in the registry does not render. The
 * discriminated union does the work — an unknown `type` has no branch, so it cannot parse, and a
 * block carrying markup has nowhere to put it.
 */
export function parseSpaceBlock(value: unknown): SpaceFrameBlock {
  return spaceFrameBlockSchema.parse(value);
}

/** True when this is a block type the renderer knows how to draw. */
export function isRegisteredBlockType(value: unknown): value is SpaceBlockType {
  return SpaceBlockType.safeParse(value).success;
}
