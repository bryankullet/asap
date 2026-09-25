import type {
  ClientSpaceResponse,
  SpaceFrame,
  SpaceFrameAction,
  SpaceFrameBlock,
  SpaceRef,
  SpaceRow,
  SpaceTone,
} from "@asap/schema";

/**
 * One client, as a Space (D-083).
 *
 * The title is the client's own name. There is no screen called "Client Space", and no list page
 * for clients behind it: this is a relationship seen whole, assembled from the brokerage's own
 * rows in one read.
 *
 * Two rules decide what appears:
 *
 *  - **A section that has nothing to say is not shown.** A client with no claims does not get an
 *    empty Claims heading; the Space is shorter instead. The exception is a gap that affects the
 *    work — cover with no contact to write to, a file still missing documents, a premium nobody
 *    has verified — which is stated plainly, because a silent absence there reads as "fine".
 *  - **Nothing is offered that cannot happen.** An action without a backend contract is rendered
 *    unavailable with the server's own reason and the increment that will build it, never as a
 *    button whose only effect is to look like it worked.
 */

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A date as a person says it. An absent one says nothing rather than rendering a dash. */
function day(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** An amount exactly as recorded. Never computed, never rounded, never invented. */
function money(amount: string | null, currency: string | null): string {
  if (amount === null || currency === null) return "";
  const n = Number(amount);
  return Number.isNaN(n) ? `${currency} ${amount}` : `${currency} ${n.toLocaleString()}`;
}

/** What the work layer calls this state. Never "Waiting" alone: an outside party is named (D-075). */
function workState(w: ClientSpaceResponse["work"][number]): { label: string; tone: SpaceTone } {
  switch (w.taskStatus) {
    case "needs_you":
      return { label: "Yours", tone: "attention" };
    case "with_party":
      return {
        label: w.taskParty === null ? "With someone else" : `With ${w.taskParty}${w.taskSince ? ` since ${day(w.taskSince)}` : ""}`,
        tone: "waiting",
      };
    case "in_progress":
      return { label: "In progress", tone: "active" };
    default:
      return { label: "Done", tone: "done" };
  }
}

export function clientSpace(
  data: ClientSpaceResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  clientId: string,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "client",
    recordType: "client",
    recordId: clientId,
    workflowId: null,
    path: `/clients/${clientId}`,
    /* The client's own name, once it is known. Never the words "Client Space". */
    title: data?.client.name ?? "Client",
    label: "CLIENT",
  };
  const base = {
    self,
    title: data?.client.name ?? "Client",
    context:
      "Everything this brokerage holds about this client, assembled from its own records. Figures are shown as recorded, with where each came from.",
    filters: [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  if (state.error !== null) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Could not read", tone: "attention" },
      blocks: [note("error", "attention", "We could not read this client", state.error)],
      state: "error",
      emptyState: null,
    };
  }
  if (state.missing) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Not found", tone: "neutral" },
      blocks: [],
      state: "empty",
      emptyState: {
        heading: "This client is not here.",
        body: "It may have been removed, or it belongs to another brokerage.",
        actions: [route("All clients", "/files")],
      },
    };
  }
  if (state.loading || !data) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
      emptyState: null,
    };
  }

  const openWork = data.work.filter((w) => w.taskStatus !== "done");
  const openClaims = data.claims.filter((c) => c.status !== "closed");
  const current = data.policies.flatMap((p) =>
    p.periods.filter((r) => r.current).map((r) => ({ policy: p, period: r })),
  );
  const primary = data.contacts.find((c) => c.isPrimary) ?? data.contacts[0] ?? null;

  const blocks: SpaceFrameBlock[] = [];

  /* ---- What matters about this client ---------------------------------------------------- */
  blocks.push(
    facts("about", "THIS CLIENT", [
      ["Kind", data.client.kind === "corporate" ? "Company" : "Individual"],
      ["Main contact", primary === null ? "" : `${primary.fullName}${primary.roleLabel ? ` · ${primary.roleLabel}` : ""}`],
      [
        "Current cover",
        current.length === 0
          ? ""
          : current
              .map((x) => `${x.policy.policyNumber ?? x.policy.classOfBusiness}${x.policy.insurerName ? ` · ${x.policy.insurerName}` : ""}`)
              .join(", "),
      ],
      [
        "Cover to",
        current.length === 0 ? "" : current.map((x) => day(x.period.periodEnd)).join(", "),
      ],
      ["Open work", openWork.length === 0 ? "None" : String(openWork.length)],
      ["Open claims", openClaims.length === 0 ? "None" : String(openClaims.length)],
      ["Client file", fileWords(data.client.fileStatus)],
    ]),
  );

  /*
   * Gaps that affect the work, said out loud.
   *
   * Each of these is a silence that would otherwise read as "fine": cover with nobody to write to,
   * a file that cannot be cleared, a premium figure nobody has checked against a document.
   */
  const affecting: string[] = [];
  if (primary === null) {
    affecting.push("Nobody is recorded as the contact for this client, so ASAP does not know who to write to.");
  } else if (primary.email === null) {
    affecting.push(`${primary.fullName} has no email address on file, so nothing can be sent to them.`);
  }
  if (data.fileMissing.length > 0) {
    affecting.push(`The client file is still waiting for ${data.fileMissing.join(", ")}.`);
  }
  const unverified = data.policies
    .flatMap((p) => p.periods)
    .filter((r) => r.premiumAmount !== null && r.premiumVerifiedAt === null);
  if (unverified.length > 0) {
    affecting.push(
      `${plural(unverified.length, "premium figure")} ${unverified.length === 1 ? "is" : "are"} recorded but not checked against a document.`,
    );
  }
  if (affecting.length > 0) {
    blocks.push(
      missing("gaps", "What is missing", affecting),
    );
  }

  /* ---- Contacts ---------------------------------------------------------------------------- */
  if (data.contacts.length > 0) {
    blocks.push({
      id: "contacts",
      type: "rows",
      label: "CONTACTS",
      rows: data.contacts.map((c) => ({
        id: c.id,
        title: c.fullName,
        note: [c.roleLabel, c.email, c.phone].filter((s): s is string => s !== null && s !== "").join(" · ") || "No details recorded",
        badge: c.isPrimary ? "Main contact" : null,
        badgeTone: "neutral",
        why: c.email === null ? "No email address, so nothing can be sent to this person." : null,
        related: null,
        region: null,
        actions: [],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* ---- Cover ------------------------------------------------------------------------------- */
  if (data.policies.length > 0) {
    const rows: SpaceRow[] = [];
    for (const p of data.policies) {
      if (p.periods.length === 0) {
        rows.push({
          id: p.id,
          title: p.policyNumber ?? p.classOfBusiness,
          note: [p.classOfBusiness, p.insurerName].filter((s): s is string => s !== null).join(" · "),
          badge: "No period recorded",
          badgeTone: "waiting",
          why: "This policy has no period of cover on file, so ASAP cannot say when it runs to.",
          related: policyRef(p.id, p.policyNumber ?? p.classOfBusiness),
          region: null,
          actions: [],
          evidence: [],
        });
        continue;
      }
      for (const r of p.periods) {
        rows.push({
          id: r.id,
          title: `${p.policyNumber ?? p.classOfBusiness}${p.insurerName ? ` · ${p.insurerName}` : ""}`,
          note: [
            `${day(r.periodStart)} – ${day(r.periodEnd)}`,
            money(r.premiumAmount, r.premiumCurrency),
            r.premiumBasis === null ? "" : r.premiumBasis === "gross" ? "gross" : "total payable",
          ]
            .filter((s) => s !== "")
            .join(" · "),
          badge: r.current ? "Current" : "Past",
          badgeTone: r.current ? "active" : "neutral",
          /*
           * Where the figure came from. An imported premium is the old system's claim until a
           * document proves it, and saying so is the difference between a number and a fact.
           */
          why:
            r.premiumAmount === null
              ? "No premium is recorded for this period."
              : r.premiumVerifiedAt === null
                ? `Recorded ${sourceWords(r.premiumSource)}, and not yet checked against a document.`
                : `Checked against a document on ${day(r.premiumVerifiedAt)}.`,
          related: policyRef(p.id, p.policyNumber ?? p.classOfBusiness),
          region: null,
          actions: [],
          evidence: [],
        });
      }
    }
    blocks.push({
      id: "cover",
      type: "rows",
      label: "COVER — HISTORY IS NEVER OVERWRITTEN",
      rows,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* ---- Work, renewals and servicing --------------------------------------------------------- */
  if (openWork.length > 0) {
    blocks.push(workBlock("work", "OUTSTANDING WORK", openWork));
  }

  /* ---- Claims ------------------------------------------------------------------------------- */
  if (data.claims.length > 0) {
    blocks.push({
      id: "claims",
      type: "rows",
      label: "CLAIMS",
      rows: data.claims.map((c) => ({
        id: c.id,
        title: c.incidentSummary,
        note: [`Incident ${day(c.incidentOn)}`, c.insurerReference].filter((s): s is string => s !== null && s !== "").join(" · "),
        badge: c.status === "draft" ? "Not registered" : c.status === "registered" ? "Registered" : "Closed",
        badgeTone: c.status === "draft" ? "waiting" : c.status === "registered" ? "active" : "neutral",
        why: c.status === "draft" ? "Nothing has been reported to the insurer yet." : null,
        related: workRef(c.workItemId, c.incidentSummary, "CLAIM"),
        region: null,
        actions: [],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* ---- Endorsements -------------------------------------------------------------------------- */
  if (data.endorsements.length > 0) {
    blocks.push({
      id: "endorsements",
      type: "rows",
      label: "SERVICING AND ENDORSEMENTS",
      rows: data.endorsements.map((e) => ({
        id: e.id,
        title: e.kind,
        note: [e.effectiveOn === null ? "" : `Effective ${day(e.effectiveOn)}`, e.status].filter((s) => s !== "").join(" · "),
        badge: e.status,
        badgeTone: e.status === "applied" ? "done" : "waiting",
        why: null,
        related: workRef(e.workItemId, e.kind, "ENDORSEMENT"),
        region: null,
        actions: [],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* ---- Documents ---------------------------------------------------------------------------- */
  if (data.documents.length > 0) {
    blocks.push({
      id: "documents",
      type: "rows",
      label: "DOCUMENTS",
      rows: data.documents.map((d) => ({
        id: d.id,
        title: d.filename,
        note: [d.kind.replace(/_/g, " "), day(d.createdAt)].filter((s) => s !== "").join(" · "),
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: {
          spaceKind: "document",
          recordType: "document",
          recordId: d.id,
          workflowId: null,
          path: `/documents/${d.id}`,
          title: d.filename,
          label: "DOCUMENT",
        },
        region: null,
        actions: [],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* ---- Email --------------------------------------------------------------------------------- */
  if (data.threads.length > 0) {
    blocks.push({
      id: "email",
      type: "rows",
      label: "EMAIL",
      rows: data.threads.map((t) => ({
        id: t.id,
        title: t.subject || "(No subject)",
        note: [plural(t.messageCount, "message"), day(t.lastMessageAt)].filter((s) => s !== "").join(" · "),
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: {
          spaceKind: "communication",
          recordType: "email_thread",
          recordId: t.id,
          workflowId: null,
          path: `/email/${t.id}`,
          title: t.subject || "(No subject)",
          label: "CONVERSATION",
        },
        region: null,
        actions: [],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  } else if (!data.mailboxConnected) {
    /*
     * No email and no mailbox are different facts. Saying which one this is stops "no
     * correspondence" reading as "they never wrote to us".
     */
    blocks.push(
      note(
        "no-mailbox",
        "neutral",
        "No mailbox is connected",
        "ASAP is not reading email for this brokerage, so there is no correspondence here to show.",
      ),
    );
  }

  /* ---- What a person can do ------------------------------------------------------------------ */
  blocks.push(actionsBlock(data, clientId, state.busy));

  const related: SpaceRef[] = [
    {
      spaceKind: "route",
      recordType: "route",
      recordId: null,
      workflowId: null,
      path: `/files/${clientId}`,
      title: "Compliance file",
      label: "FILE",
    },
  ];

  return {
    ...base,
    related,
    actions: [],
    status: coverStatus(current.length, openWork.length),
    blocks,
    state: "ready",
    emptyState: null,
  };
}

/** The one line at the top: is there cover, and is anything waiting on a person. */
function coverStatus(current: number, openWork: number): { label: string; tone: SpaceTone } {
  if (current === 0) return { label: "No current cover", tone: "waiting" };
  if (openWork > 0) return { label: `${plural(openWork, "thing")} open`, tone: "active" };
  return { label: "Covered", tone: "done" };
}

function fileWords(status: string): string {
  switch (status) {
    case "cleared":
      return "Cleared";
    case "in_review":
      return "In review";
    case "incomplete":
      return "Incomplete";
    case "refresh_due":
      return "Due a refresh";
    default:
      return "Not started";
  }
}

function sourceWords(source: string): string {
  switch (source) {
    case "import":
      return "from an import";
    case "document":
      return "from a document";
    case "seed":
      return "as sample data";
    default:
      return "by hand";
  }
}

function workBlock(id: string, label: string, work: ClientSpaceResponse["work"]): SpaceFrameBlock {
  return {
    id,
    type: "rows",
    label,
    rows: work.map((w) => {
      const s = workState(w);
      return {
        id: w.id,
        title: w.title,
        note: [w.kind.replace(/_/g, " "), w.ownerName].filter((x): x is string => x !== null && x !== "").join(" · "),
        badge: s.label,
        badgeTone: s.tone,
        why: null,
        related: workRef(w.id, w.title, w.kind.replace(/_/g, " ").toUpperCase()),
        region: null,
        actions: [],
        evidence: [],
      };
    }),
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

/**
 * The actions this client's Space offers.
 *
 * Every one is either backed by a real contract or shown disabled with the server's own reason.
 * A permission the session does not carry disables the action with its own words rather than
 * hiding it (§34), because a missing button teaches a person the feature does not exist.
 */
function actionsBlock(data: ClientSpaceResponse, clientId: string, busy: boolean): SpaceFrameBlock {
  const rows: SpaceRow[] = [];
  const p = data.permissions;

  rows.push({
    id: "renewal",
    title: "Start renewal work",
    note: "Opens a renewal and asks insurers for terms.",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions: [
      act("Start a renewal", `start:renewal`, busy, p.canStartWork ? null : "You may not start work in this brokerage."),
    ],
    evidence: [],
  });

  rows.push({
    id: "quotation",
    title: "Start quotation work",
    note: "Records what the client needs insured, what is still missing, and which insurers are approached.",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions: [
      act("Start a quotation", "start:quotation", busy, p.canStartWork ? null : "You may not start work in this brokerage."),
    ],
    evidence: [],
  });

  rows.push({
    id: "claim",
    title: "Register a claim",
    note: "Opens the claim form. ASAP needs the incident and the date from you, and will not invent either.",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions: [
      act("Start a claim", `start:claim`, busy, p.canStartWork ? null : "You may not start work in this brokerage."),
    ],
    evidence: [],
  });

  rows.push({
    id: "endorsement",
    title: "Start a servicing request",
    note: "A mid-term change: add a vehicle, raise a sum insured. The form asks for the request in the client's own words.",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions: [
      act("Start an endorsement", `start:endorsement`, busy, p.canStartWork ? null : "You may not start work in this brokerage."),
    ],
    evidence: [],
  });

  rows.push({
    id: "contacts",
    title: "Contacts",
    note: "Who the brokerage writes to.",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions: [
      {
        verb: "open",
        label: "Add or edit a contact",
        to: {
          spaceKind: "route",
          recordType: "route",
          recordId: null,
          workflowId: null,
          path: `/files/${clientId}`,
          title: "Compliance file",
          label: "FILE",
        },
        stepId: null,
        disabledReason: null,
        notPermittedReason: p.canEditContacts ? null : "You may not change this client's details.",
      },
    ],
    evidence: [],
  });

  rows.push({
    id: "upload",
    title: "Add a document",
    note: "Goes through the same reading as any other file; nothing it says counts until you accept it.",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions: [
      {
        verb: "open",
        label: "Upload a document",
        to: {
          spaceKind: "document",
          recordType: "organization",
          recordId: null,
          workflowId: null,
          path: "/documents",
          title: "Documents",
          label: "DOCUMENTS",
        },
        stepId: null,
        disabledReason: null,
        notPermittedReason: p.canUploadDocuments ? null : "You may not add documents in this brokerage.",
      },
    ],
    evidence: [],
  });

  /* What does not exist yet, named where somebody would look for it. */
  for (const gap of data.gaps) {
    rows.push({
      id: `gap:${gap.id}`,
      title: gap.label,
      note: gap.reason,
      badge: `Not built (${gap.gap})`,
      badgeTone: "waiting",
      why: null,
      related: null,
      region: null,
      actions: [
        {
          verb: "prepare",
          label: gap.label,
          to: null,
          stepId: `gap:${gap.id}`,
          disabledReason: gap.reason,
          notPermittedReason: null,
        },
      ],
      evidence: [],
    });
  }

  return {
    id: "actions",
    type: "rows",
    label: "WHAT YOU CAN DO",
    rows,
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

function act(label: string, stepId: string, busy: boolean, notPermitted: string | null): SpaceFrameAction {
  return {
    verb: "prepare",
    label,
    to: null,
    stepId,
    disabledReason: busy ? "One moment…" : null,
    notPermittedReason: notPermitted,
  };
}

function policyRef(id: string, title: string): SpaceRef {
  return {
    spaceKind: "policy",
    recordType: "policy",
    recordId: id,
    workflowId: null,
    path: `/r/${id}`,
    title,
    label: "POLICY",
  };
}

function workRef(id: string, title: string, label: string): SpaceRef {
  return {
    spaceKind: "work_item",
    recordType: "work_item",
    recordId: id,
    workflowId: id,
    path: `/r/${id}`,
    title,
    label,
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

function missing(id: string, label: string, items: string[]): SpaceFrameBlock {
  return {
    id,
    type: "missing",
    label,
    items: items.map((text) => ({ text })),
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
