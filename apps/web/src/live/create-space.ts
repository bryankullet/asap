import type {
  CreateClientResponse,
  CreatePolicyResponse,
  CreateWorkItemResponse,
  SpaceFrame,
  SpaceFrameBlock,
  SpaceRef,
  SpaceRow,
} from "@asap/schema";

/**
 * The creation Spaces behind "+ New".
 *
 * Seven of them, one per thing a person can start, each a `form` block over the endpoint that
 * already exists. Every field, every `required` and every piece of copy is the one the old
 * six-form page carried — moved, not rewritten, because the wording was chosen once and asking
 * "what did the client say?" is not the same question as "what is the claim about?".
 *
 * What the old page could not do, and these can: each is its own Space with its own identity, so
 * starting a claim and starting a renewal are two tabs, the address is shareable, and the sheet
 * that opened it left the screen behind it exactly where it was.
 */

/**
 * The creation flows that have an endpoint behind them.
 *
 * Quotation work is deliberately absent: `POST /work-items` accepts `renewal`, `claim` and
 * `endorsement` and nothing else, so a "start quotation work" form would submit to a kind the API
 * refuses. The sheet says so instead, and Increment 4B — which is where quotes are built — adds it.
 */
export type CreateKind = "client" | "policy" | "renewal" | "claim" | "endorsement";

type Field = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "date" | "select" | "choice";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  value?: string;
};

/** The client a piece of work belongs to. Asked the same way everywhere, because it is one question. */
const CLIENT_FIELD: Field = {
  name: "clientName",
  label: "WHICH CLIENT?",
  kind: "text",
  required: true,
  placeholder: "The client's name as you would say it",
  hint: "If two clients share a name, ASAP asks which one rather than guessing.",
};

const KINDS: Record<
  CreateKind,
  { label: string; title: string; hint: string; submit: string; fields: Field[] }
> = {
  client: {
    label: "CLIENT",
    title: "Add a client",
    hint: "A client carries a file, duplicates and a compliance state. ASAP reviews for duplicates before anything is created.",
    submit: "Add the client",
    fields: [
      {
        name: "clientName",
        label: "WHAT IS THE CLIENT CALLED?",
        kind: "text",
        required: true,
        placeholder: "The client's name as you would say it",
      },
      {
        name: "clientKind",
        label: "A COMPANY OR A PERSON?",
        kind: "choice",
        required: true,
        value: "corporate",
        options: [
          { value: "corporate", label: "A company" },
          { value: "individual", label: "A person" },
        ],
      },
    ],
  },
  policy: {
    label: "POLICY",
    title: "Record existing cover",
    hint: "Cover you already place, so renewals and claims have something to hang on. This records what is already true; it does not arrange anything.",
    submit: "Record the cover",
    fields: [
      CLIENT_FIELD,
      {
        name: "insurerName",
        label: "WHICH INSURER CARRIES IT?",
        kind: "text",
        required: true,
        placeholder: "Jubilee",
        hint: "New to your book? Naming it here is how it is added.",
      },
      {
        name: "classOfBusiness",
        label: "WHAT CLASS OF BUSINESS?",
        kind: "text",
        required: true,
        placeholder: "Motor commercial",
      },
      {
        name: "policyNumber",
        label: "POLICY NUMBER (OPTIONAL)",
        kind: "text",
        placeholder: "Leave it empty until the insurer issues one",
      },
      { name: "periodStart", label: "THE PERIOD OF COVER: FROM", kind: "date", required: true },
      { name: "periodEnd", label: "TO", kind: "date", required: true },
    ],
  },
  renewal: {
    label: "RENEWAL",
    title: "Start a renewal",
    hint: "From cover that is ending. ASAP builds the new year alongside the old one — nothing from the expiring year is overwritten.",
    submit: "Start the renewal",
    fields: [
      CLIENT_FIELD,
      {
        name: "insurers",
        label: "WHICH INSURERS SHOULD WE ASK? (OPTIONAL)",
        kind: "text",
        placeholder: "Jubilee, APA",
        hint: "Separate them with commas. You can add more later, and the incumbent is included by default.",
      },
    ],
  },
  claim: {
    label: "CLAIM",
    title: "Register a claim",
    hint: "What happened and when. The cover check comes next, against the policy that was live on that date — ASAP never decides whether a claim is covered.",
    submit: "Register the claim",
    fields: [
      CLIENT_FIELD,
      { name: "incidentOn", label: "WHEN DID IT HAPPEN?", kind: "date", required: true },
      {
        name: "incidentSummary",
        label: "WHAT DID THE CLIENT SAY?",
        kind: "textarea",
        required: true,
        placeholder: "In their words, not a classification",
      },
    ],
  },
  endorsement: {
    label: "POLICY CHANGE",
    title: "Start a policy change",
    hint: "A mid-term change. A request is not cover: nothing changes on the policy until the insurer confirms it.",
    submit: "Start the change",
    fields: [
      CLIENT_FIELD,
      {
        name: "requestText",
        label: "WHAT ARE THEY ASKING FOR?",
        kind: "textarea",
        required: true,
        placeholder: "Add KDN 482Q to the fleet from 1 October",
      },
      { name: "effectiveOn", label: "FROM WHEN? (OPTIONAL)", kind: "date" },
    ],
  },
};

/** Every creation kind, for the router and the tests. */
export const CREATE_KINDS = Object.keys(KINDS) as CreateKind[];

export function createSpaceTitle(kind: CreateKind): string {
  return KINDS[kind].title;
}

/**
 * The Space for one creation flow.
 *
 * `outcome` is whatever the server last said. None of these outcomes is a failure: a name matching
 * two clients is a question, and a name matching none is a different piece of work.
 */
export function createSpace(
  kind: CreateKind,
  state: {
    busy: boolean;
    error: string | null;
    outcome: CreateClientResponse | CreatePolicyResponse | CreateWorkItemResponse | null;
  },
): SpaceFrame {
  const def = KINDS[kind];
  const self: SpaceRef = {
    spaceKind: "route",
    recordType: "creation",
    recordId: null,
    workflowId: null,
    path: `/new/${kind}`,
    title: def.title,
    label: def.label,
  };

  const form: SpaceFrameBlock = {
    id: "form",
    type: "form",
    label: null,
    submitLabel: def.submit,
    busy: state.busy,
    fields: def.fields.map((f) => ({
      name: f.name,
      label: f.label,
      kind: f.kind,
      value: f.value ?? "",
      placeholder: f.placeholder ?? "",
      required: f.required ?? false,
      options: f.options ?? [],
      hint: f.hint ?? "",
      error: null,
    })),
    evidence: [],
    actions: [
      {
        verb: "prepare",
        label: def.submit,
        to: null,
        stepId: "create",
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
    state: "ready",
    stateNote: null,
  };

  const blocks: SpaceFrameBlock[] = [form, ...outcomeBlocks(state.outcome)];

  if (state.error !== null) {
    blocks.push({
      id: "error",
      type: "note",
      label: null,
      tone: "attention",
      title: "Nothing was created",
      text: state.error,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  return {
    self,
    title: def.title,
    context: def.hint,
    status: { label: "Nothing created yet", tone: "neutral" },
    filters: [],
    blocks,
    related: [],
    actions: [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    state: "ready",
    emptyState: null,
    degraded: [],
  };
}

/**
 * What the server said, when it did not simply create something.
 *
 * Each of these is a real answer rather than an error, and each is the wording the old page used:
 * a name that matches two clients is a question a person answers, and a name that matches none is
 * a different piece of work that has to happen first.
 */
function outcomeBlocks(
  outcome: CreateClientResponse | CreatePolicyResponse | CreateWorkItemResponse | null,
): SpaceFrameBlock[] {
  if (outcome === null) return [];

  if (outcome.outcome === "possible_duplicates") {
    return [
      candidates(
        "possible-duplicates",
        "ALREADY ON FILE?",
        outcome.candidates.map((c) => ({
          id: c.id,
          title: c.name,
          note: c.kind === "corporate" ? "Company" : "Person",
          /* Choosing one opens it. Creating anyway is the explicit second action below. */
          action: { label: "Open this one", path: `/files/${c.id}` },
        })),
      ),
      {
        id: "create-anyway",
        type: "approval_gate",
        label: null,
        heading: "None of these is the same client",
        detail:
          "Creating a second client with a similar name is sometimes right — two companies do share names. It is recorded as a deliberate choice, with what was shown to you at the time.",
        blockedNote: null,
        evidence: [],
        actions: [
          {
            verb: "prepare",
            label: "Create it anyway",
            to: null,
            stepId: "confirm-new",
            disabledReason: null,
            notPermittedReason: null,
          },
        ],
        state: "ready",
        stateNote: null,
      },
    ];
  }

  if (outcome.outcome === "ambiguous") {
    return [
      candidates(
        "which-client",
        `WHICH ${outcome.name.toUpperCase()}?`,
        outcome.candidates.map((c) => ({
          id: c.id,
          title: c.name,
          note: c.kind === "corporate" ? "Company" : "Person",
          action: { label: "This one", stepId: `choose:${c.id}` },
        })),
      ),
    ];
  }

  if (outcome.outcome === "no_client") {
    return [
      note(
        "no-client",
        `No client on file called “${outcome.name}”`,
        "ASAP does not create clients from this form — a client carries a file, duplicates and a compliance state. Add it where those are reviewed, then start this again.",
      ),
    ];
  }

  if (outcome.outcome === "ambiguous_policy") {
    return [
      candidates(
        "which-policy",
        "WHICH POLICY IS THIS CHANGE TO?",
        outcome.candidates.map((c) => ({ id: c.id, title: c.label, note: "Policy" })),
      ),
      note(
        "open-the-policy",
        "Start it on the policy itself",
        "Opening the policy and starting the change there is how it is recorded against the right one.",
      ),
    ];
  }

  if (outcome.outcome === "no_policy") {
    return [
      note(
        "no-policy",
        "No policy on file for that client",
        "A change is a change to something. Record the cover first — nothing has been created here.",
      ),
    ];
  }

  return [];
}

function candidates(
  id: string,
  label: string,
  rows: { id: string; title: string; note: string; action?: { label: string; path?: string; stepId?: string } }[],
): SpaceFrameBlock {
  return {
    id,
    type: "rows",
    label,
    rows: rows.map(
      (r): SpaceRow => ({
        id: r.id,
        title: r.title,
        note: r.note,
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        actions:
          r.action === undefined
            ? []
            : [
                r.action.path !== undefined
                  ? {
                      verb: "open" as const,
                      label: r.action.label,
                      to: {
                        spaceKind: "client" as const,
                        recordType: "client",
                        recordId: r.id,
                        workflowId: null,
                        path: r.action.path,
                        title: r.title,
                        label: "CLIENT",
                      },
                      stepId: null,
                      disabledReason: null,
                      notPermittedReason: null,
                    }
                  : {
                      verb: "prepare" as const,
                      label: r.action.label,
                      to: null,
                      stepId: r.action.stepId ?? "choose",
                      disabledReason: null,
                      notPermittedReason: null,
                    },
              ],
        evidence: [],
      }),
    ),
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

function note(id: string, title: string, text: string): SpaceFrameBlock {
  return {
    id,
    type: "note",
    label: null,
    tone: "waiting",
    title,
    text,
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}
