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
import { AUTOMATION_REGISTRY, automationProblems, draftProblems } from "@asap/schema";
import { api, ApiRequestError, describeApiError } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import * as S from "./engine/store.js";
import { buildWorkspace, interpret, parseDate } from "./engine/intent.js";
import { IMPORT_HEADERS, liveSpace, plural, requestDraft } from "./live-spaces.js";

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
const shortDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/** The server's next action in one line: what, what is missing, who holds it, when to look again. */
const nextWords = (n) =>
  [
    "Next: " + n.what,
    n.missing?.length ? "Missing: " + n.missing.join(", ") : null,
    n.holder === "outside_party" && n.party ? "With " + n.party + (n.since ? " since " + shortDay(n.since) : "") : null,
    n.checkAt ? "Look again " + shortDay(n.checkAt) : null,
  ].filter(Boolean).join(" · ");
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
    // The audit history is for roles that may read it; asking without that permission is a refusal.
    (me.permissions ?? []).includes("audit:view") ? api.audit().catch(() => ({ entries: [] })) : Promise.resolve({ entries: [] }),
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
    // The quotation and, beside it, whether its comparison is ready: both from the server.
    async (o) => {
      const d = await api.opportunity(o.id);
      if (!d) return d;
      const cmp = typeof api.comparison === "function" ? await api.comparison(o.id).catch(() => null) : null;
      return { ...d, comparisonView: cmp ?? null };
    },
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
        // The server's next action (D-120) — the same object Today, Ask and the Space read.
        next: row.next ?? null,
        nextStep: row.next?.what ?? nextMove(it, row),
        opportunityId: it.source_type === "opportunity" ? it.source_id : null,
        title: it.title,
        state: workState(it),
        parties: it.task_status === "with_party" && it.task_party ? [{ name: it.task_party, since: it.task_since }] : [],
        assigneeId: it.owner_id,
        dueAt: it.due_on ?? null,
        nextCheckAt: it.task_next_check,
        priority: row.priority ?? "medium",
        // What needs doing and why — the step and what it needs — rather than how the item began.
        // Never how the item began ("created from import") — that is provenance, not a reason.
        reason: row.next ? nextWords(row.next) : [nextMove(it, row) ? "Next: " + nextMove(it, row) : null, it.evidence_needed ? "Needs: " + it.evidence_needed : null, it.task_status === "with_party" && it.task_party ? "With " + it.task_party + (it.task_since ? " since " + new Date(it.task_since).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "") : null, it.task_next_check ? "Due " + new Date(it.task_next_check).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null].filter(Boolean).join(" · "),
        createdAt: it.created_at ?? it.task_since ?? d0(),
        policyYearId: it.policy_period_id,
        // What an assignment through the API needs: the version seen and a step to act on.
        version: it.version,
        stepId: row.nowStep?.id ?? it.steps[0]?.id ?? null,
      });
    }
  }

  // Each automation's history and last test, from the server: the last real run, any failure, and
  // what test mode last found. Nothing about an automation's state is kept in the browser.
  const autoFacts = new Map(
    await Promise.all(
      automations.automations.slice(0, 20).map(async (a) => {
        const [runs, last] = await Promise.all([
          typeof api.automationRuns === "function" ? api.automationRuns(a.id).catch(() => ({ runs: [] })) : { runs: [] },
          typeof api.automationLastTest === "function" ? api.automationLastTest(a.id).catch(() => ({ lastTest: null })) : { lastTest: null },
        ]);
        return [a.id, { runs: runs.runs, lastTest: last.lastTest, raw: a }];
      }),
    ),
  );
  for (const a of automations.automations) {
    const f = autoFacts.get(a.id);
    db.automations.push({
      raw: a,
      history: f?.runs ?? [],
      lastTest: f?.lastTest ?? null,
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
      // The person the audit row names (D-124): never replaced by "system" for want of a lookup.
      actorId: e.actorId ?? null,
      actorName: e.actorName,
      actorType: e.actorType,
      actorLabel: e.actorLabel ?? null,
      action: e.action,
      result: e.result,
      failureReason: e.failureReason,
      changed: e.changed,
      evidence: e.evidence,
      client: e.client ?? null,
      record: e.record ?? null,
      workItemId: e.workItemId ?? null,
      external: !!e.external,
      coverOrMoney: !!e.coverOrMoney,
      // "client.created" → "Client created": the writer's vocabulary, read as words.
      text: e.action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase()) + (e.result === "success" ? "" : " — " + e.result + (e.failureReason ? ": " + e.failureReason : "")),
      clientId: e.client?.id ?? null,
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

  // Each claim in full — its documents, notes and clock — so its Space reads the record, not a template.
  const claimDetails = new Map();
  const claimRows = await pool(db.claims.slice(0, 40), 4, (c) => (c.workItemId ? api.workItem(c.workItemId) : null));
  db.claims.slice(0, 40).forEach((c, i) => claimRows[i]?.claim && claimDetails.set(c.id, { ...claimRows[i].claim, item: claimRows[i].item }));

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

  return { db, extras: { members: members.members, mailboxes, opportunities: opportunityDetails, documents, applyTargets, claims: claimDetails, modelConfigured, conversationId: convo.id } };
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
const LIVE_WS = new Set(["clients", "newclient", "newcontact", "import", "quote", "settings", "connections", "activity", "audit", "automation"]);

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
const VOCABULARY = ["what", "which", "show", "list", "many", "clients", "client", "have", "today", "attention", "needs", "work", "automations", "policies", "policy", "claim", "claims", "quote", "quotation", "import", "records", "renewal", "search", "document", "documents", "covered", "cover", "report", "register", "accident", "open"];
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

// One rule for an unsafe draft, shared with the API that refuses to prepare one (D-123).
export { draftProblems };

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
  const state = { me, members: loaded.extras.members, mailboxes: loaded.extras.mailboxes, opportunities: loaded.extras.opportunities, documents: loaded.extras.documents, applyTargets: loaded.extras.applyTargets, claims: loaded.extras.claims, applyPreviews: new Map(), docNotice: null, modelConfigured: loaded.extras.modelConfigured, duplicate: null, importPreview: null, importFile: null, importResult: null, importResolutions: new Map() };

  const refresh = async () => {
    const thread = db.conversations.find((c) => c.id === "cnv_main");
    loaded = await hydrate(me);
    db = loaded.db;
    if (thread) Object.assign(db.conversations.find((c) => c.id === "cnv_main"), { messages: thread.messages });
    Object.assign(state, { members: loaded.extras.members, mailboxes: loaded.extras.mailboxes, opportunities: loaded.extras.opportunities, documents: loaded.extras.documents, applyTargets: loaded.extras.applyTargets, claims: loaded.extras.claims, modelConfigured: loaded.extras.modelConfigured });
    S.useBackend({ db, dispatch });
  };

  const ok = (text, extra = {}) => ({ ok: true, text, at: d0(), ...extra });
  const fail = (err) => ({ ok: false, error: describeApiError(err).replace(/\.?\s*$/, ".") + " Nothing was changed — you can retry." });
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
        if (res.outcome !== "created" && res.outcome !== "already_on_file") return { ok: false, error: "That was not saved. Nothing was changed." };
        state.duplicate = null;
        await refresh();
        const id = res.file.client.id;
        // Success is claimed only when the client can be read back.
        if (!db.clients.some((c) => c.id === id)) return { ok: false, error: name + " was saved but is not showing yet. Refresh records to check before trying again." };
        const already = res.outcome === "already_on_file";
        return ok(already ? name + " was already a client — nothing new was created" : name + " added as a client", {
          already,
          detail: already ? "Opened the existing client file." : "Written to your brokerage’s records with an audit entry against your name. No message was sent.",
          nav: { ws: "client", clientId: id },
          receipt: { action: already ? "Client already on file" : "Client added", record: name, outcome: already ? "Already done" : "Done", changed: already ? [] : ["One client record and its client file"], unchanged: ["No contact was added yet", "No message was sent to anyone"], next: "Add the primary contact", audit: already ? null : "client.created" },
          next: [
            { label: "Add contact", ref: { ws: "newcontact", clientId: id } },
            { label: "Record insurance need", ref: { ws: "quote", clientId: id } },
            { label: "Start quotation", ref: { ws: "quote", clientId: id } },
            { label: "Upload document", ref: { ws: "client", clientId: id } },
          ],
        });
      } catch (e) {
        return fail(e);
      }
    },
    "contact.create": async (p) => {
      const fullName = (p.fullName || "").trim();
      if (fullName.length < 2) return { ok: false, error: "Give the contact's full name." };
      const email = (p.email || "").trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That does not look like an email address. Nothing was saved." };
      try {
        await api.createContact({ clientId: p.clientId, fullName, roleLabel: (p.roleLabel || "").trim() || null, email: email || null, phone: (p.phone || "").trim() || null, isPrimary: true });
        await refresh();
        const c = db.clients.find((x) => x.id === p.clientId);
        return ok(fullName + " added as the primary contact" + (c ? " for " + c.name : ""), { detail: "No message was sent to them.", nav: { ws: "client", clientId: p.clientId } });
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
        state.importResult = { ...res, unverified: missing.length ? "These policies were saved but aren’t showing yet: " + missing.join(", ") + ". Refresh records; if they are still missing, tell your administrator." : "" };
        const b = res.batch;
        const parts = [b.policiesCreated ? plural(b.policiesCreated, "policy", "policies") : null, b.clientsCreated ? plural(b.clientsCreated, "new client", "new clients") : "no new clients"].filter(Boolean);
        // Some of it written and some not is its own outcome — never a success, never a plain failure.
        const failed = (res.failures ?? []).length;
        if (missing.length || failed)
          return ok("Imported " + parts.join("; ") + " from " + b.filename, { partial: [failed ? plural(failed, "line was", "lines were") + " not imported" : null, missing.length ? plural(missing.length, "policy is", "policies are") + " not readable yet: " + missing.join(", ") : null].filter(Boolean).join("; ") + ".", detail: "What was written is on file with an audit entry; the rest was not written." });
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
    /*
     * A new automation from the registry (D-125): structured parts, each validated against the
     * shared registry before anything is sent, and again by the server. Words that are not an
     * executable part are refused with the reason — they are never saved as if they ran.
     */
    "automation.create": async (p) => {
      const conditions = Array.isArray(p.conditions) ? p.conditions : p.fact ? [{ fact: p.fact, operator: p.operator, value: p.value === undefined || p.value === "" ? null : /^(days_)/.test(p.operator || "") ? Number(p.value) : String(p.value).includes(",") ? String(p.value).split(",").map((v) => v.trim()).filter(Boolean) : p.value }] : [];
      const action = AUTOMATION_REGISTRY.actions.find((x) => x.verb === p.verb);
      const input = { name: (p.name || "").trim(), description: (p.description || "").trim().slice(0, 500), triggerEvent: p.trigger, conditions, skill: action?.skill ?? "", preparedVerb: p.verb, approval: action?.approvalRequired ? "always" : p.approval === "never" ? "never" : "always", enabled: false };
      if (input.name.length < 3) return { ok: false, error: "Give the automation a name of at least three characters. Nothing was saved." };
      const problems = automationProblems(input);
      if (problems.length) return { ok: false, error: "This cannot run as written: " + problems.join("; ") + ". Nothing was saved." };
      try {
        const res = await api.createAutomation(input);
        await refresh();
        return ok(input.name + " saved, switched off", { nav: { ws: "automation", automationId: res.automation.id }, detail: "Run it in test mode, then switch it on. It prepares; a person approves anything that leaves the brokerage, and any change to cover or money.", receipt: { action: "Automation saved", record: input.name, outcome: "Done", changed: ["A standing instruction, switched off"], unchanged: ["Nothing runs until it is switched on", "No work was prepared"], next: "Run it in test mode", audit: "automation.created" } });
      } catch (e) {
        return fail(e);
      }
    },
    "automation.test": async (p) => {
      try {
        const res = await api.testAutomation(p.id);
        await refresh();
        return ok("Test mode: it would act on " + plural(res.wouldFire.length, "open item", "open items") + " of " + res.checked + " checked", { detail: res.problems.length ? "It cannot run as saved: " + res.problems.join("; ") + "." : "Nothing was prepared or written, apart from recording that the test ran." });
      } catch (e) {
        return fail(e);
      }
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
    "opportunity.create": async (p, requestKey) => {
      if ((p.title || "").trim().length < 3) return { ok: false, error: "Describe the cover wanted in at least three characters." };
      if ((p.cls || "").trim().length < 3) return { ok: false, error: "Name the class of business, for example Motor commercial." };
      try {
        const res = await api.createOpportunity(present({ clientId: p.clientId, title: p.title, classOfBusiness: p.cls, coverStart: p.coverStart, coverEnd: p.coverEnd, requestKey: requestKey ?? crypto.randomUUID() }));
        await refresh();
        const c = db.clients.find((x) => x.id === p.clientId);
        return ok("Quotation work started" + (c ? " for " + c.name : ""), { nav: { ws: "quote", opportunityId: res.opportunityId }, detail: "Written with an audit entry against your name.", receipt: { action: "Quotation work started", record: (c ? c.name + " — " : "") + p.title, outcome: "Done", changed: ["The quotation and its Work item, owned by you"], unchanged: ["No insurer was asked", "No request was prepared or sent"], next: state.opportunities.get(res.opportunityId)?.next?.what ?? "Record the requirements and choose the insurers", audit: "opportunity.created" } });
      } catch (e) {
        return fail(e);
      }
    },
    "comparison.generate": async (p) => {
      try {
        const res = await api.comparisonAction(p.id, { action: "generate_comparison" });
        if (res.outcome === "blocked") return { ok: false, error: res.reason || "The comparison cannot be built yet. Nothing was changed." };
        await refresh();
        return ok("Comparison built from the recorded quotes", { nav: { ws: "quote", opportunityId: p.id }, detail: "Built from the premiums and terms on file. Nothing was sent to the client.", receipt: { action: "Comparison built", record: "Quotation comparison", outcome: "Done", changed: ["A comparison of the recorded quotes"], unchanged: ["The quotes themselves", "Nothing was sent to the client"], next: "Review it, then present it to the client", audit: "comparison.generated" } });
      } catch (e) {
        return fail(e);
      }
    },
    "opp.action": async (p) => {
      const { id, ...body } = p;
      const clean = present(body);
      if (clean.action === "add_requirement" && (clean.label || "").length < 3) return { ok: false, error: "Name the requirement in at least three characters." };
      if (clean.action === "supply_requirement" && (clean.note || "").length < 10) return { ok: false, error: "Say what proves it — for example where and when the document arrived (at least ten characters)." };
      if (clean.action === "record_delivery") {
        if ((clean.reference || "").length < 3) return { ok: false, error: "Say what proves it — the email subject and time, a portal reference, or who received it." };
        if (clean.deliveredOn) clean.deliveredAt = new Date(clean.deliveredOn + "T12:00:00+03:00").toISOString();
        delete clean.deliveredOn;
      }
      if (clean.action === "prepare_request" && ((clean.subject || "").length < 3 || (clean.body || "").length < 20)) return { ok: false, error: "Give the request a subject and write what the insurer should quote on." };
      if (clean.action === "record_response") {
        clean.withoutRequest = clean.withoutRequest === "yes" ? true : undefined;
        if (clean.withoutRequest === undefined) delete clean.withoutRequest;
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
        if (res.outcome === "blocked") return /may not/i.test(res.reason || "") ? { ok: false, denied: true, reason: res.reason } : { ok: false, error: res.reason || "That couldn’t be done. Nothing was changed." };
        await refresh();
        const o = res.opportunity;
        const label = ({ add_insurer: "Insurer added", add_requirement: "Requirement added", supply_requirement: "Requirement marked supplied", prepare_request: "Request prepared", approve_request: "Request approved", record_delivery: "Delivery recorded", record_response: "Insurer's reply recorded" })[clean.action] ?? "Recorded";
        const receipt = { action: label, record: o ? o.client.name + " — " + o.opportunity.title : "Quotation", outcome: res.outcome === "already" ? "Already done" : "Done", changed: res.outcome === "already" ? [] : [label], unchanged: ["Nothing was sent to any insurer from ASAP", "No cover or money changed"], next: o?.next?.what ?? null, audit: res.outcome === "already" ? null : "opportunity." + clean.action };
        return ok(
          ({ add_insurer: "Insurer added", add_requirement: "Requirement added", supply_requirement: "Requirement marked supplied", prepare_request: "Request prepared for approval — nothing was sent", approve_request: "Request approved — it has not been sent", record_delivery: "Delivery recorded — the insurer now holds the request", record_response: "Insurer's reply recorded" }[clean.action] ?? "Recorded") + (res.outcome === "already" ? " (already done — nothing recorded twice)" : ""),
          { detail: "Written with an audit entry against your name.", nav: { ws: "quote", opportunityId: id }, receipt, already: res.outcome === "already" },
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
        if (res.outcome !== "opened") return { ok: false, error: "The claim couldn’t be opened for this client. Nothing was changed." };
        await refresh();
        const claim = db.claims.find((c) => c.workItemId === res.item.id);
        // Success is claimed only when the claim reads back.
        if (!claim) return { ok: false, error: "The claim was saved but is not showing yet. Refresh records to check before reporting it again." };
        return ok(res.reopened ? "That claim was already open — nothing new was created" : "Claim reported as a draft — not registered", {
          already: !!res.reopened,
          detail: "No message was sent to the insurer, and nothing here says the loss is covered. The documents it needs are listed on the claim.",
          nav: { ws: "claim", clientId: p.clientId, claimId: claim.id },
          receipt: { action: res.reopened ? "Claim already open" : "Claim reported as a draft", record: (db.clients.find((c) => c.id === p.clientId)?.name ?? "Client") + " — loss of " + S.fmtDate(p.incidentOn), outcome: res.reopened ? "Already done" : "Done", changed: res.reopened ? [] : ["One draft claim and its Work item, looked at again in two days"], unchanged: ["Not registered with the insurer", "No message was sent", "Nothing says the loss is covered"], next: db.workItems.find((w) => w.id === res.item.id)?.next?.what ?? "Collect the claim form and supporting documents", audit: res.reopened ? null : "claim.created" },
          next: [{ label: "Open the claim", ref: { ws: "claim", clientId: p.clientId, claimId: claim.id } }, { label: "Open the client", ref: { ws: "client", clientId: p.clientId } }],
        });
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
    /*
     * Owner and due date (D-122). Ask's plan and the Work Space's "Owner and due date" block both
     * land here, and this calls the one server contract — nothing about the change is decided in
     * the browser. `dueAt` may be given alone: changing a due date is the same action.
     */
    "work.assign": async (p) => {
      const w = db.workItems.find((x) => x.id === p.workItemId);
      if (!w) return { ok: false, error: "That work is not in your brokerage’s records. Nothing was changed." };
      const u = p.userId ? db.users.find((x) => x.id === p.userId) : null;
      if (p.userId && !u) return { ok: false, error: "Choose who this goes to — that person is not a member here. Nothing was changed." };
      if (!u && !p.dueAt) return { ok: false, error: "Say who this goes to, or the new due date. Nothing was changed." };
      const input = { version: w.version, ...(u ? { ownerId: u.id } : {}), ...(p.dueAt ? { dueOn: String(p.dueAt).slice(0, 10) } : {}) };
      try {
        const res = await api.manageWork(w.id, input);
        if (res.outcome === "blocked") return res.guard === "permission" ? { ok: false, denied: true, reason: res.reason } : { ok: false, error: res.reason };
        await refresh();
        const changed = res.changes.map((c) => c.label + ": " + (c.from ?? "—") + " → " + (c.to ?? "—"));
        if (res.outcome === "already_done")
          return ok(w.title + " — already so", { already: true, detail: "Nothing needed changing, so nothing was written.", receipt: { action: "Owner and due date", record: w.title, outcome: "Already done", changed: [], unchanged: ["Owner", "Due date", "Next check"], next: w.next?.what ?? null, audit: null } });
        const fresh = db.workItems.find((x) => x.id === w.id) ?? w;
        return ok(changed.join(" · ") || w.title, {
          detail: "Written with an audit entry against your name. No message was sent to anyone.",
          nav: { ws: "workitem", workItemId: w.id },
          receipt: { action: u && p.dueAt ? "Owner and due date changed" : u ? "Work assigned" : "Due date changed", record: w.title, outcome: "Done", changed, unchanged: ["The work’s status and next step", "Nothing was sent outside the brokerage"], next: fresh.next?.what ?? null, audit: res.auditAction },
        });
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

  // Writes in flight, by action key: a second click while the first is saving joins it, so the
  // server sees one request. Kept in memory only — never browser storage.
  const inflight = new Map();
  // One idempotency key per action, so a retry after a lost response is the same request.
  const requestKeys = new Map();
  const requestKeyFor = (key) => {
    if (!requestKeys.has(key)) requestKeys.set(key, crypto.randomUUID());
    return requestKeys.get(key);
  };

  function dispatch(type, payload = {}, actionId) {
    const key = actionId || type + ":" + JSON.stringify(payload);
    if (db.meta.ledger[key]) return { ...db.meta.ledger[key], duplicate: true };
    if (inflight.has(key)) return inflight.get(key);
    const no = refusal(type);
    if (no) return { ok: false, denied: true, reason: no.lead + " " + no.text };
    const handler = LIVE[type];
    if (!handler) {
      const what = NOT_CONNECTED[type] ?? "This action";
      return { ok: false, error: what + " is not connected to your brokerage's records yet. Nothing was changed." };
    }
    // Only writes that created or changed a record are remembered as done; reads and refusals are not.
    const REPEATABLE = new Set(["conversation.save", "draft.save", "import.preview", "import.basis", "import.clear", "import.resolve", "import.template", "doc.applyPreview"]);
    const settle = (res) => {
      if (res.ok && !REPEATABLE.has(type)) db.meta.ledger[key] = { ...res, actionId: key };
      // The action a card was waiting on is done: it is no longer pending, and its receipt is the latest.
      if (res.ok && convo.pendingAction && convo.pendingAction.actionId === key) {
        convo.latestReceipt = { actionId: key, text: res.text, at: res.at };
        convo.pendingAction = null;
      }
      return res;
    };
    const out = handler(payload, requestKeyFor(key));
    if (!(out && typeof out.then === "function")) return settle(out);
    const p = out.then(settle).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
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
          note("red", "This client's record could not be read", "We couldn’t load this client’s policies, documents and work just now, so none are shown — that doesn’t mean there are none. Refresh records; if it keeps happening, tell your administrator."),
        ],
      };
    }
    const own = liveSpace(ref, state);
    if (own) {
      own.ref = ref;
      return own;
    }
    return guardLive(buildWorkspace(ref));
  }

  /**
   * The last check on anything the approved engine builds in live mode. No draft may carry an
   * invented recipient (the engine's demo addresses end in "@insurer.demo") or a send control
   * without a real, recorded address; and no user-facing text may show a bare "undefined" or
   * "null". A draft that cannot be addressed says so instead of offering "Review and send".
   */
  function guardLive(ws) {
    if (!ws || !Array.isArray(ws.blocks)) return ws;
    const clean = (v) =>
      typeof v === "string"
        ? v.replace(/\b(undefined|null|NaN)\b/g, "not recorded")
        : Array.isArray(v)
          ? v.map(clean)
          : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "action" || k === "ref" || k === "payload" || k === "nav" ? x : clean(x)]))
            : v;
    const fake = (e) => !e || /@insurer\.demo$|@example\./i.test(String(e));
    ws.blocks = ws.blocks.map((b) => {
      if (b && b.t === "email") {
        const to = [b.to, ...((b.send?.payload?.recipients ?? []).map((r) => r.email))];
        if (to.some(fake) || !b.to)
          return note("amber", (b.label || "Message") + " — not prepared", "No recipient address is on file for this, so ASAP will not prepare a message. Nothing has been sent. Add the insurer's contact first; any message will then wait for your approval.");
        const problems = draftProblems({ ...b, recipients: (b.send?.payload?.recipients ?? []).map((r) => r.email) });
        if (problems.length)
          return note("amber", (b.label || "Message") + " — cannot be sent", "Sending is off because " + problems.join("; ") + ". Nothing has been sent.");
      }
      if (b && b.t === "gate" && b.action === "email.send") return null;
      return clean(b);
    }).filter(Boolean);
    ws.title = clean(ws.title);
    return ws;
  }

  async function askServer(text, ctx) {
    try {
      const scope = ctx.clientId ? { kind: "client", id: ctx.clientId } : { kind: "brokerage", id: null };
      const res = await api.askQuestion({ question: text, conversationId, scope });
      conversationId = res.conversationId ?? conversationId;
      // The server stored the question and its answer when it actually answered.
      serverStoredLast = res.state === "answered" || res.state === "abstained" || res.state === "clarify";
      if (res.state === "not_configured")
        return { lead: "ASAP’s AI assistant isn’t switched on for this brokerage yet.", text: "I can still answer from your records directly. Other questions need the assistant, which your administrator can switch on.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
      if (res.state === "unavailable") {
        const WHY = {
          auth_rejected: ["The model provider rejected this deployment's credentials.", "The AI service didn’t accept ASAP’s sign-in. Your administrator needs to check it; nothing was changed."],
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
      return { lead: "I couldn’t connect to ASAP just now.", text: describeApiError(e) + " Nothing was changed.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
    }
  }

  /*
   * The conversation's typed context (D-121). Business records stay on the server; this holds only
   * references to them, for this session: what was last resolved, what is being asked or prepared,
   * and the latest receipt. Never written to browser storage.
   */
  const convo = { previousSubject: null, pendingClarification: null, pendingAction: null, latestReceipt: null };

  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const STOP = new Set(["the", "and", "ltd", "limited", "plc", "co", "company", "group", "insurance", "motors", "traders"]);
  const latestYear = (policyId) => db.policyYears.filter((y) => y.policyId === policyId).sort((a, b) => (a.from < b.from ? 1 : -1))[0] ?? null;
  const policySubject = (p) => ({ type: "policy", policyId: p.id, clientId: p.clientId, label: p.number });
  const clientSubject = (c) => ({ type: "client", clientId: c.id, label: c.name });

  /** 1. What the message itself names: a policy number, or a client by a whole word of its name. */
  function explicitSubject(t) {
    const pol = db.policies.find((p) => p.number && p.number !== "Number not recorded" && new RegExp("\\b" + esc(p.number) + "\\b", "i").test(t));
    if (pol) return policySubject(pol);
    const full = db.clients.filter((c) => c.name.length >= 3 && new RegExp("\\b" + esc(c.name) + "\\b", "i").test(t));
    if (full.length === 1) return clientSubject(full[0]);
    const hits = db.clients.filter((c) =>
      c.name.split(/\s+/).some((w) => w.length >= 3 && !STOP.has(w.toLowerCase()) && new RegExp("\\b" + esc(w) + "\\b", "i").test(t)),
    );
    if (hits.length === 1) return clientSubject(hits[0]);
    if (hits.length > 1) return { type: "ambiguous", candidates: hits.map(clientSubject) };
    return null;
  }

  /** 5. What the Space in front is about. */
  function activeSubject(ctx) {
    const ref = ctx.ref || ctx;
    if (ref.policyYearId) {
      const y = db.policyYears.find((x) => x.id === ref.policyYearId);
      const p = y && db.policies.find((x) => x.id === y.policyId);
      if (p) return policySubject(p);
    }
    if (ref.policyId) {
      const p = db.policies.find((x) => x.id === ref.policyId);
      if (p) return policySubject(p);
    }
    const cid = ref.clientId || ctx.clientId;
    const c = cid && db.clients.find((x) => x.id === cid);
    return c ? clientSubject(c) : null;
  }

  /**
   * Who or what a question is about, in the order D-121 sets: the message itself; an attached
   * chip; the action being prepared; the subject just resolved (for "it", and only while the same
   * client is in front); the Space in front ("this client", "this policy"); otherwise candidates,
   * and a question. Never the first record that happens to match.
   */
  function resolveSubject(t, ctx) {
    const explicit = explicitSubject(t);
    // "No, I meant the other Tausi": of exactly two candidates, the one not just used.
    if (explicit?.type === "ambiguous" && /\bthe other\b/i.test(t) && convo.previousSubject && explicit.candidates.length === 2) {
      const other = explicit.candidates.find((c) => c.clientId !== convo.previousSubject.clientId);
      if (other && explicit.candidates.some((c) => c.clientId === convo.previousSubject.clientId)) return { ...other, source: "correction" };
    }
    if (explicit) return { ...explicit, source: "message" };
    const chip = ctx.chip && ctx.chip.clientId ? db.clients.find((c) => c.id === ctx.chip.clientId) : null;
    const active = activeSubject(ctx);
    const demonstrative = /\bthis (client|policy|quotation|claim)\b/i.test(t);
    if (chip && !(demonstrative && active && active.clientId === chip.id && active.type === "policy")) {
      // A chip for the client in front defers to the policy in front when the message says "this policy".
      if (!(active && active.type === "policy" && active.clientId === chip.id && /\bpolicy\b/i.test(t))) return { ...clientSubject(chip), source: "chip" };
    }
    if (convo.pendingAction?.subject) return { ...convo.pendingAction.subject, source: "pending" };
    const prev = convo.previousSubject;
    const sameClient = !active || !prev || prev.clientId === active.clientId;
    if (prev && !demonstrative && sameClient) return { ...prev, source: "previous" };
    if (active) return { ...active, source: "space" };
    return null;
  }

  /** The subject as a policy: itself, or the client's only policy; several means ask which. */
  function asPolicy(sub) {
    if (!sub) return { none: true };
    if (sub.type === "ambiguous") return { ambiguous: sub.candidates };
    if (sub.type === "policy") return { policy: db.policies.find((p) => p.id === sub.policyId) };
    const pols = db.policies.filter((p) => p.clientId === sub.clientId);
    if (pols.length === 1) return { policy: pols[0] };
    if (pols.length > 1) return { several: pols, client: db.clients.find((c) => c.id === sub.clientId) };
    return { noPolicy: db.clients.find((c) => c.id === sub.clientId) };
  }

  const remember = (sub) => {
    if (sub && sub.type !== "ambiguous") convo.previousSubject = { type: sub.type, policyId: sub.policyId, clientId: sub.clientId, label: sub.label };
  };

  function clarifyClient(cands, t) {
    convo.pendingClarification = { question: "client", text: t };
    return { lead: "Which client do you mean?", text: "More than one client matches. I will not pick one.", clarify: { question: "Client", options: cands.map((c) => ({ label: c.label, text: t.replace(/[?.!]*$/, "") + " — " + c.label })) }, ref: null, keepWorkspace: true };
  }
  function clarifyPolicy(pols, t) {
    convo.pendingClarification = { question: "policy", text: t };
    return { lead: "Which policy?", text: "This client has more than one policy; I will not pick one.", clarify: { question: "Policy", options: pols.map((p) => ({ label: p.number, text: t.replace(/[?.!]*$/, "") + " " + p.number + "?" })) }, ref: null, keepWorkspace: true };
  }

  /**
   * Record questions about a policy or a client, answered from the records the server returned:
   * cover (from the server's cover check, never the vehicle check), expiry, and a client's
   * policies. A vehicle registration in the question leaves it to the vehicle check.
   */
  function recordQuestion(t, ctx) {
    const cover = /\bcover(ed|age)?\b|\bin force\b|\bon risk\b/i.test(t);
    const expiry = /\b(expire|expires|expiry|end date|renewal date|run(s)? out|when does .* end)\b/i.test(t);
    const listPolicies = /\b(which|what) polic(y|ies)\b|\bpolicies does\b/i.test(t);
    if (!cover && !expiry && !listPolicies) return null;
    if (/\b[kK][a-zA-Z]{2}\s?\d{3}[a-zA-Z]?\b/.test(t)) return null; // a registration: the vehicle check
    const sub = resolveSubject(t, ctx);
    if (sub?.type === "ambiguous") return clarifyClient(sub.candidates, t);

    if (listPolicies) {
      const client = sub && db.clients.find((c) => c.id === sub.clientId);
      if (!client) return { lead: "Which client?", text: "Open the client, or name them. Nothing was opened.", ref: null, keepWorkspace: true };
      const pols = db.policies.filter((p) => p.clientId === client.id);
      remember(clientSubject(client));
      return {
        lead: pols.length ? client.name + " has " + plural(pols.length, "policy", "policies") + "." : client.name + " has no policies on file.",
        text: pols.map((p) => { const y = latestYear(p.id); return p.number + " — " + (p.cls || "class not recorded") + (y ? ", " + y.insurer + ", " + S.fmtDate(y.from) + " – " + S.fmtDate(y.to) : ""); }).join(". ") || "Import their book, or add a policy from a document.",
        ref: { ws: "client", clientId: client.id },
        chips: LIVE_CHIPS,
      };
    }

    if (!sub) {
      if (cover && !/\b(polic(y|ies)|this|it)\b/i.test(t)) return null;
      return { lead: "Which policy do you mean?", text: "Name the policy number, or open the policy first. I will not guess which record you mean.", ref: null, keepWorkspace: true, chips: LIVE_CHIPS };
    }
    const r = asPolicy(sub);
    if (r.ambiguous) return clarifyClient(r.ambiguous, t);
    if (r.several) return clarifyPolicy(r.several, t);
    if (r.noPolicy) return { lead: r.noPolicy.name + " has no policy on file.", text: "Nothing was opened.", ref: { ws: "client", clientId: r.noPolicy.id }, chips: LIVE_CHIPS };
    const pol = r.policy;
    const year = latestYear(pol.id);
    if (!year) return { lead: pol.number + " has no period of cover on file.", text: "Nothing was opened.", ref: null, keepWorkspace: true };
    remember(policySubject(pol));
    convo.pendingClarification = null;
    const client = db.clients.find((c) => c.id === year.clientId);
    const ref = { ws: "policy", clientId: year.clientId, policyYearId: year.id };
    if (expiry && !cover)
      return { lead: pol.number + " ends on " + S.fmtDate(year.to) + ".", text: (client ? client.name + ", " : "") + year.insurer + ", period " + S.fmtDate(year.from) + " – " + S.fmtDate(year.to) + ".", ref, chips: LIVE_CHIPS };
    const active = year.status === "active";
    return {
      lead: pol.number + (active ? " has active cover." : ": " + (year.coverLabel || "cover not verified") + "."),
      text: (year.coverReason ? year.coverReason + " " : "") + (client ? "Client " + client.name + ". " : "") + "Period " + S.fmtDate(year.from) + " – " + S.fmtDate(year.to) + ", " + year.insurer + ". ASAP reports what the insurer's records show; it does not decide cover.",
      ref,
      chips: LIVE_CHIPS,
    };
  }

  /** Company or person, from the name itself; null when the name does not say. */
  function clientKindFrom(name, said) {
    if (said) return /person|individual/i.test(said) ? "individual" : "corporate";
    if (/\b(ltd|limited|plc|llc|inc|co|company|traders|trading|motors|enterprises?|holdings|group|industries|logistics|services|agencies|agency|stores?|foods|clinics?|hospital|school|sacco|farm|farms|transport|hauliers?|properties|investments|&)\b/i.test(name)) return "corporate";
    if (/^(mr|mrs|ms|miss|dr)\.?\s/i.test(name)) return "individual";
    return null;
  }

  /**
   * "Add Kifaru Traders as a client": ask the API what would be written — similar clients, what is
   * missing — and put it before the person as a card. Nothing is written until Confirm, and the
   * confirm goes through the same client.create handler + New uses.
   */
  async function addClientPreview(name, said) {
    if (refusal("client.create")) return refusal("client.create");
    if (name.length < 2) return { lead: "What is the client's name?", text: "Nothing was changed.", ref: null, keepWorkspace: true };
    const kind = clientKindFrom(name, said);
    if (!kind)
      return {
        lead: "Is " + name + " a company or a person?",
        text: "One detail decides how the client file is kept. Nothing was changed.",
        clarify: { question: "Kind of client", options: [{ label: "A company", text: "Add " + name + " as a company client" }, { label: "A person", text: "Add " + name + " as a person client" }] },
        ref: null,
        keepWorkspace: true,
      };
    let p;
    try {
      p = await api.createClient({ name, kind, preview: true });
    } catch (e) {
      return { lead: "I could not check for similar clients just now.", text: describeApiError(e) + " Nothing was changed.", ref: null, keepWorkspace: true, chips: ["Add " + name + " as a client"] };
    }
    if (p.outcome !== "preview") return { lead: "I could not prepare that.", text: "Nothing was changed.", ref: null, keepWorkspace: true };
    const kindWord = kind === "individual" ? "a person" : "a company";
    const found = p.exact
      ? [p.exact.name + " is already on file — confirming opens it and adds nothing"]
      : p.candidates.length
        ? p.candidates.map((c) => "Similar: " + c.name + " (" + (c.kind === "individual" ? "person" : "company") + ") — check it is not the same client")
        : ["No similar client on file"];
    const lead = p.exact
      ? name + " is already a client."
      : "I can add " + name + " as " + kindWord + ". " + (p.candidates.length ? "I found " + p.candidates.length + " similar name" + (p.candidates.length === 1 ? "" : "s") + " — check before confirming." : "I found no close matches.");
    return {
      lead,
      text: "I still need the primary contact, or you can create the client now and add that later.",
      ref: null,
      keepWorkspace: true,
      pending: {
        title: p.exact ? "Open " + p.exact.name : "Add " + name,
        sections: [
          { label: "UNDERSTOOD", items: ["Create " + kindWord + " client", "Name: " + name, "Owner: " + (me.user.full_name || me.user.email)] },
          { label: "FOUND", items: found },
          { label: "MISSING", items: p.exact ? [] : p.missing },
          { label: "CHANGE", items: p.writes },
        ],
        external: p.externalEffect,
        action: "client.create",
        payload: { name, kind, confirmNew: "yes" },
        // One press of Confirm: a retry or a second press finds the same client (the create is idempotent on the name).
        actionId: "client.create:" + kind + ":" + name.toLowerCase(),
        confirmLabel: p.exact ? "Open client" : "Add client",
        progress: "Checking for similar clients and saving to your brokerage’s records…",
        editRef: { ws: "newclient", name, kind },
      },
    };
  }

  /** Any other write the engine proposes, shown as a card rather than run. */
  function genericPending(plan) {
    const external = /^(email|message|notify)\./.test(plan.action) ? "This would reach someone outside the brokerage; it waits for your approval." : "No message is sent to anyone.";
    return {
      title: plan.label || "Confirm this change",
      sections: [{ label: "UNDERSTOOD", items: [plan.label || plan.action] }, { label: "CHANGE", items: [plan.detail || "One change to your brokerage's records, with an audit entry against your name."] }],
      external,
      action: plan.action,
      payload: plan.payload,
      actionId: plan.actionId,
      confirmLabel: "Confirm",
    };
  }

  /**
   * Ask helps build an automation (D-125): each part of the sentence is matched to the registry,
   * and Save is offered only when every part is executable. A part that is not — a trigger nothing
   * emits yet, a condition ASAP cannot check, an action an automation may not take — is shown as
   * a note that would not run, and nothing is offered for saving.
   */
  const TRIGGER_WORDS = [[/document|file|upload|attachment/i, "document.received"], [/quote|quotation/i, "quote.received"], [/renew|expir/i, "renewal.approaching"], [/pay(ment)?|premium received|receipt/i, "payment.received"], [/cover.*confirm|confirmation/i, "cover.confirmed"], [/claim.*regist|registered claim/i, "claim.registered"], [/overdue|late|no movement/i, "check.overdue"]];
  function automationFromAsk(raw, t) {
    if (!/\b(automation|automatically|whenever|every time|each time)\b/i.test(t)) return null;
    if (/\b(what|which|show|list)\b.*\bautomations?\b/i.test(t) && !/\b(when|whenever)\b/i.test(t)) return null;
    const whenPart = (/\b(?:when|whenever|every time|each time)\b(.+?)(?:,|\bthen\b|\bprepare\b|\bdraft\b|\bsend\b|\bemail\b|$)/i.exec(raw) || [])[1] || "";
    const trig = TRIGGER_WORDS.find(([re]) => re.test(whenPart))?.[1] ?? null;
    const reg = AUTOMATION_REGISTRY;
    const conditions = [];
    const notes = [];
    const kindWord = /\b(claim|renewal|endorsement|placement)s?\b/i.exec(whenPart);
    if (kindWord && trig !== "claim.registered") conditions.push({ fact: "kind", operator: "equals", value: kindWord[1].toLowerCase() });
    const cls = CLASSES.find(([w]) => new RegExp("\\b" + w + "\\b", "i").test(whenPart));
    if (cls) conditions.push({ fact: "class_of_business", operator: "equals", value: cls[1] });
    if (/\b(over|above|more than|worth)\s+(kes|ksh)?\s*[\d,]+/i.test(raw)) notes.push("A money threshold — ASAP cannot check an amount in an automation yet");
    if (/\bvip|important client|key account\b/i.test(raw)) notes.push("“Important clients” — there is no such fact on the record to check");
    const wantsSend = /\b(send|email|notify|message|tell)\b/i.test(raw);
    const verb = /\bdraft\b/i.test(raw) || wantsSend ? "draft" : "prepare";
    if (wantsSend) notes.push("Sending — an automation never sends; it can draft for a person to send");
    if (/\b(pay|refund|settle|commission|cover|bind|renew the policy)\b/i.test(raw.replace(whenPart, ""))) notes.push("Changing cover or money — never automatic; a person does it");
    const input = { triggerEvent: trig ?? "", conditions, preparedVerb: verb, approval: "always" };
    const problems = trig ? automationProblems(input) : ["ASAP could not tell what should start it"];
    const part = (ok, text) => (ok ? "✓ " : "✗ ") + text;
    const understood = [
      part(!!trig && reg.triggers.find((x) => x.event === trig)?.executable, "When: " + (trig ? reg.triggers.find((x) => x.event === trig).label : "not recognised") + (trig && !reg.triggers.find((x) => x.event === trig).executable ? " — not available yet" : "")),
      ...conditions.map((c) => part(true, "Only if: " + reg.facts.find((f) => f.fact === c.fact).label + " is " + c.value)),
      part(true, "Then: " + reg.actions.find((x) => x.verb === verb).label),
      part(true, "Approval: a person approves each result"),
    ];
    const ref = { ws: "automation" };
    if (problems.length || notes.length)
      return {
        lead: "That cannot be saved as a working automation.",
        text: [problems.length ? "It cannot run: " + problems.join("; ") + "." : "", notes.length ? "Not executable, so it would only be a note: " + notes.join("; ") + "." : "", "Nothing was saved. The builder beside this shows what ASAP can run today."].filter(Boolean).join(" "),
        ref,
        understood,
      };
    const name = (raw.replace(/^(please\s+)?(create|set up|make|add)\s+(an?\s+)?automation\s*(to|that|which)?\s*/i, "").trim() || "Automation").slice(0, 80);
    return {
      lead: "Save this automation, switched off?",
      text: "Every part below is something ASAP can execute. It starts off; test it before switching it on.",
      ref,
      pending: {
        title: "Save an automation",
        sections: [{ label: "UNDERSTOOD", items: understood }, { label: "WRITE", items: ["One standing instruction, switched off", "An audit entry against your name"] }, { label: "NOT DONE", items: ["Nothing runs until you switch it on", "It never sends, and never changes cover or money"] }],
        external: "No message is sent to anyone.",
        action: "automation.create",
        payload: { name: name.charAt(0).toUpperCase() + name.slice(1), trigger: trig, verb, conditions },
        actionId: "automation.create:" + JSON.stringify(input),
        confirmLabel: "Save switched off",
        progress: "Saving to your brokerage’s records…",
      },
    };
  }

  /**
   * "What's next on this claim / this work?" — the server's next action for the record in front
   * (D-120). "This claim" with no claim in front is said so, never answered about another one.
   */
  function nextFromAsk(t, ctx) {
    if (!/\b(what('?s| is)? next|next step|where .* stand|what .* (blocked|stuck)|who (has|holds|owns) (it|this))\b/i.test(t)) return null;
    const ref = ctx.ref || ctx;
    if (/\bthis claim\b/i.test(t) && !ref.claimId) return { lead: "No claim is open in front of you.", text: "Open the claim, or name the client, and ask again.", ref: null, keepWorkspace: true };
    if (/\bthis quotation\b/i.test(t) && !ref.opportunityId) return { lead: "No quotation is open in front of you.", text: "Open the quotation, or name the client, and ask again.", ref: null, keepWorkspace: true };
    if (!ref.workItemId && !ref.claimId) return null;
    const found = workItemFor(t, ctx);
    const w = found.item;
    if (!w || !w.next) return null;
    const n = w.next;
    const owner = w.assigneeId ? db.users.find((u) => u.id === w.assigneeId)?.name : null;
    return {
      lead: "Next: " + n.what + ".",
      text: [n.why, n.missing.length ? "Missing: " + n.missing.join("; ") + "." : "", n.party ? "With " + n.party + "." : "", owner ? "Owner: " + owner + "." : "No owner yet.", n.checkAt ? "Looked at again " + S.fmtDate(n.checkAt) + "." : ""].filter(Boolean).join(" "),
      ref: ref.claimId ? { ws: "claim", clientId: ref.clientId, claimId: ref.claimId } : { ws: "workitem", workItemId: w.id },
    };
  }

  /**
   * Start quotation work from Ask, previewed; confirmed through the same "opportunity.create"
   * action the quotation Space's form uses. The client comes from the resolver (never the first
   * match); the cover wanted and its class come from the person's own words, or are asked for.
   */
  const CLASSES = [["motor", "Commercial motor"], ["fleet", "Commercial motor"], ["fire", "Fire"], ["marine", "Marine"], ["medical", "Medical"], ["liability", "Liability"], ["property", "Property"], ["travel", "Travel"], ["engineering", "Engineering"], ["bond", "Bonds"]];
  function quoteStartFromAsk(raw, t, ctx) {
    if (!/\b(start|new|open|begin|get|request)\b.*\bquot(e|es|ation)s?\b|\bquot(e|ation) for\b/i.test(t)) return null;
    if (/\bprepare|approve|deliver|record\b/i.test(t)) return null;
    const sub = resolveSubject(t, ctx);
    if (sub && sub.type === "ambiguous") return clarifyClient(sub.candidates, raw);
    const client = sub ? db.clients.find((c) => c.id === sub.clientId) : null;
    if (!client) return { lead: "For which client?", text: "Name the client, or open their Space, and ask again. Nothing was written.", ref: null, keepWorkspace: true };
    const cls = CLASSES.find(([w]) => new RegExp("\\b" + w + "\\b", "i").test(t))?.[1] ?? null;
    const m = /\bfor\s+(?:(?:a|an|the|their)\s+)?(.+?)(?:\s+(?:for|with)\s+.+)?[.?!]*$/i.exec(raw.replace(new RegExp(esc(client.name), "i"), "").replace(/\s+/g, " "));
    const described = m && m[1] && m[1].trim().length >= 3 && !/^(this|the)\s+client$/i.test(m[1].trim()) ? m[1].trim() : null;
    const ref = { ws: "quote", clientId: client.id };
    if (!described || !cls)
      return { lead: "What cover is wanted?", text: "Say the cover and its class — for example “start a quotation for " + client.name + " for a motor fleet of five vans”. Nothing was written.", ref, keepWorkspace: false };
    const title = described.charAt(0).toUpperCase() + described.slice(1);
    return {
      lead: "Start quotation work?",
      text: "Here is exactly what would be written. Nothing is written until you confirm.",
      ref,
      pending: {
        title: "Start quotation work",
        sections: [
          { label: "UNDERSTOOD", items: [raw.trim()] },
          { label: "CLIENT", items: [client.name] },
          { label: "WRITE", items: ["Quotation work: " + title + " (" + cls + ")", "Its Work item, owned by you, with the next step", "An audit entry against your name"] },
          { label: "NOT DONE", items: ["No insurer is asked", "No request is prepared or sent"] },
        ],
        external: "No message is sent to anyone.",
        action: "opportunity.create",
        payload: { clientId: client.id, title, cls },
        actionId: "opportunity.create:" + client.id + ":" + title.toLowerCase() + ":" + cls,
        confirmLabel: "Start quotation",
        progress: "Saving to your brokerage’s records…",
      },
    };
  }

  /**
   * The Work item a message is about (D-121): the record in front (a Work item, a claim, a
   * quotation), else a title the message names uniquely, else the only open item for the client
   * in front. Several candidates are a question, never the first row.
   */
  function workItemFor(t, ctx) {
    const ref = ctx.ref || ctx;
    const open = db.workItems.filter((w) => w.taskStatus !== "done");
    if (ref.workItemId) return { item: db.workItems.find((w) => w.id === ref.workItemId) ?? null };
    if (ref.opportunityId) return { item: db.workItems.find((w) => w.opportunityId === ref.opportunityId) ?? null };
    if (ref.claimId) {
      const c = state.claims?.get?.(ref.claimId) ?? [...(state.claims?.values?.() ?? [])].find((x) => x.claim?.id === ref.claimId);
      const wid = c?.item?.id ?? c?.claim?.work_item_id;
      if (wid) return { item: db.workItems.find((w) => w.id === wid) ?? null };
    }
    const lower = t.toLowerCase();
    const named = open.filter((w) => lower.includes(w.title.toLowerCase()) || (w.title.split(" — ")[0] && lower.includes(w.title.split(" — ")[0].toLowerCase()) && w.title.split(" — ")[0].length > 4));
    if (named.length === 1) return { item: named[0] };
    const cid = ref.clientId || ctx.clientId;
    const pool = named.length > 1 ? named : cid ? open.filter((w) => w.clientId === cid) : [];
    if (pool.length === 1) return { item: pool[0] };
    if (pool.length > 1) return { several: pool };
    return { none: true };
  }

  /**
   * Assign Work, or change its due date, from Ask — previewed by the same server contract the
   * Work Space's "Owner and due date" block confirms (D-122). The preview writes nothing.
   */
  async function workFromAsk(raw, t, ctx) {
    if (/\b(?:assign|reassign|give|hand(?:\s+it)?\s+over)\b.*?\bto\s+[A-Z]|\b(due|deadline)\b/i.test(raw) && refusal("work.assign")) return refusal("work.assign");
    const assign = /\b(?:assign|reassign|give|hand(?:\s+it)?\s+over)\b.*?\bto\s+([A-Z][a-z]+)/i.exec(raw);
    const dueWords = /\b(due|deadline)\b/i.test(t);
    if (!assign && !dueWords) return null;
    const when = dueWords ? parseDate(t) : null;
    if (dueWords && !assign && !when) return { lead: "Due when?", text: "Give the date — for example “due 15 Oct” or “due Friday”. Nothing was changed.", ref: null, keepWorkspace: true };
    let person = null;
    if (assign) {
      const matches = db.users.filter((u) => u.name.toLowerCase().split(/\s+/).includes(assign[1].toLowerCase()) || u.name.toLowerCase() === assign[1].toLowerCase());
      if (matches.length === 0) return { lead: "Who is " + assign[1] + "?", text: "No member of this brokerage has that name. Nothing was changed.", ref: null, keepWorkspace: true };
      if (matches.length > 1) return { lead: "Which " + assign[1] + "?", text: "More than one member has that name.", clarify: { question: "Member", options: matches.map((u) => ({ label: u.name, text: raw.replace(assign[1], u.name) })) }, ref: null, keepWorkspace: true };
      person = matches[0];
    }
    const found = workItemFor(t, ctx);
    if (found.several) return { lead: "Which work?", text: "More than one open item could be meant. I will not pick one.", clarify: { question: "Work", options: found.several.slice(0, 6).map((w) => ({ label: w.title, text: raw + " — " + w.title })) }, ref: null, keepWorkspace: true };
    if (!found.item) return { lead: "Which work?", text: "Open the Work item, or name it, and ask again. Nothing was changed.", ref: { ws: "work" } };
    const w = found.item;
    const input = { version: w.version, ...(person ? { ownerId: person.id } : {}), ...(when ? { dueOn: when.date } : {}) };
    let pre;
    try {
      pre = await api.manageWork(w.id, { ...input, preview: true });
    } catch (e) {
      return { lead: "I could not check that just now.", text: describeApiError(e) + " Nothing was changed.", ref: null, keepWorkspace: true };
    }
    const ref = { ws: "workitem", workItemId: w.id };
    if (pre.outcome === "blocked") return { lead: pre.guard === "permission" ? "Your role cannot change this." : "That cannot be changed.", text: pre.reason, ref, blocked: true };
    if (pre.outcome === "already_done") return { lead: "Already so.", text: w.title + " already has that " + (person ? "owner" : "due date") + ". Nothing needs changing.", ref };
    const title = person && when ? "Change owner and due date" : person ? "Assign this work" : "Change the due date";
    return {
      lead: title + "?",
      text: "Here is exactly what would change. Nothing is written until you confirm.",
      ref,
      pending: {
        title,
        sections: [
          { label: "UNDERSTOOD", items: [raw.trim()] },
          { label: "RECORD", items: [w.title] },
          { label: "CHANGE", items: pre.changes.map((c) => c.label + ": " + (c.from ?? "—") + " → " + (c.to ?? "—")) },
        ],
        external: pre.externalEffect,
        action: "work.assign",
        payload: { workItemId: w.id, ...(person ? { userId: person.id } : {}), ...(when ? { dueAt: when.date } : {}) },
        actionId: "work:" + w.id + ":" + w.version + ":" + JSON.stringify(input),
        confirmLabel: person ? "Assign" : "Change due date",
        progress: "Saving to your brokerage’s records…",
      },
    };
  }

  /**
   * Quotation work from Ask, on the same opp.action contract the quotation Space uses. The
   * quotation is the one open in front, or the only open one for the client in context — never
   * guessed among several.
   */
  function quotationFromAsk(t, ctx, raw = t) {
    // "This claim" or "this work" is about another record; never answered from a quotation.
    if (/\bthis (claim|work|policy)\b/i.test(t)) return null;
    if (/\bthis quotation\b/i.test(t) && !(ctx.ref || ctx).opportunityId && !ctx.opportunityId) return null;
    if (!/\b(quot(e|ation)|insurer|request|deliver(y|ed)?|next|blocked|stuck|requirements?|received|supplied|got)\b/i.test(t)) return null;
    let id = ctx.opportunityId || null;
    if (!id && ctx.clientId) {
      const open = [...state.opportunities.values()].filter((d) => d.client.id === ctx.clientId && !d.opportunity.closedAt);
      if (open.length === 1) id = open[0].opportunity.id;
      else if (open.length > 1 && /\b(quot(e|ation)|request|insurer)\b/i.test(t))
        return { lead: "Which quotation?", text: "This client has more than one open. I will not pick one.", clarify: { question: "Quotation", options: open.map((d) => ({ label: d.opportunity.title, text: t + " — " + d.opportunity.title })) }, ref: null, keepWorkspace: true };
    }
    const d = id ? state.opportunities.get(id) : null;
    if (!d) return null;
    const ref = { ws: "quote", opportunityId: id };
    const live = d.insurers.filter((i) => !i.removedAt);
    const named = (list) => list.filter((i) => new RegExp("\\b" + (i.insurerName || i.name).split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(t));
    if (/\b(what('?s| is)? next|next step|why .*(blocked|stuck)|what .*(blocked|stuck)|where .* stand)\b/i.test(t)) {
      const n = d.next;
      return { lead: "Next: " + n.what + ".", text: [n.why, n.missing.length ? "Missing: " + n.missing.join("; ") + "." : "", n.party ? "With " + n.party + "." : ""].filter(Boolean).join(" "), ref, chips: n.action ? [n.action.label] : [] };
    }
    const add = /\badd\b/i.test(t) && /\binsurer|to (this|the) quot/i.test(t);
    if (add) {
      const avail = d.availableInsurers.filter((a) => !live.some((i) => i.insurerId === a.id));
      const hit = named(avail);
      if (hit.length !== 1)
        return { lead: hit.length ? "Which insurer?" : "Which insurer should I add?", text: "Nothing was changed.", clarify: { question: "Insurer", options: (hit.length ? hit : avail).slice(0, 6).map((a) => ({ label: a.name, text: "Add " + a.name + " as an insurer to this quotation" })) }, ref, keepWorkspace: true };
      return pendingOpp(d, ref, "Add " + hit[0].name + " to this quotation", ["Approach " + hit[0].name + " for " + d.opportunity.classOfBusiness + " terms"], ["One insurer added to " + d.client.name + "’s quotation"], "add_insurer", { insurerId: hit[0].id }, "Add insurer");
    }
    // A requirement, in the person's own words (the label is theirs, never corrected).
    const addReq = /\badd\s+(?:a\s+)?requirement(?:\s+for|\s+of|:)?\s+(.+?)[.?!]*$/i.exec(raw) || /\badd\s+(.+?)\s+as\s+a\s+requirement\b/i.exec(raw);
    if (addReq) {
      const label = addReq[1].trim().replace(/^(the|a|an)\s+/i, "");
      if (label.length < 3) return { lead: "Which requirement?", text: "Name it in at least three characters. Nothing was changed.", ref, keepWorkspace: true };
      if (d.requirements.some((r) => r.label.toLowerCase() === label.toLowerCase())) return { lead: "Already a requirement.", text: "“" + label + "” is already on this quotation. Nothing was changed.", ref };
      return pendingOpp(d, ref, "Add the requirement “" + label + "”", ["Requirement: " + label], ["One requirement added — shown as not yet supplied"], "add_requirement", { label }, "Add requirement");
    }
    // A requirement supplied: named by its label, with the person's sentence as the evidence note.
    if (/\b(received|got|have|supplied|provided|sent us)\b/i.test(t)) {
      const open = d.requirements.filter((r) => !r.suppliedAt);
      const hit = open.filter((r) => r.label.split(/\s+/).some((w) => w.length >= 4 && new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/s$/i, "") + "s?\\b", "i").test(raw)));
      if (hit.length === 1) {
        if (raw.trim().length < 10) return { lead: "What proves it?", text: "Say how it arrived — for example “received the logbooks by email from the client today”. Nothing was changed.", ref, keepWorkspace: true };
        return pendingOpp(d, ref, "Mark “" + hit[0].label + "” as supplied", ["Evidence: “" + raw.trim() + "”"], ["The requirement is marked supplied by you, with that note as its evidence"], "supply_requirement", { requirementId: hit[0].id, note: raw.trim() }, "Mark supplied");
      }
      if (hit.length > 1) return { lead: "Which requirement?", text: "More than one matches. Nothing was changed.", clarify: { question: "Requirement", options: hit.map((r) => ({ label: r.label, text: "We received the " + r.label + " — " + raw.trim() })) }, ref, keepWorkspace: true };
    }
    if (/\bprepare\b/i.test(t) && /\brequest\b/i.test(t)) {
      const cand = live.filter((i) => i.stage === "not_asked");
      const hit = named(cand).length ? named(cand) : cand.length === 1 ? cand : [];
      if (hit.length !== 1)
        return { lead: cand.length ? "Which insurer is the request for?" : "Every insurer already has a request.", text: "Nothing was changed.", clarify: cand.length ? { question: "Insurer", options: cand.map((i) => ({ label: i.insurerName, text: "Prepare the request to " + i.insurerName })) } : undefined, ref, keepWorkspace: !cand.length };
      const i = hit[0];
      const subject = "Quotation request — " + d.client.name + ", " + d.opportunity.classOfBusiness;
      return pendingOpp(d, ref, "Prepare the request to " + i.insurerName, ["Subject: " + subject, "Text prepared from the quotation and its supplied requirements — edit it in the quotation before approving"], ["One draft request, awaiting approval"], "prepare_request", { opportunityInsurerId: i.id, subject, body: requestDraft(d, i.insurerName) }, "Prepare request", "Nothing is sent — ASAP has no mailbox connected. The request waits for approval.");
    }
    if (/\bapprove\b/i.test(t) && /\brequest\b/i.test(t)) {
      const cand = live.filter((i) => i.stage === "request_prepared");
      const hit = named(cand).length ? named(cand) : cand.length === 1 ? cand : [];
      if (hit.length !== 1) return { lead: cand.length ? "Which request?" : "No request is waiting for approval.", text: "Nothing was changed.", clarify: cand.length > 1 ? { question: "Request", options: cand.map((i) => ({ label: i.insurerName, text: "Approve the request to " + i.insurerName })) } : undefined, ref, keepWorkspace: true };
      const i = hit[0];
      return pendingOpp(d, ref, "Approve the request to " + i.insurerName, ["You approve this exact text: “" + i.request.subject + "”"], ["The request is marked approved by you — editing it later clears the approval"], "approve_request", { quoteRequestId: i.request.id }, "Approve request", "Approving does not send it. Deliver it yourself, then record how.");
    }
    if (/\b(record|log).*(deliver|sent)|\bdelivered\b/i.test(t))
      return { lead: "Record the delivery in the quotation.", text: "Say how it went and what proves it — the email subject and time, or a portal reference. ASAP records it as delivered by you, never as sent.", ref };
    return null;
  }

  function pendingOpp(d, ref, title, understood, change, action, extra, confirmLabel, external) {
    return {
      lead: title + "?",
      text: "Here is exactly what would change. Nothing is written until you confirm.",
      ref,
      pending: {
        title,
        sections: [{ label: "UNDERSTOOD", items: understood }, { label: "RECORD", items: [d.client.name + " — " + d.opportunity.title] }, { label: "CHANGE", items: change }],
        external: external || "No message is sent to anyone.",
        action: "opp.action",
        payload: { id: d.opportunity.id, action, ...extra },
        actionId: "opp:" + d.opportunity.id + ":" + action + ":" + JSON.stringify(extra),
        confirmLabel,
        progress: "Saving to your brokerage’s records…",
      },
    };
  }

  /** A loss date: today, yesterday, a recent weekday (the last one, never a future one), or a date. */
  function lossDate(t) {
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const now = new Date();
    const back = (n) => local(new Date(now.getTime() - n * 864e5));
    if (/\btoday|this morning|earlier today\b/i.test(t)) return { date: back(0), label: "today" };
    if (/\byesterday|last night\b/i.test(t)) return { date: back(1), label: "yesterday" };
    const wd = /\b(?:last|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(t);
    if (wd) {
      const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(wd[1].toLowerCase());
      let delta = (now.getDay() - target + 7) % 7;
      if (delta === 0) delta = 7;
      return { date: back(delta), label: "last " + wd[1] };
    }
    const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
    if (iso) return { date: iso[1], label: iso[1] };
    const dm = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(t);
    if (dm) {
      const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(dm[2].toLowerCase());
      let d = new Date(now.getFullYear(), mo, +dm[1]);
      if (d > now) d = new Date(now.getFullYear() - 1, mo, +dm[1]);
      return { date: local(d), label: dm[0] };
    }
    return null;
  }

  /**
   * "Report a claim for the accident yesterday": the client and policy from the context (asked
   * only when genuinely unclear), the date and what happened from the words, shown as a card.
   * Confirm goes through claim.open — the same handler as the claim form. It is a draft, never
   * registered, never "covered", and nothing is sent.
   */
  function claimPreview(raw, t, ctx) {
    const sub = resolveSubject(t, ctx);
    if (sub?.type === "ambiguous") return clarifyClient(sub.candidates, raw);
    const client = sub && db.clients.find((c) => c.id === sub.clientId);
    if (!client) return { lead: "Which client is the claim for?", text: "Open the client or name them. Nothing was changed.", ref: { ws: "claim" } };
    // The policy: the one named or in front; the client's only one; otherwise ask (with "not known").
    let policy = sub.type === "policy" ? db.policies.find((p) => p.id === sub.policyId) : null;
    if (!policy) {
      const pols = db.policies.filter((p) => p.clientId === client.id);
      if (pols.length === 1) policy = pols[0];
      else if (pols.length > 1 && !/\bpolicy (is )?(not known|unknown)\b/i.test(t)) {
        convo.pendingClarification = { question: "claim policy", text: raw };
        return {
          lead: "Which policy does this claim relate to?",
          text: "Nothing was changed.",
          clarify: { question: "Policy", options: [...pols.map((p) => ({ label: p.number + " — " + (p.cls || "class not recorded"), text: raw.replace(/[?.!]*$/, "") + " on " + p.number })), { label: "Policy not known yet", text: raw.replace(/[?.!]*$/, "") + " — policy not known" }] },
          ref: null,
          keepWorkspace: true,
        };
      }
    }
    const when = lossDate(t);
    if (!when) {
      convo.pendingClarification = { question: "claim date", text: raw };
      return { lead: "When did it happen?", text: "The date of the loss decides which period of cover it falls in. Nothing was changed.", clarify: { question: "Date of loss", options: [{ label: "Today", text: raw + " today" }, { label: "Yesterday", text: raw + " yesterday" }] }, ref: null, keepWorkspace: true };
    }
    const what = raw.replace(/^.*?\bclaim\b\s*(for|about|—|-|:)?\s*/i, "").replace(/\s+on\s+[A-Z0-9-]{4,}\s*$/i, "").trim();
    const summary = what.length >= 8 ? what.charAt(0).toUpperCase() + what.slice(1) : "Loss reported by the client — details to be added";
    const policyLine = policy ? policy.number + " — " + (policy.cls || "class not recorded") : "Not known yet — the claim says so until it is matched";
    return {
      lead: "I can report this as a draft claim for " + client.name + ".",
      text: "It stays a draft — not registered, and not a finding that the loss is covered.",
      ref: null,
      keepWorkspace: true,
      pending: {
        title: "Report a claim for " + client.name,
        sections: [
          { label: "UNDERSTOOD", items: ["A draft claim — not registered", "Client: " + client.name, "Policy: " + policyLine, "Date of loss: " + S.fmtDate(when.date) + " (" + when.label + ")", "What happened: " + summary] },
          { label: "MISSING", items: ["Claim form", "Supporting documents (photos, police abstract where it applies)"].concat(policy ? [] : ["The policy the loss falls under"]) },
          { label: "CHANGE", items: ["One draft claim and its Work item, looked at again in two days", "An audit entry against your name"] },
        ],
        external: "No message is sent to the insurer or anyone else. Registering the claim and notifying the insurer each need your approval later.",
        action: "claim.open",
        payload: { clientId: client.id, policyId: policy ? policy.id : "unknown", incidentOn: when.date, incidentSummary: summary },
        actionId: "claim.open:" + client.id + ":" + (policy ? policy.id : "unknown") + ":" + when.date + ":" + summary.toLowerCase(),
        confirmLabel: "Report the claim",
        progress: "Opening the draft claim and its Work…",
        editRef: { ws: "claim", clientId: client.id, policyId: policy ? policy.id : "unknown", incidentOn: when.date, incidentSummary: summary },
      },
    };
  }

  /** Every answer passes through here, so the context records what was prepared (D-121). */
  /*
   * What the signed-in person's role allows, as the server resolved it into /me (rule 5: read,
   * never supplied). Used only to refuse early and plainly; every write is still checked by the
   * server, which is the authority.
   */
  const NEEDS = { "client.create": ["client:create", "add clients"], "claim.open": ["claim:create", "report claims"], "opportunity.create": ["space:create", "start quotation work"], "opp.action": ["space:create", "change quotation work"], "work.assign": ["job:edit", "change who owns Work or when it is due"], "automation.create": ["automation:create", "create automations"], "contact.create": ["client:edit", "add contacts"] };
  const perms = new Set(me.permissions ?? []);
  const refusal = (action) => {
    const need = NEEDS[action];
    if (!need || perms.has(need[0]) || perms.size === 0) return null;
    return { lead: "Your role cannot " + need[1] + ".", text: "Nothing was changed. Someone whose role allows it can do this; ASAP will not work around it.", ref: null, keepWorkspace: true, blocked: true };
  };

  async function liveRoute(text, ctx) {
    const r = await routeInner(text, ctx);
    if (r && r.pending) {
      const no = refusal(r.pending.action);
      if (no) return no;
    }
    if (r && r.pending) {
      const pay = r.pending.payload || {};
      const sub = pay.clientId ? { type: "client", clientId: pay.clientId } : null;
      convo.pendingAction = { actionId: r.pending.actionId, action: r.pending.action, subject: sub };
    }
    if (r && r.clarify) convo.pendingClarification = convo.pendingClarification ?? { question: r.clarify.question, text };
    return r;
  }

  async function routeInner(text, ctx) {
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
    // The name comes from what was typed, never the typo-corrected text: a client's name is theirs.
    const add = /\b(?:add|create)\s+(.+?)\s+as\s+an?\s+(?:new\s+)?(company|person|individual|corporate)?\s*client\b/i.exec(text.trim());
    if (add) return addClientPreview(add[1].trim(), add[2] || null);
    if (/^(import( records)?|add a client|new client)$/i.test(t)) return { lead: "Opening it.", text: "", ref: { ws: /import/i.test(t) ? "import" : "newclient" } };

    if (/\bclaim\b/i.test(t) && /\b(report|register|new|open|file|log)\b/i.test(t)) return claimPreview(text.trim(), t, ctx);
    // The chips live mode offers, and the places a broker asks to go, answered from the records.
    const GO = [
      [/^(show|open|see)( me)?( my)? work\??$|^my work\??$|^work$/i, { ws: "work" }, "Your work, from your records."],
      [/what needs (my )?attention|^today\??$|what('?s| is) (on )?(for )?today/i, { ws: "today" }, "What matters now, from your records."],
      [/^(show|open|see)( me)?( the)? activity\??$|^activity$|what (has )?changed/i, { ws: "activity" }, "What changed, who changed it and what is outstanding."],
      [/^(show|open|see)( me)?( my| the)? automations?\??$|^automations?$/i, { ws: "automation" }, "Your automations, and what each can actually do."],
    ];
    const go = GO.find(([re]) => re.test(t.trim()));
    if (go) return { lead: go[2], text: "The workspace beside this answer is read from your brokerage's records.", ref: go[1], chips: LIVE_CHIPS };
    const automation = automationFromAsk(text.trim(), t);
    if (automation) return automation;
    const started = quoteStartFromAsk(text.trim(), t, ctx);
    if (started) return started;
    const work = await workFromAsk(text, t, ctx);
    if (work) return work;
    const quote = quotationFromAsk(t, ctx, text.trim());
    if (!quote) {
      const nextUp = nextFromAsk(t, ctx);
      if (nextUp) return nextUp;
    }
    if (quote) return quote;
    const record = recordQuestion(t, ctx);
    if (record) return record;
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
    // Every write the engine proposes waits for the person (D-118): it becomes a pending card.
    if (r.plan) r.pending = genericPending(r.plan);
    return r;
  }

  S.useBackend({ db, dispatch });

  return {
    greetingChips: LIVE_CHIPS,
    savingNote: "Saving to your brokerage's records…",
    suggestions: [{ label: "What needs attention today?" }, { label: "What clients do I have?" }, { label: "Show my work" }, { label: "Search every record" }],
    historyNote: "Saved with your brokerage, so it follows you to any device. It’s a record of what you asked, not a business record.",
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
    ai: { latencyMs: 200, configured: () => false, route: liveRoute, context: () => ({ organizationId: me.active_organization.id, userId: me.user.id, ...JSON.parse(JSON.stringify(convo)) }), workspace: liveWorkspace, parseDate, tools: Object.keys(LIVE) },
  };
}
