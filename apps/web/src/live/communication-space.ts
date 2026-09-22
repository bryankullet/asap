import type {
  EmailLinkSuggestion,
  EmailMessageDetail,
  EmailThreadResponse,
  EmailThreadsResponse,
  SpaceFrame,
  SpaceFrameAction,
  SpaceFrameBlock,
  SpaceRef,
  SpaceRow,
  SpaceTone,
} from "@asap/schema";

/**
 * Communication: the brokerage's own correspondence, as Spaces.
 *
 * Three lines this file holds, all of which are easy to cross with a helpful-looking string:
 *
 *  - **A draft is never described as sent.** There is no send path in this deployment; the Space
 *    says so where a Send button would otherwise be, and the words come from the server's own
 *    `sending` answer rather than from here.
 *  - **A suggestion is never a link.** Suggested records are shown with the reason they were
 *    suggested and an action a person takes. Nothing about a thread changes until they do.
 *  - **A message is shown, not summarised away.** Every message in the thread is rendered with
 *    its sender, its recipients, its time and the provider's own id, so the original is findable.
 */

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Timestamps read the way a person says them, and an absent one says so rather than showing "—". */
function when(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/* ---- The list ------------------------------------------------------------------------------ */

/** Every conversation, newest first. One Space, not a list page for an entity type. */
export function communicationListSpace(
  response: EmailThreadsResponse | undefined,
  state: { loading: boolean; error: string | null },
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "communication",
    recordType: "organization",
    recordId: null,
    workflowId: null,
    path: "/email",
    title: "Communication",
    label: "COMMUNICATION",
  };
  const base = {
    self,
    title: "Communication",
    context:
      "Conversations with clients and insurers, beside the work they belong to. Nothing is sent from ASAP: a reply leaves only through the mailbox it was written in.",
    filters: [],
    related: [] as SpaceRef[],
    region: null,
    actions: [route("Connections", "/connections")],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  if (state.error !== null) {
    return {
      ...base,
      status: { label: "Could not read", tone: "attention" },
      blocks: [note("error", "attention", "We could not read your email", state.error)],
      state: "error",
      emptyState: null,
    };
  }
  if (state.loading || !response) {
    return {
      ...base,
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
      emptyState: null,
    };
  }

  if (response.threads.length === 0) {
    return {
      ...base,
      status: {
        label: response.mailboxConnected ? "Nothing yet" : "No mailbox",
        tone: "neutral",
      },
      blocks: [],
      state: "empty",
      emptyState: response.mailboxConnected
        ? {
            heading: "Nothing has arrived yet.",
            body: "New conversations appear here as they land in the connected mailbox.",
            actions: [],
          }
        : {
            heading: "No mailbox is connected.",
            body: "Until one is, ASAP works from what you put on file yourself.",
            actions: [route("Connect a mailbox", "/connections")],
          },
    };
  }

  const rows: SpaceRow[] = response.threads.map((t) => ({
    id: t.id,
    title: t.subject || "(No subject)",
    note: [
      t.clientName ?? "Not linked to a client yet",
      plural(t.messageCount, "message"),
      when(t.lastMessageAt),
    ]
      .filter((s) => s !== "")
      .join(" · "),
    badge: t.unhandled === null ? null : "Needs a person",
    badgeTone: t.unhandled === null ? "neutral" : "waiting",
    why: t.unhandled,
    related: threadRef(t.id, t.subject),
    region: null,
    actions: [],
    evidence: [],
  }));

  return {
    ...base,
    status: { label: plural(rows.length, "conversation"), tone: "neutral" },
    blocks: [
      {
        id: "threads",
        type: "rows",
        label: "CONVERSATIONS",
        rows,
        evidence: [],
        actions: [],
        state: "ready",
        stateNote: null,
      },
    ],
    state: "ready",
    emptyState: null,
  };
}

/* ---- One conversation ---------------------------------------------------------------------- */

/**
 * One conversation, as its own Space.
 *
 * Keyed by the thread's id, so opening the same conversation twice focuses the tab that is already
 * there, and two conversations never share a draft, a recipient list or a set of links.
 */
export function communicationSpace(
  detail: EmailThreadResponse | undefined,
  state: {
    loading: boolean;
    error: string | null;
    missing: boolean;
    busy: boolean;
    /** What is in the composer right now, before it has been saved. */
    draft: { to: string; cc: string; subject: string; body: string } | null;
  },
  threadId: string,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "communication",
    recordType: "email_thread",
    recordId: threadId,
    workflowId: detail?.links.workItemId ?? null,
    path: `/email/${threadId}`,
    title: detail?.thread.subject || "Conversation",
    label: "CONVERSATION",
  };
  const base = {
    self,
    title: detail?.thread.subject || "Conversation",
    context:
      "The brokerage's own correspondence. What this conversation is about was set by a person; ASAP may suggest a link, and never confirms one.",
    filters: [],
    region: null,
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
      blocks: [note("error", "attention", "We could not read this conversation", state.error)],
      state: "error",
      emptyState: null,
    };
  }
  if (state.loading || !detail) {
    return {
      ...base,
      related: [],
      actions: [],
      status: state.missing
        ? { label: "Not found", tone: "neutral" }
        : { label: "Reading", tone: "active" },
      blocks: [],
      /*
       * A conversation that is not there is empty rather than loading: the request finished and
       * the answer was nothing, which is a different thing to say.
       */
      state: state.missing ? "empty" : "loading",
      emptyState: state.missing
        ? {
            heading: "This conversation is not here.",
            body: "It may have been removed, or it belongs to another brokerage.",
            actions: [route("All conversations", "/email")],
          }
        : null,
    };
  }

  const t = detail.thread;
  const links = detail.links;

  const related: SpaceRef[] = [];
  if (links.clientId !== null && links.clientName !== null) {
    related.push({
      spaceKind: "client",
      recordType: "client",
      recordId: links.clientId,
      workflowId: null,
      path: `/clients/${links.clientId}`,
      title: links.clientName,
      label: "CLIENT",
    });
  }
  if (links.workItemId !== null && links.workItemTitle !== null) {
    related.push({
      spaceKind: "work_item",
      recordType: "work_item",
      recordId: links.workItemId,
      workflowId: links.workItemId,
      path: `/work/${links.workItemId}`,
      title: links.workItemTitle,
      label: (links.workItemKind ?? "WORK").toUpperCase(),
    });
  }

  const blocks: SpaceFrameBlock[] = [
    facts("summary", "THIS CONVERSATION", [
      ["Subject", t.subject || ""],
      ["Participants", t.participants.join(", ")],
      ["Mailbox", t.mailboxAddress ?? ""],
      ["Provider", t.provider === "gmail" ? "Gmail" : t.provider === "microsoft" ? "Microsoft 365" : ""],
      ["Mailbox connection", mailboxWords(t.mailboxStatus)],
      ["First message", when(t.firstMessageAt)],
      ["Latest message", when(t.lastMessageAt)],
      ["Messages", String(t.messageCount)],
    ]),
  ];

  if (t.unhandled !== null) {
    blocks.push(note("unhandled", "waiting", "Somebody needs to deal with this", t.unhandled));
  }

  blocks.push(linkBlock(links, state.busy));

  if (detail.suggestions.length > 0) {
    blocks.push(suggestionBlock(detail.suggestions, state.busy));
  }

  for (const m of detail.messages) blocks.push(messageBlock(m));

  blocks.push(...draftBlocks(detail, state));

  return {
    ...base,
    related,
    actions: [route("All conversations", "/email")],
    status: t.unhandled === null
      ? { label: "Read", tone: "neutral" }
      : { label: "Needs a person", tone: "waiting" },
    blocks,
    state: "ready",
    emptyState: null,
  };
}

/** The mailbox's own state, in the words a person would use. Never inferred from elapsed time. */
function mailboxWords(status: EmailThreadResponse["thread"]["mailboxStatus"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_reauthorisation":
      return "Needs authorising again — nothing new is arriving";
    case "disconnected":
      return "Disconnected — nothing new is arriving";
    default:
      return "";
  }
}

/** One message, with everything needed to find the original and whatever it brought with it. */
function messageBlock(m: EmailMessageDetail): SpaceFrameBlock {
  const actions: SpaceFrameAction[] = [];
  if (m.providerUrl !== null) {
    actions.push({
      verb: "open",
      label: "Open the original",
      to: {
        spaceKind: "route",
        recordType: "route",
        recordId: null,
        workflowId: null,
        path: m.providerUrl,
        title: "The original message",
        label: "GMAIL",
      },
      stepId: null,
      disabledReason: null,
      notPermittedReason: null,
    });
  }
  for (const a of m.attachments) {
    if (a.documentId === null) continue;
    actions.push({
      verb: "open",
      label: `Open ${a.filename}`,
      to: {
        spaceKind: "document",
        recordType: "document",
        recordId: a.documentId,
        workflowId: null,
        path: `/documents/${a.documentId}`,
        title: a.filename,
        label: "DOCUMENT",
      },
      stepId: null,
      disabledReason: null,
      notPermittedReason: null,
    });
  }

  return {
    id: `message:${m.id}`,
    type: "email",
    label: null,
    headLabel: m.from,
    /*
     * The provider's own id travels with the message. It is what makes "the original" a findable
     * thing rather than a claim, and it is the same id a duplicate import would collide on.
     */
    headMeta: [
      m.direction === "inbound" ? "Received" : "Sent",
      when(m.sentAt),
      `id ${m.providerMessageId}`,
    ]
      .filter((s) => s !== "")
      .join(" · "),
    tone: m.direction === "inbound" ? "neutral" : "done",
    /* The block already prints "To ·", so this is the addresses themselves. */
    to: [
      m.to.join(", "),
      m.cc.length > 0 ? `Cc ${m.cc.join(", ")}` : "",
    ]
      .filter((s) => s !== "")
      .join(" · "),
    subject: m.subject,
    /*
     * The body as it arrived, or the provider's own snippet when we hold no body. An absent body
     * says so: a conversation with nothing readable in it is a state, not an empty card.
     */
    body: m.body ?? m.snippet ?? "This message has no readable text.",
    attachments: m.attachments.slice(0, 10).map((a) => ({ name: a.filename })),
    evidence: [],
    actions,
    state: "ready",
    stateNote: null,
  };
}

/** What the conversation is about, with a way to take back anything wrong. */
function linkBlock(links: EmailThreadResponse["links"], busy: boolean): SpaceFrameBlock {
  const rows: SpaceRow[] = [
    linkRow("client", "Client", links.clientName, links.clientId, busy),
    linkRow("policy", "Policy", links.policyNumber, links.policyId, busy),
    linkRow("work_item", links.workItemKind ?? "Work", links.workItemTitle, links.workItemId, busy),
  ];
  return {
    id: "links",
    type: "rows",
    label: "WHAT THIS IS ABOUT",
    rows,
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

function linkRow(
  target: string,
  label: string,
  value: string | null,
  id: string | null,
  busy: boolean,
): SpaceRow {
  return {
    id: `link:${target}`,
    title: label,
    note: value ?? "Not linked yet",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    region: null,
    actions:
      id === null
        ? []
        : [
            {
              verb: "exception",
              label: "Remove this link",
              to: null,
              stepId: `unlink:${target}`,
              disabledReason: busy ? "A change is being saved." : null,
              notPermittedReason: null,
            },
          ],
    evidence: [],
  };
}

/**
 * Links ASAP thinks are likely.
 *
 * Every row carries the reason it was suggested, revealed by the row itself. Accepting one is a
 * person's action: a matching name has never been evidence that two records are the same client,
 * and an unambiguous match on an exact identifier is still shown rather than applied.
 */
function suggestionBlock(suggestions: EmailLinkSuggestion[], busy: boolean): SpaceFrameBlock {
  return {
    id: "suggestions",
    type: "rows",
    label: "ASAP THINKS THIS MIGHT BE ABOUT",
    rows: suggestions.map((s) => ({
      id: `suggestion:${s.target}:${s.id}`,
      title: s.label,
      note: s.target === "client" ? "A client on file" : s.target === "policy" ? "A policy on file" : "Work in progress",
      badge: s.unambiguous ? "One match" : "More than one candidate",
      badgeTone: s.unambiguous ? "neutral" : "waiting",
      why: s.because,
      related: null,
      region: null,
      actions: [
        {
          verb: "prepare",
          label: "Link it",
          to: null,
          stepId: `link:${s.target}:${s.id}`,
          disabledReason: busy ? "A change is being saved." : null,
          notPermittedReason: null,
        },
      ],
      evidence: [],
    })),
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

/**
 * The reply being written, and everything true about it.
 *
 * The order matters: the words "nobody has received it" come before the composer, not after it,
 * and the approval block states what an approval covers. When the deployment cannot send — which
 * it cannot, today — that is said in the server's own words instead of a Send button.
 */
function draftBlocks(
  detail: EmailThreadResponse,
  state: { busy: boolean; draft: { to: string; cc: string; subject: string; body: string } | null },
): SpaceFrameBlock[] {
  const saved = detail.draft;
  const composer = state.draft ?? {
    to: (saved?.to ?? []).join(", "),
    cc: (saved?.cc ?? []).join(", "),
    subject: saved?.subject ?? replySubject(detail),
    body: saved?.body ?? "",
  };

  const blocks: SpaceFrameBlock[] = [
    note(
      "draft-truth",
      "waiting",
      "This is a draft. Nobody has received it.",
      detail.sending.available
        ? "It is sent only when a person approves it and the provider confirms it."
        : (detail.sending.reason ??
          "Sending from ASAP is not connected yet. Copy this draft or open it in Gmail."),
    ),
    {
      id: "draft",
      type: "form",
      label: "REPLY",
      fields: [
        { name: "to", label: "To", kind: "text", value: composer.to, placeholder: "", required: true, options: [], hint: "Separate addresses with a comma.", error: null },
        { name: "cc", label: "Cc", kind: "text", value: composer.cc, placeholder: "", required: false, options: [], hint: "", error: null },
        { name: "subject", label: "Subject", kind: "text", value: composer.subject, placeholder: "", required: true, options: [], hint: "", error: null },
        { name: "body", label: "Message", kind: "textarea", value: composer.body, placeholder: "", required: true, options: [], hint: "", error: null },
      ],
      submitLabel: "Save this draft",
      busy: state.busy,
      evidence: [],
      /*
       * The form's own submit. It is `draft` rather than `record_send` on purpose: saving a reply
       * is writing a row, and nothing about it reaches anybody outside the brokerage.
       */
      actions: [
        {
          verb: "draft",
          label: "Save this draft",
          to: null,
          stepId: "save-draft",
          disabledReason: null,
          notPermittedReason: null,
        },
      ],
      state: "ready",
      stateNote: null,
    },
  ];

  if (saved !== null) {
    blocks.push({
      id: "draft-approval",
      type: "approval_gate",
      label: null,
      heading:
        saved.approvedAt === null
          ? "This reply has not been approved"
          : `Approved${saved.approvedByName === null ? "" : ` by ${saved.approvedByName}`} on ${when(saved.approvedAt)}`,
      detail:
        saved.approvedAt === null
          ? "An approval covers the recipients, the subject and the message exactly as they read now. Editing any of them afterwards clears it."
          : "This approval covers the reply as it now reads. Editing it clears the approval, and it has to be approved again.",
      blockedNote: detail.sending.available
        ? null
        : (detail.sending.reason ??
          "Sending from ASAP is not connected yet. Copy this draft or open it in Gmail."),
      evidence: [],
      actions:
        saved.approvedAt === null
          ? [
              {
                verb: "approve",
                label: "Approve this reply",
                to: null,
                stepId: "approve",
                disabledReason: state.busy ? "A change is being saved." : null,
                notPermittedReason: null,
              },
            ]
          : [],
      state: "ready",
      stateNote: null,
    });
  }

  return blocks;
}

/** The subject a reply would carry, from the thread's own subject. Never composed by a model. */
function replySubject(detail: EmailThreadResponse): string {
  const s = detail.thread.subject;
  if (s === "") return "";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/* ---- Shared little builders ---------------------------------------------------------------- */

function threadRef(id: string, subject: string): SpaceRef {
  return {
    spaceKind: "communication",
    recordType: "email_thread",
    recordId: id,
    workflowId: null,
    path: `/email/${id}`,
    title: subject || "(No subject)",
    label: "CONVERSATION",
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
