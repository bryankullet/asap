/**
 * Live mode: the approved ASAP interface over this brokerage's own records.
 *
 * The interface's engine (engine/intent.js) reads a normalized record store. Here that store is
 * hydrated from the authenticated API — the server resolves who you are and which brokerage — and
 * every write goes back through the API. Nothing is invented: a value the API does not hold is
 * left empty, and cover reads as active only when the server's own cover check has verified it.
 *
 * Actions the API cannot perform yet are refused in words, never simulated.
 */
import { api, ApiRequestError, describeApiError } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import * as S from "./engine/store.js";
import { buildWorkspace, interpret, parseDate } from "./engine/intent.js";
import { IMPORT_HEADERS, liveSpace, plural } from "./live-spaces.js";

const WORK_VIEWS = ["needs", "with", "progress", "done"];
const CLIENT_VIEWS = ["blocking", "incomplete", "refresh_due", "cleared", "not_started"];

/** Run `fn` over `items`, at most `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch {
          out[i] = null;
        }
      }
    }),
  );
  return out;
}

const initials = (name) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const shortName = (name) => initials(name.replace(/\b(ltd|limited|plc|inc)\b\.?/gi, ""));

/**
 * The engine's role names decide which buttons it offers; the server decides what is allowed.
 * A role is read from the permissions the server resolved, so a button is never offered to
 * someone the API would refuse.
 */
function roleFrom(permissions, isOwner) {
  const has = (p) => permissions.includes(p);
  if (isOwner || has("organization:edit")) return "admin";
  if (has("placement:approve")) return "principal";
  return "account";
}

const workState = (it) => {
  if (it.task_status === "done") return "Completed";
  if (it.task_status === "with_party" && it.task_party) {
    const since = it.task_since ? " since " + S.fmtDate(it.task_since).replace(/ \d{4}$/, "") : "";
    return "With " + it.task_party + since;
  }
  return "Active";
};
/** The words a person reads for where an item stands (D-075). */
const STATUS_LABEL = { needs_you: "Your work", in_progress: "In progress", done: "Done" };

const KIND = { renewal: "Renewal", claim: "Claim", endorsement: "Servicing", quotation: "Quotation", placement: "Placement", onboarding: "Onboarding", new_business: "New business" };
// When the server has no current step, name the obvious first move for the kind of work rather
// than showing a blank — worded as a suggestion, never as a recorded step.
const FIRST_MOVE = {
  quotation: "Collect the requirements and approach insurers",
  opportunity: "Collect the requirements and approach insurers",
  claim: "Collect the claim documents and notify the insurer",
  renewal: "Prepare the renewal terms for the client",
  endorsement: "Confirm the change with the insurer",
  placement: "Send the placement request for approval",
};
const nextMove = (it, row) => {
  if (row.nowStep?.label) return row.nowStep.label;
  if (it.required_action) return it.required_action;
  if (it.task_status === "done") return null;
  if (it.task_status === "with_party" && it.task_party) return "Chase " + it.task_party + " for a reply";
  return FIRST_MOVE[it.kind] ?? "Decide the first step and record it";
};
const kindWords = (k) => KIND[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Everything the engine reads, from the API. */
async function hydrate(me) {
  const org = me.active_organization;
  const db = { meta: { seq: 0, ledger: {}, session: { userId: me.user.id, clock: new Date().toISOString() } } };
  S.SCHEMA.forEach((c) => (db[c] = []));

  db.brokerages.push({ id: org.id, name: org.name, country: org.country ?? "", approvalRules: {} });

  // Every load that depends on nothing else starts now, together: the API is far from its
  // database, so each call costs seconds and waves run one after another add up (a 20 s load).
  const clientListsP = Promise.all(CLIENT_VIEWS.map((v) => api.clientFiles(v).catch(() => ({ items: [] }))));
  const convoP = loadConversation();
  const modelConfiguredP = api.askStatus().then((r) => r.modelConfigured).catch(() => null);

  const [members, mailboxes, automations, audit, opportunities, ...workViews] = await Promise.all([
    api.members().catch(() => ({ members: [] })),
    api.mailboxes().catch(() => null),
    api.automations().catch(() => ({ automations: [] })),
    api.audit().catch(() => ({ entries: [] })),
    api.opportunities().catch(() => ({ opportunities: [] })),
    ...WORK_VIEWS.map((v) => api.workList(v, 100).catch(() => ({ items: [] }))),
  ]);

  const myRole = roleFrom(me.permissions, members.members.find((m) => m.user.id === me.user.id)?.is_owner);
  for (const m of members.members.filter((m) => m.status === "active")) {
    const name = m.user.display_name || m.user.full_name || m.user.email;
    db.users.push({
      id: m.user.id,
      name,
      role: m.user.id === me.user.id ? myRole : m.is_owner ? "admin" : "account",
      initials: initials(name),
      brokerageId: org.id,
      email: m.user.email,
    });
  }
  if (!db.users.some((u) => u.id === me.user.id)) {
    const name = me.user.display_name || me.user.full_name || me.user.email;
    db.users.push({ id: me.user.id, name, role: myRole, initials: initials(name), brokerageId: org.id, email: me.user.email });
  }

  const mailbox = mailboxes?.mailboxes?.find?.((m) => m.status === "connected") ?? null;
  db.connections.push({
    id: "con_gmail",
    kind: "Gmail",
    account: mailbox?.emailAddress ?? "not connected",
    status: mailbox ? "connected" : "disconnected",
    lastSync: mailbox?.lastSyncedAt ?? null,
    note: mailbox ? "Your connected mailbox." : "No mailbox is connected yet. Nothing is sent from ASAP until one is.",
  });
  db.connections.push({ id: "con_sheets", kind: "Records import", account: "Spreadsheet & PDF upload", status: "connected", lastSync: null, note: "Files are stored privately for this brokerage." });
  db.connections.push({ id: "con_model", kind: "AI model", account: "ASAP", status: "disconnected", note: "Ask ASAP reads your records directly in this view." });

  // Clients: every compliance view, de-duplicated.
  // Each open quotation in full, fetched alongside the client records rather than after them.
  const detailsP = pool(
    opportunities.opportunities.filter((o) => !o.closedAt).slice(0, 40),
    6,
    (o) => api.opportunity(o.id),
  );
  const clientLists = await clientListsP;
  const seen = new Set();
  for (const list of clientLists) {
    for (const row of list.items) {
      if (seen.has(row.client.id) || row.client.deleted_at) continue;
      seen.add(row.client.id);
      db.clients.push({ id: row.client.id, name: row.client.name, legacyInvalid: row.client.name.trim().length < 2, short: shortName(row.client.name), brokerageId: org.id, createdAt: row.client.created_at });
    }
  }

  // Each client's own record: contacts, policies and periods, claims, documents, threads.
  const spaces = await pool(db.clients, 6, (c) => api.clientSpace(c.id));
  // A client whose record could not be read is said to be unreadable, never shown as empty.
  db.meta.unreadableClients = db.clients.filter((_, i) => !spaces[i]).map((c) => c.id);
  const policyIds = [];
  spaces.forEach((sp, i) => {
    if (!sp) return;
    const clientId = db.clients[i].id;
    for (const ct of sp.contacts) db.contacts.push({ id: ct.id, clientId, name: ct.fullName, role: ct.roleLabel ?? "", email: ct.email ?? "", phone: ct.phone ?? "" });
    for (const p of sp.policies) {
      policyIds.push(p.id);
      db.policies.push({ id: p.id, clientId, number: p.policyNumber ?? "Number not recorded", title: p.classOfBusiness, cls: p.classOfBusiness });
      for (const per of p.periods) {
        db.policyYears.push({
          id: per.id,
          policyId: p.id,
          clientId,
          year: Number(per.periodStart.slice(0, 4)),
          from: per.periodStart,
          to: per.periodEnd,
          insurer: p.insurerName ?? "Insurer not recorded",
          premium: per.premiumAmount == null ? null : Number(per.premiumAmount),
          // Set from the server's cover check below; until then nothing is called active.
          status: "Cover not verified",
          // The API does not number schedule versions; unknown, not an assumed v1.
          scheduleVersion: null,
          confirmationEvidenceId: null,
          scheduleDocumentId: per.premiumEvidenceDocumentId ?? null,
        });
      }
    }
    for (const cl of sp.claims) {
      db.claims.push({
        id: cl.id,
        clientId,
        policyYearId: null,
        policyId: cl.policyId,
        ref: cl.insurerReference ?? "No insurer reference yet",
        title: cl.incidentSummary.slice(0, 80),
        lossAt: cl.incidentOn,
        status: cl.status === "draft" ? "Draft — not registered" : cl.status === "registered" ? "Registered" : "Closed",
        excess: null,
        checklist: [],
        timeline: [],
        parties: [],
        workItemId: cl.workItemId,
      });
    }
    for (const en of sp.endorsements) {
      // Placed on the period its effective date falls in, else the policy's latest period.
      const years = db.policyYears.filter((y) => y.policyId === en.policyId);
      const year = years.find((y) => en.effectiveOn && y.from <= en.effectiveOn && en.effectiveOn <= y.to) ?? years[years.length - 1];
      if (!year) continue;
      db.endorsements.push({
        id: en.id,
        policyYearId: year.id,
        clientId,
        detail: en.kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        at: en.effectiveOn,
        scheduleVersion: null,
        additionalPremium: null,
        evidenceId: null,
        badgeLabel: en.status.replace(/_/g, " "),
        workItemId: en.workItemId,
      });
    }
    for (const d of sp.documents) {
      db.documents.push({
        id: d.id,
        clientId,
        name: d.filename,
        kind: d.kind,
        currentVersion: 1,
        createdAt: d.createdAt,
        source: "upload",
        readingState: { not_started: "Not read yet", queued: "Waiting to be read", working: "Being read now", extracted: "Read", failed: "Could not be read", not_applicable: "Not read" }[d.extractionState] ?? null,
      });
      db.documentVersions.push({
        id: d.id + ":v1",
        documentId: d.id,
        version: 1,
        title: d.filename,
        lines: [d.filename, "Kind: " + d.kind, "Reading: " + d.extractionState.replace(/_/g, " ")],
        note: "Stored privately for this brokerage.",
        at: d.createdAt,
        by: "",
      });
    }
    for (const t of sp.threads) {
      db.emails.push({ id: t.id, clientId, direction: "in", read: true, from: "", to: "", subject: t.subject, body: t.messageCount + " message(s) in this thread.", at: t.lastMessageAt ?? d0(), threadId: t.id });
    }
  });

  // Cover, as the server derives it — the only source allowed to say "Active cover".
  // Cover checks and document details depend only on the client records, so they run together.
  const [covers, docDetails] = await Promise.all([
    pool(policyIds, 6, (id) => api.policySpace(id)),
    pool(db.documents.slice(0, 60), 6, (d) => api.document(d.id)),
  ]);
  covers.forEach((ps) => {
    if (!ps) return;
    const year = db.policyYears.find((y) => y.id === ps.selectedPeriodId);
    if (!year) return;
    if (ps.cover.verified && ps.cover.state === "active") {
      year.status = "active";
      const ev = ps.cover.evidence[0];
      const evId = "ev_" + year.id;
      db.evidence.push({ id: evId, label: ev?.label ?? ps.cover.label, at: ev?.recordedAt ?? d0(), documentId: ev?.documentId ?? null, emailId: null, note: ps.cover.reason, clientId: year.clientId });
      year.confirmationEvidenceId = evId;
    } else {
      year.status = ps.cover.label;
    }
    // The server's own words for why, so Ask can say it without deciding anything itself.
    year.coverLabel = ps.cover.label;
    year.coverReason = ps.cover.reason;
  });

  // Work: the four task-status views.
  const seenWork = new Set();
  for (const view of workViews) {
    for (const row of view.items) {
      const it = row.item;
      if (seenWork.has(it.id)) continue;
      seenWork.add(it.id);
      db.workItems.push({
        id: it.id,
        clientId: it.client_id,
        kind: kindWords(it.kind),
        taskStatus: it.task_status,
        statusLabel: it.task_status === "with_party" ? null : STATUS_LABEL[it.task_status] ?? null,
        nextStep: nextMove(it, row),
        opportunityId: it.source_type === "opportunity" ? it.source_id : null,
        title: it.title,
        state: workState(it),
        parties: it.task_status === "with_party" && it.task_party ? [{ name: it.task_party, since: it.task_since }] : [],
        assigneeId: it.owner_id,
        dueAt: it.task_next_check,
        priority: row.priority ?? "medium",
        // What needs doing and why — the step and what it needs — rather than how the item began.
        // Never how the item began ("created from import") — that is provenance, not a reason.
        reason: [nextMove(it, row) ? "Next: " + nextMove(it, row) : null, it.evidence_needed ? "Needs: " + it.evidence_needed : null, it.task_status === "with_party" && it.task_party ? "With " + it.task_party + (it.task_since ? " since " + new Date(it.task_since).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "") : null, it.task_next_check ? "Due " + new Date(it.task_next_check).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null].filter(Boolean).join(" · "),
        createdAt: it.created_at ?? it.task_since ?? d0(),
        policyYearId: it.policy_period_id,
        // What an assignment through the API needs: the version seen and a step to act on.
        version: it.version,
        stepId: row.nowStep?.id ?? it.steps[0]?.id ?? null,
      });
    }
  }

  for (const a of automations.automations) {
    db.automations.push({
      id: a.id,
      name: a.name,
      on: a.enabled,
      ownerId: a.created_by,
      trigger: a.trigger_event.replace(/\./g, " "),
      conditions: a.conditions.length ? a.conditions.map((c) => [c.fact, c.operator, c.value].filter(Boolean).join(" ")).join("; ") : /conditions?\s*(as written|:)/i.test(a.description || "") ? "Written in words, never applied — cannot be enabled" : "None",
      actions: (a.description || a.skill).replace(/\s*·\s*conditions? as written:.*$/i, ""),
      approval: a.approval === "always" ? "A person approves before anything leaves" : "No approval step",
      runs: 0,
      // Saved before conditions were refused: the words were kept but never applied.
      legacyConditions: /conditions?\s*(as written|:)/i.test(a.description || ""),
    });
  }

  for (const o of opportunities.opportunities) {
    db.opportunities.push({ id: o.id, clientId: o.clientId, title: o.title, cls: o.classOfBusiness, createdAt: o.createdAt, ownerId: null, status: o.closedAt ? "Closed" : "Open" });
  }

  for (const e of audit.entries) {
    db.auditEvents.push({
      id: e.id,
      at: e.occurredAt,
      actorId: null,
      actorName: e.actorName,
      // "client.created" → "Client created": the writer's vocabulary, read as words.
      text: e.action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase()) + (e.result === "success" ? "" : " — " + e.result + (e.failureReason ? ": " + e.failureReason : "")),
      clientId: null,
      entity: e.objectId,
      evidenceIds: [],
      kind: e.actorType === "system" ? "system" : "action",
    });
  }

  // The person's latest Ask conversation, from the server (rule 14: a transcript, never records).
  const convo = await convoP;
  db.conversations.push({ id: "cnv_main", messages: convo.messages, contextId: null });

  // Each open quotation in full, so its workspace can show requirements, insurers and replies.
  const details = await detailsP;
  const opportunityDetails = new Map();
  details.forEach((d) => d && opportunityDetails.set(d.opportunity.id, d));

  // A claim's work item opens the claim.
  for (const c of db.claims) {
    const w = db.workItems.find((x) => x.id === c.workItemId);
    if (w) w.claimId = c.id;
  }

  // Each document's reading state and the values read from it, so it can be reviewed.
  const documents = new Map();
  docDetails.forEach((d) => {
    if (!d) return;
    documents.set(d.document.id, d);
    const v = db.documentVersions.find((x) => x.documentId === d.document.id);
    if (v && d.pages.length) v.lines = d.pages.slice(0, 2).flatMap((pg) => pg.text.split(/\n/).filter(Boolean).slice(0, 6));
  });

  // Where each fully reviewed document could be applied, so the choice is ready when it opens.
  const applyTargets = new Map();
  const reviewed = [...documents.values()].filter((d) => d.fields.length && d.fields.every((f) => f.state !== "proposed") && d.fields.some((f) => f.state === "accepted" || f.state === "corrected"));
  const targets = await pool(reviewed, 4, (d) => api.applyTargets(d.document.id));
  reviewed.forEach((d, i) => targets[i] && applyTargets.set(d.document.id, targets[i]));

  // Documents count as working only when every client's documents and every document read back.
  const docsDegraded = (db.meta.unreadableClients || []).length > 0 || docDetails.some((d) => !d) || [...documents.values()].some((d) => d.document.extractionState === "failed");
  db.meta.docsDegraded = docsDegraded;
  const modelConfigured = await modelConfiguredP;

  return { db, extras: { members: members.members, mailboxes, opportunities: opportunityDetails, documents, applyTargets, modelConfigured, conversationId: convo.id } };
}

/** The newest server conversation, as the interface's thread. Empty when there is none. */
async function loadConversation() {
  try {
    const list = await api.conversations();
    const latest = list.conversations[0];
    if (!latest) return { id: null, messages: [] };
    const turns = await api.conversationMessages(latest.id);
    const messages = turns.messages.slice(-40).map((m) => {
      if (m.role === "person") return { role: "user", text: m.body };
      const [lead, ...rest] = m.body.split(/(?<=[.?!])\s/);
      return { role: "ai", lead, text: rest.join(" "), chips: [] };
    });
    return { id: latest.id, messages };
  } catch {
    return { id: null, messages: [] };
  }
}

function d0() {
  return new Date().toISOString();
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NOT_CONNECTED = {
  "records.import": "Importing from the staging list",
  "quote.prepare": "Preparing a quote request from here",
  "email.send": "Sending email",
  "quote.reply": "Recording an insurer reply from here",
  "quote.choice": "Recording the insurer choice from here",
  "placement.create": "Starting a placement from here",
  "placement.approve": "Approving a placement from here",
  "approval.invalidate": "Withdrawing an approval from here",
  "policy.issue": "Issuing a policy from here",
  "servicing.create": "Starting servicing from here",
  "tor.request": "Requesting time on risk",
  "cover.change": "Changing cover or the schedule",
  "claim.register": "Registering a claim by vehicle",
  "claim.document": "Recording claim documents from here",
  "claim.update": "Updating a claim from here",
  "payment.match": "Matching payments",
  "reconcile.run": "Running a reconciliation",
  "reconcile.resolve": "Resolving reconciliation lines",
  "renewal.create": "Creating a renewal year from here",
  "document.version": "Adding a document version",
  "automation.run": "Running an automation by hand",
  "user.role": "Changing roles from here",
  "connection.set": "Changing connections from here",
};

/*
 * Workspaces whose records the API does not serve to this view yet. The engine would otherwise
 * draw them from built-in example content (sample insurers, sample replies, sample rules), which
 * over real records would be invented values — so live mode shows what is missing instead.
 */
const NOT_CONNECTED_WS = {
  compare: "Quote comparison",
  placement: "Placement",
  issue: "Policy issue",
  servicing: "Servicing and time on risk",
  endorsement: "Endorsements",
  money: "Invoices and payments",
  reconciliation: "Reconciliation",
  commission: "Commission",
  renewal: "Renewal",
  report: "Reports",
  investigation: "Investigations",
  onboarding: "Setup",
};

/** Workspaces live mode builds itself (live-spaces.js); the engine's version would be example content. */
const LIVE_WS = new Set(["clients", "newclient", "import", "quote", "settings", "connections"]);

function notConnectedWorkspace(ref) {
  const name = NOT_CONNECTED_WS[ref.ws];
  return {
    kind: name,
    title: name + " is not connected yet",
    status: "draft",
    statusLabel: "Not connected",
    blocks: [
      {
        t: "note",
        tone: "amber",
        title: "Nothing is shown rather than something invented",
        text:
          name +
          " is not yet connected to your brokerage's records in this view, so no values are displayed here. Clients, import, quotation work, claims, documents, automations and settings read and write your real records.",
      },
      {
        t: "rows",
        label: "Where your records are",
        rows: [
          { title: "Today", note: "What needs attention now", badge: "Open", badgeTone: "ok", action: { a: "open", ref: { ws: "today" } } },
          { title: "Work", note: "Everything open in your brokerage", badge: "Open", badgeTone: "ok", action: { a: "open", ref: { ws: "work" } } },
          { title: "Clients", note: "Every client on file", badge: "Open", badgeTone: "ok", action: { a: "open", ref: { ws: "clients" } } },
        ],
      },
    ],
  };
}

const note = (tone, title, text) => ({ t: "note", tone, title, text });

/*
 * Typing is fast and brokers do not proofread questions. Words close to the vocabulary Ask
 * answers from records are corrected before matching, so "wht clints do i hav" reaches the
 * client list rather than a model.
 */
const VOCABULARY = ["what", "which", "show", "list", "many", "clients", "client", "have", "today", "attention", "needs", "work", "automations", "policies", "policy", "claim", "claims", "quote", "quotation", "import", "records", "renewal", "search", "document", "documents", "covered", "cover"];
function distance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function correctTypos(text, protectedWords) {
  return text.replace(/[A-Za-z]{3,}/g, (w) => {
    const lw = w.toLowerCase();
    // A client's own name is never "corrected" into a vocabulary word ("Claire" is not "claims").
    if (VOCABULARY.includes(lw) || protectedWords.has(lw)) return w;
    let best = null;
    for (const v of VOCABULARY) {
      const dist = distance(lw, v);
      const allowed = v.length >= 6 ? 2 : 1;
      if (dist <= allowed && (!best || dist < best.dist)) best = { v, dist };
    }
    return best ? best.v : w;
  });
}

// Suggestions the engine writes around its demo records; never offered over real ones.
const DEMO_WORDS = /\b(Acme|KDN|KDA|Karibu|Bluewave|GreenCare|Mara|APA|CIC|Jubilee)\b/;
const LIVE_CHIPS = ["What needs attention today?", "Show my work", "What clients do I have?"];

async function sha256File(file) {
  return sha256Hex(await file.arrayBuffer());
}

async function base64File(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Strip empty form values, so an optional field left blank is absent rather than "". */
const present = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null));

/** Build the adapters the approved interface talks to, over this brokerage's records. */
export async function loadLiveAdapters({ me, switchToDemo }) {
  let loaded = await hydrate(me);
  let db = loaded.db;
  const pendingFiles = new Map();
  let conversationId = loaded.extras.conversationId;
  // How many thread messages the server already holds; new ones are appended after these.
  let savedCount = (db.conversations.find((c) => c.id === "cnv_main")?.messages || []).length;
  // Set when the server's Ask stored the last question and its answer itself.
  let serverStoredLast = false;
  /** Live-only state the live workspaces read. */
  const state = { me, members: loaded.extras.members, mailboxes: loaded.extras.mailboxes, opportunities: loaded.extras.opportunities, documents: loaded.extras.documents, applyTargets: loaded.extras.applyTargets, applyPreviews: new Map(), docNotice: null, modelConfigured: loaded.extras.modelConfigured, duplicate: null, importPreview: null, importFile: null, importResult: null, importResolutions: new Map() };

  const refresh = async () => {
    const thread = db.conversations.find((c) => c.id === "cnv_main");
    loaded = await hydrate(me);
    db = loaded.db;
    if (thread) Object.assign(db.conversations.find((c) => c.id === "cnv_main"), { messages: thread.messages });
    Object.assign(state, { members: loaded.extras.members, mailboxes: loaded.extras.mailboxes, opportunities: loaded.extras.opportunities, documents: loaded.extras.documents, applyTargets: loaded.extras.applyTargets, modelConfigured: loaded.extras.modelConfigured });
    S.useBackend({ db, dispatch });
  };

  const ok = (text, extra = {}) => ({ ok: true, text, at: d0(), ...extra });
  const fail = (err) => ({ ok: false, error: describeApiError(err) });
  /** Run a write, re-read the records, and report — or report the failure with nothing changed. */
  const write = async (fn, text) => {
    try {
      const out = await fn();
      await refresh();
      return typeof text === "function" ? text(out) : ok(text);
    } catch (e) {
      return fail(e);
    }
  };

  const previewImport = async (basis) => {
    const file = state.importFile;
    if (!file) return { ok: false, error: "Choose the file again — it is no longer selected." };
    try {
      state.importPreview = await api.previewImport({
        filename: file.name,
        content: await base64File(file),
        mimeType: file.type || "application/octet-stream",
        premiumBasis: basis ?? state.importPreview?.batch.premiumBasis ?? null,
      });
      state.importResult = null;
      state.importError = null;
      state.importResolutions = new Map();
      const p = state.importPreview;
      const waiting = p.summary.needsReview;
      return ok("Read " + plural(p.summary.rows, "row", "rows") + " from " + file.name + (p.blocking.length ? " — see what is needed before importing" : waiting ? " — " + plural(waiting, "row needs", "rows need") + " your decision" : " — ready to import"));
    } catch (e) {
      // Kept on the page, not only in a passing toast: a refused file is something to read.
      const dup = e instanceof ApiRequestError && e.code === "already_imported";
      state.importPreview = null;
      state.importError = dup
        ? { title: file.name + " was already imported", text: "This exact file has been imported before, so nothing was read a second time and nothing changed. To add new rows, save them in a new file." }
        : { title: file.name + " could not be read", text: describeApiError(e) };
      return { ok: false, error: state.importError.title + ". " + state.importError.text };
    }
  };

  /** Writes the API can perform. Everything else is refused honestly. */
  const LIVE = {
    // The conversation stays in this browser for this brokerage and person; it is not a record.
    "conversation.save": (p) => {
      const c = db.conversations.find((x) => x.id === p.id);
      if (c) Object.assign(c, { messages: p.messages, contextId: p.contextId });
      const messages = p.messages || [];
      if (messages.length < savedCount) savedCount = 0;
      const fresh = messages.slice(savedCount);
      savedCount = messages.length;
      if (serverStoredLast) {
        serverStoredLast = false;
      } else if (fresh.length) {
        const turns = fresh
          .map((m) => (m.role === "user" ? { role: "person", body: m.text } : { role: "asap", body: [m.lead, m.text].filter(Boolean).join(" ") }))
          .filter((t) => t.body && t.body.trim() && !t.body.startsWith("Good morning. Tell me what you need."))
          .slice(-6);
        if (turns.length)
          void api
            .saveTurns({ conversationId, turns })
            .then((r) => (conversationId = r.conversationId))
            .catch(() => {
              /* the answer stays on screen; the transcript misses this turn and says nothing wrong */
            });
      }
      return ok("Saved");
    },
    "draft.save": (p) => {
      const d = db.drafts.find((x) => x.id === p.id);
      if (d) Object.assign(d, p);
      else db.drafts.push({ ...p, id: p.id || "drf_" + Date.now().toString(36), createdAt: d0() });
      return ok("Draft saved in this session");
    },
    "client.create": async (p) => {
      const name = (p.name || "").trim();
      if (!name) return { ok: false, error: "Type the client's name first." };
      // A closed choice, never coerced: anything but company or person is refused, not defaulted.
      const kind = { corporate: "corporate", company: "corporate", individual: "individual", person: "individual" }[(p.kind || "").trim().toLowerCase()];
      if (!kind) return { ok: false, error: "Choose whether the client is a company or a person." };
      if (name.length < 2) return { ok: false, error: "Give the client's name." };
      try {
        const res = await api.createClient({ name, kind, confirmNew: p.confirmNew === "yes" });
        if (res.outcome === "possible_duplicates") {
          state.duplicate = { name, kind, candidates: res.candidates };
          return { ok: false, error: "A similar client is already on file — check the matches before creating another." };
        }
        state.duplicate = null;
        await refresh();
        return ok(name + " added as a client", { nav: { ws: "client", clientId: res.file.client.id } });
      } catch (e) {
        return fail(e);
      }
    },
    "import.preview": async (p) => {
      const file = pendingFiles.get(p.name);
      if (!file) return { ok: false, error: "The file is no longer selected. Choose it again." };
      pendingFiles.delete(p.name);
      state.importFile = file;
      return previewImport(null);
    },
    "import.basis": (p) => previewImport(p.basis),
    "import.commit": async () => {
      const p = state.importPreview;
      if (!p) return { ok: false, error: "Read a file first." };
      try {
        const resolutions = [...state.importResolutions.entries()].map(([lineNumber, clientId]) => ({ lineNumber, clientId }));
        const res = await api.commitImport(p.batch.id, { resolutions });
        const expected = p.rows.filter((r) => (r.outcome === "create" || r.outcome === "match" || state.importResolutions.has(r.lineNumber)) && r.policyNumber).map((r) => r.policyNumber);
        state.importPreview = null;
        state.importFile = null;
        state.importResolutions = new Map();
        await refresh();
        // Success is claimed only for what can be read back: every imported policy must now be on file.
        const onFile = new Set(db.policies.map((x) => x.number));
        const missing = expected.filter((n) => !onFile.has(n));
        state.importResult = { ...res, unverified: missing.length ? "These policies were reported written but cannot be read back yet: " + missing.join(", ") + ". Refresh records; if they are still missing, tell your administrator." : "" };
        const b = res.batch;
        const parts = [b.policiesCreated ? plural(b.policiesCreated, "policy", "policies") : null, b.clientsCreated ? plural(b.clientsCreated, "new client", "new clients") : "no new clients"].filter(Boolean);
        if (missing.length) return { ok: false, error: "Imported, but " + plural(missing.length, "policy is", "policies are") + " not readable yet: " + missing.join(", ") + "." };
        return ok("Imported " + parts.join("; ") + " from " + b.filename);
      } catch (e) {
        return fail(e);
      }
    },
    "import.resolve": (p) => {
      state.importResolutions.set(p.lineNumber, p.clientId ?? null);
      return ok(p.clientId ? "Line " + p.lineNumber + " will be added to the client you chose" : "Line " + p.lineNumber + " will create a new client");
    },
    "import.template": () => {
      const header = IMPORT_HEADERS.map((h) => h.header.replace(/ /g, "_")).join(",");
      const blob = new Blob([header + "\n"], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "asap-import-template.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return ok("Template downloaded — one row per policy; only client_name is required");
    },
    "import.clear": () => {
      state.importPreview = null;
      state.importFile = null;
      state.importError = null;
      return ok("File discarded — nothing from it was saved");
    },
    "automation.toggle": async (p) => {
      const a = db.automations.find((x) => x.id === p.id);
      if (!a) return { ok: false, error: "That automation is no longer on file." };
      if (!a.on && a.legacyConditions)
        return { ok: false, error: "Cannot enable — conditions are not supported. This automation was saved with conditions in words that ASAP cannot apply, so switching it on would fire where it was told not to. Save a new one without conditions." };
      return write(() => api.setAutomationEnabled(a.id, !a.on), a.name + (a.on ? " is paused" : " is on"));
    },
    "automation.save": async (p) => {
      const words = [p.trigger, p.name].join(" ").toLowerCase();
      const trigger = /renew|expir/.test(words)
        ? "renewal.approaching"
        : /quote|quotation/.test(words)
          ? "quote.received"
          : /document|file|upload/.test(words)
            ? "document.received"
            : /pay|premium received|receipt/.test(words)
              ? "payment.received"
              : /cover.*confirm|confirmation/.test(words)
                ? "cover.confirmed"
                : /claim/.test(words)
                  ? "claim.registered"
                  : /overdue|late|no movement|follow/.test(words)
                    ? "check.overdue"
                    : null;
      if (!trigger)
        return {
          ok: false,
          error: "Say what starts it in the trigger — for example a renewal approaching, a quote or document received, a payment, cover confirmed, a claim registered, or something overdue. Nothing was saved.",
        };
      // Conditions ASAP cannot yet apply are refused, not stored as words: an automation that could
      // be switched on while silently ignoring its conditions would fire where it was told not to.
      if ((p.conditions || "").trim())
        return { ok: false, error: "Conditions written in words cannot be applied yet, so nothing was saved. Leave conditions empty to save an automation that prepares work on every trigger — it still starts switched off and every result needs a person's approval." };
      const name = (p.name || "").trim();
      if (name.length < 3) return { ok: false, error: "Give the automation a name." };
      const description = (p.actions || "").slice(0, 500);
      return write(
        () => api.createAutomation({ name, description, triggerEvent: trigger, conditions: [], skill: (p.actions || "prepare work").slice(0, 80), preparedVerb: "prepare", approval: "always", enabled: false }),
        name + " saved, switched off. It prepares work on every " + trigger.replace(".", " ") + " event; a person approves anything that leaves.",
      );
    },
    "opportunity.create": async (p) => {
      if ((p.title || "").trim().length < 3) return { ok: false, error: "Describe the cover wanted in at least three characters." };
      if ((p.cls || "").trim().length < 3) return { ok: false, error: "Name the class of business, for example Motor commercial." };
      try {
        const res = await api.createOpportunity(present({ clientId: p.clientId, title: p.title, classOfBusiness: p.cls, coverStart: p.coverStart, coverEnd: p.coverEnd, requestKey: crypto.randomUUID() }));
        await refresh();
        const c = db.clients.find((x) => x.id === p.clientId);
        return ok("Quotation work started" + (c ? " for " + c.name : ""), { nav: { ws: "quote", opportunityId: res.opportunityId } });
      } catch (e) {
        return fail(e);
      }
    },
    "opp.action": async (p) => {
      const { id, ...body } = p;
      const clean = present(body);
      if (clean.action === "add_requirement" && (clean.label || "").length < 3) return { ok: false, error: "Name the requirement in at least three characters." };
      if (clean.action === "supply_requirement" && (clean.note || "").length < 10) return { ok: false, error: "Say what proves it — for example where and when the document arrived (at least ten characters)." };
      if (clean.action === "record_response") {
        if (clean.outcome === "quoted") {
          if (!/^\d+(\.\d{1,2})?$/.test(clean.premiumAmount || "")) return { ok: false, error: "Enter the premium as a number, for example 485000." };
          delete clean.declineReason;
        } else {
          delete clean.premiumAmount;
          delete clean.premiumCurrency;
          delete clean.validUntil;
        }
      }
      try {
        const res = await api.opportunityAction(id, clean);
        if (res.outcome === "blocked") return { ok: false, error: res.reason || "The server refused that. Nothing was changed." };
        await refresh();
        return ok(
          { add_insurer: "Insurer added", add_requirement: "Requirement added", supply_requirement: "Requirement marked supplied", record_response: "Insurer's answer recorded" }[clean.action] ?? "Recorded",
        );
      } catch (e) {
        return fail(e);
      }
    },
    "claim.open": async (p) => {
      if (!p.incidentOn || !p.incidentSummary) return { ok: false, error: "Give the date of the loss and what happened." };
      if (!p.policyId) return { ok: false, error: "Choose the policy the loss falls under, or say the policy is not known yet." };
      const policy = p.policyId === "unknown" ? { policyUnknown: true } : { policyId: p.policyId };
      try {
        const res = await api.createWorkItem({ kind: "claim", clientId: p.clientId, incidentOn: p.incidentOn, incidentSummary: p.incidentSummary, source: "manual", ...policy });
        if (res.outcome !== "opened") return { ok: false, error: "The server could not open the claim for this client. Nothing was changed." };
        await refresh();
        const claim = db.claims.find((c) => c.workItemId === res.item.id);
        return ok(res.reopened ? "That claim was already open — opened it" : "Claim reported as a draft", { nav: claim ? { ws: "claim", clientId: p.clientId, claimId: claim.id } : { ws: "work" } });
      } catch (e) {
        return fail(e);
      }
    },
    "doc.review": async (p) => {
      const d = state.documents.get(p.documentId);
      if (!d) return { ok: false, error: "That document is no longer on file." };
      const open = d.fields.filter((f) => f.state === "proposed");
      try {
        let corrected = 0;
        let accepted = 0;
        for (const f of open) {
          const typed = (p[f.id] ?? "").trim();
          if (typed && typed !== (f.proposedValue ?? "")) {
            await api.reviewDocumentField(d.document.id, f.id, { decision: "correct", value: typed });
            corrected++;
          } else if (typed) {
            await api.reviewDocumentField(d.document.id, f.id, { decision: "accept", value: null });
            accepted++;
          }
        }
        // Re-read this one document, not every record, so the page changes as soon as it is saved.
        const fresh = await api.document(d.document.id);
        state.documents.set(fresh.document.id, fresh);
        const targets = await api.applyTargets(fresh.document.id).catch(() => null);
        if (targets) state.applyTargets.set(fresh.document.id, targets);
        state.applyPreviews.delete(fresh.document.id);
        const skipped = open.length - accepted - corrected;
        const text = plural(accepted + corrected, "value", "values") + " confirmed" + (corrected ? ", " + corrected + " as your correction" : "") + (skipped ? "; " + plural(skipped, "empty value was", "empty values were") + " left for later" : "");
        state.docNotice = { documentId: fresh.document.id, title: text, text: "Saved against your name. Next, choose the record to apply them to below — nothing on a record changes until you apply." };
        return ok(text);
      } catch (e) {
        return fail(e);
      }
    },
    "doc.applyPreview": async (p) => {
      const [targetType, targetId] = String(p.target || "").split(":");
      if (!targetType || !targetId) return { ok: false, error: "Choose the record to apply to." };
      try {
        const preview = await api.applyPreview(p.documentId, targetType, targetId);
        state.applyPreviews.set(p.documentId, preview);
        state.docNotice = null;
        return { ok: true, text: "Preview ready — nothing has been written", at: d0() };
      } catch (e) {
        return fail(e);
      }
    },
    "doc.apply": async (p) => {
      const preview = state.applyPreviews.get(p.documentId);
      if (!preview) return { ok: false, error: "Preview the change first. Nothing was written." };
      const usable = preview.fields.filter((f) => !f.blockedBecause && !f.unchanged && f.proposedValue);
      if (!usable.length) return { ok: false, error: "There is nothing to apply. Nothing was written." };
      if (usable.some((f) => f.fieldKey === "premium") && !p.premiumBasis) return { ok: false, error: "Say whether the premium is gross or total payable. Nothing was written." };
      try {
        await api.applyToRecord(p.documentId, {
          targetType: preview.target.targetType,
          targetId: preview.target.targetId,
          idempotencyKey: crypto.randomUUID(),
          fields: usable.map((f) => ({ documentFieldId: f.documentFieldId, fieldKey: f.fieldKey, from: f.currentValue, to: f.proposedValue, ...(f.fieldKey === "premium" ? { premiumBasis: p.premiumBasis } : {}) })),
        });
        state.applyPreviews.delete(p.documentId);
        await refresh();
        const text = plural(usable.length, "value", "values") + " applied to " + preview.target.label;
        state.docNotice = { documentId: p.documentId, title: text, text: "Written with an audit entry against your name. The record now shows these values, with this document as their evidence." };
        return ok(text);
      } catch (e) {
        return fail(e);
      }
    },
    "work.assign": async (p) => {
      const w = db.workItems.find((x) => x.id === p.workItemId);
      const u = db.users.find((x) => x.id === p.userId);
      if (!w || !u) return { ok: false, error: "Choose who this goes to." };
      if (w.assigneeId === u.id) return { ok: false, error: w.title + " is already with " + u.name + ". Nothing was changed." };
      if (!w.stepId) return { ok: false, error: "This item has no steps to hand over yet. Nothing was changed." };
      try {
        const res = await api.act(w.id, { stepId: w.stepId, verb: "assign", version: w.version, assigneeId: u.id });
        if (res && res.outcome && res.outcome !== "applied") return { ok: false, error: res.reason || "The item changed since you opened it. Refresh and try again." };
        await refresh();
        return ok(w.title + " → " + u.name + (p.dueAt ? " (the due date is not recorded by the server yet)" : ""));
      } catch (e) {
        return fail(e);
      }
    },
    "work.create": async (p) => {
      // The API opens renewal and claim work from here; other kinds are not records yet.
      const kind = /renew/i.test(p.kind || "") ? "renewal" : null;
      if (!kind) return { ok: false, error: "Only renewal work can be opened this way; report a claim from + New → Claim." };
      return write(() => api.createWorkItem({ kind, clientId: p.clientId || undefined, source: "ask" }), "Work created: " + p.title);
    },
    "document.upload": async (p) => {
      const file = pendingFiles.get(p.name);
      if (!file) return { ok: false, error: "The file is no longer selected. Choose it again." };
      try {
        const bytes = await file.arrayBuffer();
        const asked = await api.uploadDocument({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          byteSize: file.size,
          contentSha256: await sha256File(file),
          clientId: p.clientId || null,
        });
        if (asked.outcome === "ready") {
          const res = await fetch(asked.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: bytes });
          if (!res.ok) return { ok: false, error: "The file store would not accept the file. Nothing was filed — you can retry." };
          await api.documentFiled(asked.document.id);
        }
        pendingFiles.delete(p.name);
        await refresh();
        // The receipt is given only once the document can be read back, and it opens there.
        if (!db.documents.some((x) => x.id === asked.document.id))
          return { ok: false, error: file.name + " was stored but is not readable yet. Refresh records; if it is still missing, tell your administrator." };
        return ok(asked.outcome === "already_on_file" ? file.name + " is already on file" : file.name + " filed — ASAP is reading it", { nav: { ws: "document", documentId: asked.document.id } });
      } catch (e) {
        return fail(e);
      }
    },
  };

  function dispatch(type, payload = {}, actionId) {
    const key = actionId || type + ":" + JSON.stringify(payload);
    if (db.meta.ledger[key]) return { ...db.meta.ledger[key], duplicate: true };
    const handler = LIVE[type];
    if (!handler) {
      const what = NOT_CONNECTED[type] ?? "This action";
      return { ok: false, error: what + " is not connected to your brokerage's records yet. Nothing was changed." };
    }
    // Only writes that created or changed a record are remembered as done; reads and refusals are not.
    const REPEATABLE = new Set(["conversation.save", "draft.save", "import.preview", "import.basis", "import.clear", "import.resolve", "import.template", "doc.applyPreview"]);
    const settle = (res) => {
      if (res.ok && !REPEATABLE.has(type)) db.meta.ledger[key] = { ...res, actionId: key };
      return res;
    };
    const out = handler(payload);
    return out && typeof out.then === "function" ? out.then(settle) : settle(out);
  }

  function liveWorkspace(ref) {
    if (ref && NOT_CONNECTED_WS[ref.ws]) return notConnectedWorkspace(ref);
    if (ref?.ws === "client" && (db.meta.unreadableClients || []).includes(ref.clientId)) {
      const c = db.clients.find((x) => x.id === ref.clientId);
      return {
        kind: "Client",
        title: c ? c.name : "Client",
        status: "draft",
        statusLabel: "Could not be read",
        ref,
        blocks: [
          note("red", "This client's record could not be read", "The server did not return this client's policies, documents and work, so none are shown — that does not mean there are none. Refresh records; if it persists, tell your administrator."),
        ],
      };
    }
    const own = liveSpace(ref, state);
    if (own) {
      own.ref = ref;
      return own;
    }
    return buildWorkspace(ref);
  }

  async function askServer(text, ctx) {
    try {
      const scope = ctx.clientId ? { kind: "client", id: ctx.clientId } : { kind: "brokerage", id: null };
      const res = await api.askQuestion({ question: text, conversationId, scope });
      conversationId = res.conversationId ?? conversationId;
      // The server stored the question and its answer when it actually answered.
      serverStoredLast = res.state === "answered" || res.state === "abstained" || res.state === "clarify";
      if (res.state === "not_configured")
        return { lead: "No model is configured on the server yet.", text: "I answer from your records directly where I can. Questions beyond that need the server's model, which is not configured for this deployment.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
      if (res.state === "unavailable") {
        const WHY = {
          auth_rejected: ["The model provider rejected this deployment's credentials.", "The server's AI key was refused. Whoever administers the deployment needs to check it; nothing was changed."],
          model_unavailable: ["The configured model is not available.", "The provider says the model this deployment names does not exist or this key may not use it. Nothing was changed."],
          billing: ["The model provider account has no usable credit.", "The provider refused the request for billing reasons. Nothing was changed."],
          rate_limited: ["Too many questions at once — the provider asked us to slow down.", "Nothing was changed. Try again in a minute."],
          timeout: ["The model did not reply in time.", "Nothing was changed. Try again, or ask a shorter question."],
          invalid_output: ["The model's reply could not be used.", "Nothing was changed. Try asking again in different words."],
          invalid_request: ["ASAP could not send this request to the model because its request format was rejected.", "This is a problem on ASAP's side, not with your question. Nothing was changed."],
        };
        const [lead, why] = WHY[res.failure] ?? ["The model provider is temporarily unavailable.", "Nothing was changed. Try again in a moment."];
        return { lead, text: why + (res.requestId ? " Reference: " + res.requestId + "." : ""), ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
      }
      if (res.state === "clarify" && res.clarify)
        return { lead: res.clarify.question, text: "Choose one:", clarify: { question: res.clarify.question, options: res.clarify.options.map((o) => ({ label: o.label, text: o.label })) }, ref: null, keepWorkspace: true };
      const body = res.message?.body || "I could not find that in your records.";
      const cites = (res.message?.citations || []).map((c) => c.label).slice(0, 4);
      return {
        lead: res.state === "abstained" ? "I could not find that in your records." : body.split(/(?<=\.)\s/)[0],
        text: (res.state === "abstained" ? body : body.split(/(?<=\.)\s/).slice(1).join(" ")) + (cites.length ? " Sources: " + cites.join("; ") + "." : ""),
        ref: null, keepWorkspace: true,
        chips: res.suggestions.length ? res.suggestions : LIVE_CHIPS,
      };
    } catch (e) {
      return { lead: "I could not reach the server.", text: describeApiError(e) + " Nothing was changed.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
    }
  }

  /**
   * "Is cover active on this policy / on POL-…?" — answered from the server's cover check for
   * that policy, never from the vehicle check. An explicit policy number wins; then the policy
   * open in front; then the only policy of the client open in front. Anything else is one
   * clarifying question — never a guessed client and never a workspace built on nothing.
   * A vehicle registration in the question leaves it to the vehicle check.
   */
  function policyCoverAnswer(t, ctx) {
    if (!/\bcover(ed|age)?\b|\bin force\b|\bon risk\b/i.test(t)) return null;
    if (/\b[kK][a-zA-Z]{2}\s?\d{3}[a-zA-Z]?\b/.test(t)) return null; // a registration: the vehicle check
    const byNumber = db.policies.find((p) => p.number && p.number !== "Number not recorded" && new RegExp("\\b" + p.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(t));
    const mentionsPolicy = /\b(polic(y|ies)|this|it)\b/i.test(t);
    let year = null;
    if (byNumber) {
      year = db.policyYears.filter((y) => y.policyId === byNumber.id).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
    } else if (mentionsPolicy && ctx.policyYearId) {
      year = db.policyYears.find((y) => y.id === ctx.policyYearId) ?? null;
    } else if (mentionsPolicy && ctx.policyId) {
      year = db.policyYears.filter((y) => y.policyId === ctx.policyId).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
    } else if (mentionsPolicy && ctx.clientId) {
      const pols = db.policies.filter((p) => p.clientId === ctx.clientId);
      if (pols.length === 1) year = db.policyYears.filter((y) => y.policyId === pols[0].id).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
      else if (pols.length > 1)
        return { lead: "Which policy?", text: "This client has more than one policy; I will not pick one.", clarify: { question: "Policy", options: pols.map((p) => ({ label: p.number, text: "Is cover active on " + p.number + "?" })) }, ref: null, keepWorkspace: true };
    }
    if (!year) {
      if (!mentionsPolicy && !byNumber) return null;
      return { lead: "Which policy do you mean?", text: "Name the policy number, or open the policy first. I will not guess which record you mean.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
    }
    const pol = db.policies.find((p) => p.id === year.policyId);
    const client = db.clients.find((c) => c.id === year.clientId);
    const active = year.status === "active";
    return {
      lead: (pol?.number ?? "This policy") + (active ? " has active cover." : ": " + (year.coverLabel || "cover not verified") + "."),
      text: (year.coverReason ? year.coverReason + " " : "") + (client ? "Client " + client.name + ". " : "") + "Period " + S.fmtDate(year.from) + " – " + S.fmtDate(year.to) + ", " + year.insurer + ". ASAP reports what the insurer's records show; it does not decide cover.",
      ref: { ws: "policy", clientId: year.clientId, policyYearId: year.id },
      chips: LIVE_CHIPS,
    };
  }

  async function liveRoute(text, ctx) {
    const names = new Set(db.clients.flatMap((c) => c.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
    const t = correctTypos(text.trim(), names);
    // Questions about the client list, answered from the records — including when there are none.
    // Only a question *for the list*: "clients" is what is asked for, and no other record is named.
    // "Which policies does this client have?" is about one client's policies, not the list.
    const CLIENT_LIST = /^(what|which|list|show( me)?( all)?( my)?|how many|who are)\b[^?]*\bclients\b/i;
    const OTHER_RECORD = /\b(polic(y|ies)|claims?|documents?|quot(e|es|ation|ations)|renewals?|work|premiums?|invoices?|payments?|contacts?|emails?|this client|the client)\b/i;
    if (CLIENT_LIST.test(t) && !OTHER_RECORD.test(t) && !/\b(add|create)\b/i.test(t)) {
      const n = db.clients.length;
      return n
        ? { lead: "You have " + n + " client" + (n === 1 ? "" : "s") + ".", text: "They are listed in the workspace beside this answer.", ref: { ws: "clients" }, chips: LIVE_CHIPS }
        : { lead: "You do not have any clients yet.", text: "Import your book, or add your first client by name — say “add Tausi Hauliers as a client”.", ref: { ws: "clients" }, chips: ["Import records", "Add a client"] };
    }
    const add = /\b(?:add|create)\s+(.+?)\s+as\s+an?\s+(?:new\s+)?client\b/i.exec(t);
    if (add) return { lead: "Adding " + add[1] + " as a client.", text: "ASAP checks for a client with a similar name first.", ref: { ws: "newclient" }, plan: { action: "client.create", payload: { name: add[1], kind: "Company" }, actionId: "client.create:" + add[1].toLowerCase() } };
    if (/^(import( records)?|add a client|new client)$/i.test(t)) return { lead: "Opening it.", text: "", ref: { ws: /import/i.test(t) ? "import" : "newclient" } };

    if (/\bclaim\b/i.test(t) && /\b(report|register|new|open|file|log)\b/i.test(t)) {
      const client = S.sel.clientByName(t) || (ctx.clientId ? S.sel.client(ctx.clientId) : null);
      return { lead: client ? "Reporting a claim for " + client.name + "." : "Which client is the claim for?", text: "The claim opens as a draft; it never means the loss is covered.", ref: { ws: "claim", clientId: client?.id } };
    }
    const cover = policyCoverAnswer(t, ctx);
    if (cover) return cover;
    const r = interpret(t, ctx) || {};
    // The vehicle check needs a vehicle. Without a registration it asks, rather than opening a
    // cover workspace about nothing ("null is not on a confirmed schedule").
    if (r.ref && r.ref.ws === "coverage" && !r.ref.reg)
      return { lead: "Which vehicle or policy?", text: "Give the registration or the policy number, or open the policy first. Nothing was opened.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
    if (r.nothing) return askServer(text.trim(), ctx);
    if (Array.isArray(r.chips) && r.chips.some((c) => DEMO_WORDS.test(typeof c === "string" ? c : c.label ?? ""))) r.chips = LIVE_CHIPS;
    if (r.ref && NOT_CONNECTED_WS[r.ref.ws]) {
      return { ...r, lead: NOT_CONNECTED_WS[r.ref.ws] + " is not connected to your records yet.", text: "I opened the workspace so you can see that nothing is shown there yet.", plan: null, chips: LIVE_CHIPS };
    }
    if (r.ref && LIVE_WS.has(r.ref.ws)) {
      // The engine's answer for these was written around its example records; the workspace speaks for itself.
      return { ...r, lead: "Opening it from your records.", text: "The workspace beside this answer is read from your brokerage's records.", plan: null, chips: LIVE_CHIPS };
    }
    if (r.plan && !LIVE[r.plan.action]) r.plan = null;
    return r;
  }

  S.useBackend({ db, dispatch });

  return {
    greetingChips: LIVE_CHIPS,
    savingNote: "Saving to your brokerage's records…",
    suggestions: [{ label: "What needs attention today?" }, { label: "What clients do I have?" }, { label: "Show my work" }, { label: "Search every record" }],
    historyNote: "Kept with your brokerage on the server, so it follows you to any browser. It is a transcript of asking, never a record.",
    persistence: { init: () => S.init(), reset: () => S.getDb(), resetSummary: () => ({ removes: "", restores: "" }), snapshot: () => S.getDb() },
    records: {
      demo: false,
      sel: S.sel,
      all: S.all,
      byId: S.byId,
      where: S.where,
      act: (type, payload, actionId) => S.dispatch(type, payload, actionId),
      can: S.can,
      roles: S.ROLES,
      approverFor: S.approverFor,
      session: S.session,
      actor: S.actor,
      setUser: () => {},
      modeLinks: [
        { title: "Refresh records", note: "Read your brokerage's records again", go: () => void refresh() },
        { title: "Open the demo", note: "Fictional records, kept in this browser only", go: switchToDemo },
        { title: "Sign out", note: me.user.email, go: () => void supabase.auth.signOut().then(() => window.location.assign("/sign-in")) },
      ],
    },
    documents: {
      async read(file) {
        pendingFiles.set(file.name, file);
        return {
          name: file.name,
          kind: (file.type || "file") + " · " + Math.round(file.size / 1024) + " KB",
          bytes: file.size,
          lines: ["Selected from your device: " + file.name, "It is read by ASAP's own extraction service once filed."],
          extracted: "read after filing",
        };
      },
      classify(file) {
        const n = file.name.toLowerCase();
        if (/\.(xlsx|xls|csv)$/.test(n)) return "Spreadsheet";
        if (/\.pdf$/.test(n)) return "PDF";
        if (/\.(png|jpe?g|heic)$/.test(n)) return "Image";
        if (/\.eml$/.test(n)) return "Email";
        return "File";
      },
    },
    email: {
      connected: () => false,
      async send() {
        return { ok: false, error: "Sending email is not connected yet. Your draft is kept." };
      },
    },
    ai: { latencyMs: 200, configured: () => false, route: liveRoute, workspace: liveWorkspace, parseDate, tools: Object.keys(LIVE) },
  };
}
