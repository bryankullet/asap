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
import { api, describeApiError } from "../lib/api.js";
import { supabase } from "../lib/supabase.js";
import * as S from "./engine/store.js";
import { buildWorkspace, interpret, parseDate } from "./engine/intent.js";

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

const KIND = { renewal: "Renewal", claim: "Claim", endorsement: "Servicing", quotation: "Quotation", placement: "Placement", onboarding: "Onboarding" };

/** Everything the engine reads, from the API. */
async function hydrate(me) {
  const org = me.active_organization;
  const db = { meta: { seq: 0, ledger: {}, session: { userId: me.user.id, clock: new Date().toISOString() } } };
  S.SCHEMA.forEach((c) => (db[c] = []));

  db.brokerages.push({ id: org.id, name: org.name, country: org.country ?? "", approvalRules: {} });

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
  const clientLists = await Promise.all(CLIENT_VIEWS.map((v) => api.clientFiles(v).catch(() => ({ items: [] }))));
  const seen = new Set();
  for (const list of clientLists) {
    for (const row of list.items) {
      if (seen.has(row.client.id) || row.client.deleted_at) continue;
      seen.add(row.client.id);
      db.clients.push({ id: row.client.id, name: row.client.name, short: shortName(row.client.name), brokerageId: org.id, createdAt: row.client.created_at });
    }
  }

  // Each client's own record: contacts, policies and periods, claims, documents, threads.
  const spaces = await pool(db.clients, 6, (c) => api.clientSpace(c.id));
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
      db.documents.push({ id: d.id, clientId, name: d.filename, kind: d.kind, currentVersion: 1, createdAt: d.createdAt, source: "upload" });
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
  const covers = await pool(policyIds, 6, (id) => api.policySpace(id));
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
        kind: KIND[it.kind] ?? it.kind.replace(/^\w/, (c) => c.toUpperCase()),
        title: it.title,
        state: workState(it),
        parties: it.task_status === "with_party" && it.task_party ? [{ name: it.task_party, since: it.task_since }] : [],
        assigneeId: it.owner_id,
        dueAt: it.task_next_check,
        priority: row.priority ?? "medium",
        reason: row.reason || it.reason || "",
        createdAt: it.created_at ?? it.task_since ?? d0(),
        policyYearId: it.policy_period_id,
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
      conditions: a.conditions.length ? a.conditions.map((c) => [c.fact, c.operator, c.value].filter(Boolean).join(" ")).join("; ") : "None",
      actions: a.description || a.skill,
      approval: a.approval === "always" ? "A person approves before anything leaves" : "No approval step",
      runs: 0,
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
      text: e.action + (e.result === "success" ? "" : " — " + e.result + (e.failureReason ? ": " + e.failureReason : "")),
      clientId: null,
      entity: e.objectId,
      evidenceIds: [],
      kind: e.actorType === "system" ? "system" : "action",
    });
  }

  db.conversations.push({ id: "cnv_main", messages: [], contextId: null });
  return db;
}

function d0() {
  return new Date().toISOString();
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NOT_CONNECTED = {
  "records.import": "Importing a book from here",
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
  "claim.register": "Registering a claim from here",
  "claim.document": "Recording claim documents from here",
  "claim.update": "Updating a claim from here",
  "payment.match": "Matching payments",
  "reconcile.run": "Running a reconciliation",
  "reconcile.resolve": "Resolving reconciliation lines",
  "renewal.create": "Creating a renewal year from here",
  "work.assign": "Reassigning work",
  "document.version": "Adding a document version",
  "automation.save": "Building an automation from here",
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
  quote: "Quotation work",
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
  import: "Records import",
  onboarding: "Setup",
  settings: "Company settings",
};

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
          " is not yet connected to your brokerage's records in this view, so no values are displayed here. Today, Work, clients, policies, documents, claims and automations read your real records.",
      },
      {
        t: "rows",
        label: "Where your records are",
        rows: [
          { title: "Today", note: "What needs attention now", badge: "Open", badgeTone: "ok", action: { a: "open", ref: { ws: "today" } } },
          { title: "Work", note: "Everything open in your brokerage", badge: "Open", badgeTone: "ok", action: { a: "open", ref: { ws: "work" } } },
          { title: "Search", note: "Clients, policies and documents", badge: "Open", badgeTone: "ok", action: { a: "open", ref: { ws: "search" } } },
        ],
      },
    ],
  };
}

function liveWorkspace(ref) {
  if (ref && NOT_CONNECTED_WS[ref.ws]) return notConnectedWorkspace(ref);
  return buildWorkspace(ref);
}

// Suggestions the engine writes around its demo records; never offered over real ones.
const DEMO_WORDS = /\b(Acme|KDN|KDA|Karibu|Bluewave|GreenCare|Mara|APA|CIC|Jubilee)\b/;

function liveRoute(text, ctx) {
  const r = interpret(text, ctx) || {};
  if (Array.isArray(r.chips) && r.chips.some((c) => DEMO_WORDS.test(typeof c === "string" ? c : c.label ?? ""))) {
    r.chips = ["What needs attention today?", "Show my work", "Search every record"];
  }
  if (r.ref && NOT_CONNECTED_WS[r.ref.ws]) {
    return {
      ...r,
      lead: NOT_CONNECTED_WS[r.ref.ws] + " is not connected to your records yet.",
      text: "I opened the workspace so you can see that nothing is shown there yet. I can open Today, Work, a client, a policy or a document from your real records.",
      plan: null,
      chips: ["What needs attention today?", "Show my work"],
    };
  }
  return r;
}

/** Build the adapters the approved interface talks to, over this brokerage's records. */
export async function loadLiveAdapters({ me, switchToDemo }) {
  let db = await hydrate(me);
  const pendingFiles = new Map();
  let ui = null;

  const refresh = async () => {
    db = await hydrate(me);
    S.useBackend({ db, dispatch });
    ui?.();
  };

  const ok = (text, extra = {}) => ({ ok: true, text, at: d0(), ...extra });
  const fail = (err) => ({ ok: false, error: describeApiError(err) });

  /** Writes the API can perform. Everything else is refused honestly. */
  const LIVE = {
    // The conversation and message drafts stay in this browser session; they are not records.
    "conversation.save": (p) => {
      const c = db.conversations.find((x) => x.id === p.id);
      if (c) Object.assign(c, { messages: p.messages, contextId: p.contextId });
      return ok("Saved");
    },
    "draft.save": (p) => {
      const d = db.drafts.find((x) => x.id === p.id);
      if (d) Object.assign(d, p);
      else db.drafts.push({ ...p, id: p.id || "drf_" + Date.now().toString(36), createdAt: d0() });
      return ok("Draft saved in this session");
    },
    "automation.toggle": async (p) => {
      const a = db.automations.find((x) => x.id === p.id);
      if (!a) return { ok: false, error: "That automation is no longer on file." };
      try {
        await api.setAutomationEnabled(a.id, !a.on);
        await refresh();
        return ok(a.name + (a.on ? " is paused" : " is on"));
      } catch (e) {
        return fail(e);
      }
    },
    "opportunity.create": async (p) => {
      try {
        await api.createOpportunity({ clientId: p.clientId, title: p.title, classOfBusiness: p.cls || "Commercial motor", requestKey: crypto.randomUUID() });
        await refresh();
        const c = db.clients.find((x) => x.id === p.clientId);
        return ok("Quotation work created" + (c ? " for " + c.name : ""));
      } catch (e) {
        return fail(e);
      }
    },
    "work.create": async (p) => {
      // The API opens renewal, claim and endorsement work; other kinds are not records yet.
      const kind = /renew/i.test(p.kind || "") ? "renewal" : /claim/i.test(p.kind || "") ? "claim" : null;
      if (!kind) return { ok: false, error: "Only renewal and claim work can be opened from here so far." };
      try {
        await api.createWorkItem({ kind, clientId: p.clientId || undefined, source: "ask" });
        await refresh();
        return ok("Work created: " + p.title);
      } catch (e) {
        return fail(e);
      }
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
          contentSha256: await sha256Hex(bytes),
          clientId: p.clientId || null,
        });
        if (asked.outcome === "ready") {
          const res = await fetch(asked.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: bytes });
          if (!res.ok) return { ok: false, error: "The file store would not accept the file. Nothing was filed — you can retry." };
          await api.documentFiled(asked.document.id);
        }
        pendingFiles.delete(p.name);
        await refresh();
        return ok(asked.outcome === "already_on_file" ? file.name + " is already on file" : file.name + " uploaded");
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
    const settle = (res) => {
      if (res.ok && type !== "conversation.save" && type !== "draft.save") db.meta.ledger[key] = { ...res, actionId: key };
      return res;
    };
    const out = handler(payload);
    return out && typeof out.then === "function" ? out.then(settle) : settle(out);
  }

  S.useBackend({ db, dispatch });

  return {
    greetingChips: ["What needs attention today?", "Show my work", "Show automations"],
    suggestions: [{ label: "What needs attention today?" }, { label: "Show my work" }, { label: "Show automations" }, { label: "Search every record" }],
    onChange: (fn) => (ui = fn),
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
