import type {
  Onboarding,
  SpaceFrame,
  SpaceFrameAction,
  SpaceFrameBlock,
  SpaceRef,
  SpaceTone,
} from "@asap/schema";

/**
 * A person's first day, as one Space.
 *
 * Four steps, and each is one screen with one thing on it. What it is not is a settings wizard:
 * nobody arriving at a new job wants to be asked about currencies and time zones and retention
 * periods before they can see anything. The company step asks for a name and where the brokerage
 * is; everything else has a sensible answer already and can be changed later.
 *
 * Two rules the steps hold:
 *
 *  - **Nothing claims to have happened that has not.** What the progress lines say is read from
 *    the brokerage's own counts, not from which step was marked done, and a deployment with no
 *    Google credentials says so rather than offering a connection that cannot work.
 *  - **Skip is an answer.** It is a recorded choice, not a way of navigating past a screen, and
 *    the step says so before somebody presses it.
 */

const COUNTRIES: [string, string][] = [
  ["KE", "Kenya"],
  ["UG", "Uganda"],
  ["TZ", "Tanzania"],
  ["RW", "Rwanda"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["GB", "United Kingdom"],
];
const CURRENCIES = ["KES", "UGX", "TZS", "RWF", "ZAR", "NGN", "GHS", "USD", "GBP", "EUR"];
const TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Dar_es_Salaam",
  "Africa/Kigali",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Accra",
  "Europe/London",
  "UTC",
];

const TITLES: Record<number, string> = {
  1: "Welcome to ASAP",
  2: "Put some records in",
  3: "Connect your email",
  4: "You are set up",
};

const CONTEXT: Record<number, string> = {
  1: "Four short steps. You can change any of it later, and you can skip the middle two.",
  2: "ASAP works from your own records. Add some now, or skip and add them whenever you like.",
  3: "Connecting your mailbox lets ASAP see the conversations behind the work. It only reads.",
  4: "That is everything. Today shows what needs a person; Ask ASAP is at the foot of every screen.",
};

export function onboardingSpace(
  state: Onboarding | undefined,
  ui: {
    loading: boolean;
    error: string | null;
    busy: boolean;
    /** What the upload is doing right now, when one is going. */
    upload: { name: string; sent: number; total: number } | null;
    uploaded: string | null;
    uploadError: string | null;
  },
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "route",
    recordType: "onboarding",
    recordId: null,
    workflowId: null,
    path: "/onboarding",
    title: "Getting started",
    label: "GETTING STARTED",
  };

  if (ui.error !== null) {
    return frame(self, 1, {
      status: { label: "Could not read", tone: "attention" },
      blocks: [note("error", "attention", "We could not read your setup", ui.error)],
      state: "error",
    });
  }
  if (ui.loading || !state) {
    return frame(self, 1, {
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
    });
  }

  /*
   * Already done. Coming back is for looking at what is set up, not for being asked again — so
   * this is a summary with a deliberate way back in, and opening it writes nothing.
   */
  if (state.completedAt !== null) {
    return frame(self, 4, {
      status: { label: "Set up", tone: "done" },
      blocks: [
        note(
          "done",
          "done",
          "Your setup is done",
          "Nothing here needs doing again. You can step back through it if you want to change something.",
        ),
        summary(state),
        {
          id: "restart",
          type: "rows",
          label: null,
          rows: [
            {
              id: "restart",
              title: "Go through setup again",
              note: "Nothing is undone or created by looking: you are taken back to the first step.",
              badge: null,
              badgeTone: "neutral",
              why: null,
              related: null,
              region: null,
              actions: [step("Start again", 1, ui.busy), route("Open Today", "/today")],
              evidence: [],
            },
          ],
          evidence: [],
          actions: [],
          state: "ready",
          stateNote: null,
        },
      ],
      state: "ready",
    });
  }

  const step1 = state.company === null || (state.company.canEdit && state.company.createdByYou);

  switch (state.step) {
    case 1:
      return frame(self, 1, {
        status: { label: "Step 1 of 4", tone: "active" },
        blocks: step1 ? companyForm(state, ui.busy) : companyAsItStands(state, ui.busy),
        state: "ready",
      });
    case 2:
      return frame(self, 2, {
        status: { label: "Step 2 of 4", tone: "active" },
        blocks: recordsStep(state, ui),
        state: "ready",
      });
    case 3:
      return frame(self, 3, {
        status: { label: "Step 3 of 4", tone: "active" },
        blocks: mailboxStep(state, ui.busy),
        state: "ready",
      });
    default:
      return frame(self, 4, {
        status: { label: "Step 4 of 4", tone: "active" },
        blocks: [
          note(
            "finish-intro",
            "active",
            "That is the setup done",
            "Finishing opens Today. Everything you skipped is still there whenever you want it.",
          ),
          summary(state),
          {
            id: "finish",
            type: "approval_gate",
            label: null,
            heading: "Finish setting up",
            detail: "This records that you are set up. Pressing it twice finishes once.",
            blockedNote: null,
            evidence: [],
            actions: [
              {
                verb: "complete",
                label: "Finish and open Today",
                to: null,
                stepId: "finish",
                disabledReason: ui.busy ? "Finishing…" : null,
                notPermittedReason: null,
              },
              back(3, ui.busy),
            ],
            state: "ready",
            stateNote: null,
          },
        ],
        state: "ready",
      });
  }
}

/* ---- Step one: the brokerage ---------------------------------------------------------------- */

/** Asking, for whoever is creating it. Four fields, because four is what a workspace needs. */
function companyForm(state: Onboarding, busy: boolean): SpaceFrameBlock[] {
  const existing = state.company;
  return [
    note(
      "welcome",
      "active",
      "Welcome to ASAP",
      "This sets up a private workspace for your brokerage. Nothing in it is shared with anyone else.",
    ),
    {
      id: "company",
      type: "form",
      label: "YOUR BROKERAGE",
      fields: [
        {
          name: "name",
          label: "What is the brokerage called?",
          kind: "text",
          value: existing?.name ?? "",
          placeholder: "",
          required: true,
          options: [],
          hint: "The name your clients know you by.",
          error: null,
        },
        {
          name: "country",
          label: "Where do you work?",
          kind: "select",
          value: existing?.country ?? "KE",
          placeholder: "",
          required: true,
          options: COUNTRIES.map(([value, label]) => ({ value, label })),
          hint: "",
          error: null,
        },
        {
          name: "currency",
          label: "What do you quote in?",
          kind: "select",
          value: existing?.currency ?? "KES",
          placeholder: "",
          required: true,
          options: CURRENCIES.map((c) => ({ value: c, label: c })),
          hint: "",
          error: null,
        },
        {
          name: "timezone",
          label: "What time is it where you are?",
          kind: "select",
          value: existing?.timezone ?? "Africa/Nairobi",
          placeholder: "",
          required: true,
          options: TIMEZONES.map((t) => ({ value: t, label: t })),
          hint: "Used for renewal dates and deadlines.",
          error: null,
        },
      ],
      submitLabel: existing === null ? "Create the workspace" : "Save and continue",
      busy,
      evidence: [],
      actions: [
        {
          verb: "prepare",
          label: existing === null ? "Create the workspace" : "Save and continue",
          to: null,
          stepId: "company",
          disabledReason: null,
          notPermittedReason: null,
        },
      ],
      state: "ready",
      stateNote: null,
    },
  ];
}

/**
 * Showing, for whoever joined one.
 *
 * Somebody joining an existing brokerage is not asked to describe it, and has no control here
 * that could overwrite it — which is the point, not an omission.
 */
function companyAsItStands(state: Onboarding, busy: boolean): SpaceFrameBlock[] {
  const company = state.company!;
  return [
    note(
      "welcome",
      "active",
      `Welcome to ${company.name}`,
      "Your colleagues have already set this workspace up. Two short steps and you are in.",
    ),
    facts("company", "YOUR BROKERAGE", [
      ["Brokerage", company.name],
      ["Country", COUNTRIES.find(([code]) => code === company.country)?.[1] ?? company.country],
      ["Currency", company.currency],
      ["Time zone", company.timezone],
    ]),
    note(
      "who-edits",
      "neutral",
      "These are the brokerage's own details",
      company.canEdit
        ? "You can change them later in settings. They are not part of your own setup."
        : "Only an administrator can change them, and nothing you do here affects them.",
    ),
    {
      id: "continue",
      type: "rows",
      label: null,
      rows: [
        {
          id: "continue",
          title: "Carry on",
          note: "",
          badge: null,
          badgeTone: "neutral",
          why: null,
          related: null,
          region: null,
          actions: [step("Continue", 2, busy)],
          evidence: [],
        },
      ],
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    },
  ];
}

/* ---- Step two: records ----------------------------------------------------------------------- */

function recordsStep(
  state: Onboarding,
  ui: {
    busy: boolean;
    upload: { name: string; sent: number; total: number } | null;
    uploaded: string | null;
    uploadError: string | null;
  },
): SpaceFrameBlock[] {
  const blocks: SpaceFrameBlock[] = [
    note(
      "records",
      "active",
      "Put some records in",
      "ASAP reads what you give it and proposes what it found. Nothing it proposes counts until you accept it.",
    ),
  ];

  if (ui.uploadError !== null) {
    blocks.push(note("upload-error", "attention", "Nothing was filed", ui.uploadError));
  }
  if (ui.uploaded !== null) {
    blocks.push(note("uploaded", "done", "On file", ui.uploaded));
  }

  blocks.push({
    id: "upload",
    type: "upload",
    label: "A FILE YOU ALREADY HAVE",
    prompt: "Choose a file",
    multiple: false,
    accept: "",
    maxBytes: null,
    busy: ui.busy,
    progress:
      ui.upload === null
        ? []
        : [
            {
              name: ui.upload.name,
              state:
                ui.upload.total === 0
                  ? "Uploading — the transport is not reporting a size"
                  : `Uploading — ${Math.floor((ui.upload.sent / ui.upload.total) * 100)}% of ${Math.max(1, Math.round(ui.upload.total / 1024))}KB sent`,
              percent: ui.upload.total === 0 ? 0 : (ui.upload.sent / ui.upload.total) * 100,
              tone: "active",
            },
          ],
    evidence: [],
    /* The picker itself. Without this action the block has nothing to open a file dialog with. */
    actions: [
      {
        verb: "prepare",
        label: "Choose a file",
        to: null,
        stepId: "pick",
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
    state: "ready",
    stateNote: null,
  });

  blocks.push({
    id: "choices",
    type: "rows",
    label: "OR",
    rows: [
      {
        id: "import",
        title: "Import a spreadsheet",
        note: "Your client book, as a CSV or an Excel file. You see what will happen before anything is written.",
        badge: state.progress.imports > 0 ? "Done once already" : null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [
          {
            verb: "prepare",
            label: "Import a spreadsheet",
            to: null,
            stepId: "records:import",
            disabledReason: ui.busy ? "One moment…" : null,
            notPermittedReason: null,
          },
        ],
        evidence: [],
      },
      {
        id: "skip",
        title: "Skip for now",
        note: "Recorded as a decision, so nothing asks you again. You can add records whenever you like.",
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [
          {
            verb: "prepare",
            label: "Skip for now",
            to: null,
            stepId: "records:skip",
            disabledReason: ui.busy ? "One moment…" : null,
            notPermittedReason: null,
          },
        ],
        evidence: [],
      },
    ],
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  });

  if (state.progress.documents > 0 || state.progress.clients > 0) {
    blocks.push(
      note(
        "already",
        "done",
        "Already here",
        `${plural(state.progress.documents, "document")} and ${plural(state.progress.clients, "client")} on file.`,
      ),
    );
  }

  blocks.push(continueRow("Continue", 3, ui.busy, 1));
  return blocks;
}

/* ---- Step three: the mailbox ----------------------------------------------------------------- */

function mailboxStep(state: Onboarding, busy: boolean): SpaceFrameBlock[] {
  const blocks: SpaceFrameBlock[] = [
    note(
      "mailbox",
      "active",
      "Connect your email",
      "ASAP reads the conversations behind the work, so a renewal knows what the insurer said. It never sends anything.",
    ),
  ];

  if (state.progress.mailboxConnected) {
    blocks.push(
      note(
        "connected",
        "done",
        "Your mailbox is connected",
        "ASAP will read it in small passes. You can see what it has read on the Connections page.",
      ),
    );
    blocks.push(continueRow("Continue", 4, busy, 2));
    return blocks;
  }

  blocks.push({
    id: "gmail",
    type: "rows",
    label: null,
    rows: [
      {
        id: "connect",
        title: "Connect Gmail",
        note: state.gmailConfigured
          ? "Google asks you to approve it. ASAP asks only for permission to read."
          : "Gmail connection is not configured.",
        badge: state.gmailConfigured ? null : "Not available here",
        badgeTone: state.gmailConfigured ? "neutral" : "waiting",
        why: null,
        related: null,
        region: null,
        actions: [
          {
            verb: "prepare",
            label: "Connect Gmail",
            to: null,
            stepId: "mailbox:connect",
            /*
             * Shown disabled with the reason rather than hidden (§34), and never as a connection
             * that appears to work. A deployment without Google credentials cannot connect one,
             * and saying so is the only honest thing on offer.
             */
            disabledReason: state.gmailConfigured
              ? busy
                ? "One moment…"
                : null
              : (state.gmailUnavailableReason ?? "Gmail connection is not configured."),
            notPermittedReason: null,
          },
        ],
        evidence: [],
      },
      {
        id: "skip",
        title: "Skip for now",
        note: "Recorded as a decision. You can connect a mailbox from Connections at any time.",
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [
          {
            verb: "prepare",
            label: "Skip for now",
            to: null,
            stepId: "mailbox:skip",
            disabledReason: busy ? "One moment…" : null,
            notPermittedReason: null,
          },
        ],
        evidence: [],
      },
    ],
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  });

  blocks.push(continueRow("Continue", 4, busy, 2));
  return blocks;
}

/* ---- Shared ---------------------------------------------------------------------------------- */

/** What is actually set up, from the brokerage's own counts. Never from a step being marked done. */
function summary(state: Onboarding): SpaceFrameBlock {
  return facts("summary", "WHAT IS SET UP", [
    ["Brokerage", state.company?.name ?? ""],
    ["Documents on file", String(state.progress.documents)],
    ["Clients on file", String(state.progress.clients)],
    ["Imports run", String(state.progress.imports)],
    [
      "Mailbox",
      state.progress.mailboxConnected
        ? "Connected"
        : state.mailboxChoice === "skip"
          ? "Skipped for now"
          : "",
    ],
  ]);
}

function frame(
  self: SpaceRef,
  step: number,
  over: {
    status: { label: string; tone: SpaceTone };
    blocks: SpaceFrameBlock[];
    state: SpaceFrame["state"];
    actions?: SpaceFrameAction[];
  },
): SpaceFrame {
  return {
    self,
    title: TITLES[step] ?? "Getting started",
    context: CONTEXT[step] ?? "",
    filters: [],
    related: [],
    actions: over.actions ?? [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
    status: over.status,
    blocks: over.blocks,
    state: over.state,
    emptyState: null,
  };
}

/**
 * Moving on, and moving back.
 *
 * Both live in a block rather than on the frame, because the frame's own actions are the shell's
 * quick actions and are not drawn inside a Space — a Back that renders nowhere is not a Back.
 */
function continueRow(
  label: string,
  to: number,
  busy: boolean,
  backTo: number | null = null,
): SpaceFrameBlock {
  return {
    id: `continue-${to}`,
    type: "rows",
    label: null,
    rows: [
      {
        id: "continue",
        title: "When you are ready",
        note: "",
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [
          step(label, to, busy),
          ...(backTo === null ? [] : [back(backTo, busy)]),
        ],
        evidence: [],
      },
    ],
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

function step(label: string, to: number, busy: boolean): SpaceFrameAction {
  return {
    verb: "prepare",
    label,
    to: null,
    stepId: `go:${to}`,
    disabledReason: busy ? "One moment…" : null,
    notPermittedReason: null,
  };
}

function back(to: number, busy: boolean): SpaceFrameAction {
  return {
    verb: "prepare",
    label: "Back",
    to: null,
    stepId: `go:${to}`,
    disabledReason: busy ? "One moment…" : null,
    notPermittedReason: null,
  };
}

function facts(id: string, label: string, pairs: [string, string][]): SpaceFrameBlock {
  return {
    id,
    type: "facts",
    label,
    facts: pairs.map(([key, value]) => ({
      key,
      value,
      /* Abstention is a state: an unknown value says so rather than rendering as empty. */
      missing: value === "",
      evidence: [],
    })),
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

function note(id: string, tone: SpaceTone, title: string, text: string): SpaceFrameBlock {
  return { id, type: "note", label: null, tone, title, text, evidence: [], actions: [], state: "ready", stateNote: null };
}

function route(label: string, path: string): SpaceFrameAction {
  return {
    verb: "open",
    label,
    to: {
      spaceKind: "route",
      recordType: "route",
      recordId: null,
      workflowId: null,
      path,
      title: label,
      label: "ASAP",
    },
    stepId: null,
    disabledReason: null,
    notPermittedReason: null,
  };
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
