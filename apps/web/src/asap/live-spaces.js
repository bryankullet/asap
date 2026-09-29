/**
 * Live workspaces the approved engine has no live source for, built from this brokerage's API data
 * in the engine's own block vocabulary (facts, rows, note, gate, upload, builder) so they render in
 * the approved interface exactly as its other workspaces do.
 *
 * Every value shown comes from an API response. Nothing here is example content.
 */
import * as S from "./engine/store.js";

const ok = "ok";
const warn = "uncertain";
const bad = "missing";

const note = (tone, title, text) => ({ t: "note", tone, title, text });
const rows = (label, list) => ({ t: "rows", label, rows: list });
const facts = (items) => ({ t: "facts", items });
const gate = (label, detail, action, payload, extra = {}) => ({ t: "gate", kind: "approve", label, detail, action, payload, ...extra });
const nav = (label, detail, ref) => ({ t: "gate", kind: "approve", label, detail, nav: ref });
const form = (formId, label, fields, action, payload, saveLabel, saveNote = "") => ({ t: "builder", label, formId, fields, action, payload, saveLabel, saveNote });

const date = (iso) => (iso ? S.fmtDate(iso) : "not recorded");
const money = (amount, currency) => (amount == null ? "not recorded" : (currency || "") + " " + Number(amount).toLocaleString("en-KE"));

function clientPicker(label, makeRef) {
  const clients = S.sel.clients();
  if (!clients.length)
    return [
      note("amber", "No clients yet", "Add your first client, or import your book, and it appears here."),
      nav("Add a client", "Start with the client's name.", { ws: "newclient" }),
      nav("Import records", "A spreadsheet or PDF of clients and policies.", { ws: "import" }),
    ];
  return [rows(label, clients.map((c) => ({ title: c.name, note: "Client", badge: "Choose", badgeTone: ok, action: { a: "open", ref: makeRef(c) } })))];
}

/* ---------------------------------------------------------------- clients */

function clientsSpace() {
  const clients = S.sel.clients();
  return {
    kind: "Clients",
    title: clients.length ? clients.length + " client" + (clients.length === 1 ? "" : "s") : "No clients yet",
    status: "live",
    statusLabel: clients.length + " on file",
    blocks: clients.length
      ? [
          rows(
            "Your clients",
            clients.map((c) => ({
              title: c.name,
              note: S.sel.policies(c.id).length + " polic" + (S.sel.policies(c.id).length === 1 ? "y" : "ies") + " · " + S.sel.work({ clientId: c.id }).filter((w) => w.state !== "Completed").length + " open work",
              badge: "Open",
              badgeTone: ok,
              action: { a: "open", ref: { ws: "client", clientId: c.id } },
            })),
          ),
          nav("Add a client", "Start with the client's name.", { ws: "newclient" }),
        ]
      : clientPicker("", () => ({})),
  };
}

function newClientSpace(state) {
  const dup = state.duplicate;
  return {
    kind: "New client",
    title: "Add a client",
    status: "draft",
    statusLabel: "Not saved yet",
    blocks: [
      note("green", "The first record everything else hangs on", "Policies, documents, quotations and claims attach to a client. ASAP checks for a client with a similar name before creating one."),
      form(
        "newclient",
        "Client",
        [
          { key: "name", label: "CLIENT NAME", placeholder: "The name on their documents" },
          { key: "kind", label: "COMPANY OR PERSON", placeholder: "Company", value: "Company" },
        ],
        "client.create",
        {},
        "Add client",
        "Created in your brokerage only, with an audit entry against your name.",
      ),
      ...(dup
        ? [
            note("amber", "A similar client may already exist", "“" + dup.name + "” resembles a client on file. Open it if it is the same one; create it only if it is not."),
            rows("Possible matches", dup.candidates.map((c) => ({ title: c.name, note: c.kind === "individual" ? "Person" : "Company", badge: "Open", badgeTone: warn, action: { a: "open", ref: { ws: "client", clientId: c.id } } }))),
            gate("Create “" + dup.name + "” anyway", "Only if it is a different client from the matches above.", "client.create", { name: dup.name, kind: dup.kind, confirmNew: "yes" }),
          ]
        : []),
    ],
  };
}

/* ---------------------------------------------------------------- import */

function importSpace(state) {
  const p = state.importPreview;
  const blocks = [
    note("amber", "Nothing is saved until you confirm", "ASAP reads the file on its own server, shows every row it would create and waits. Rows it is unsure about are shown, never hidden."),
    { t: "upload", label: "Choose a spreadsheet, CSV or PDF of clients and policies", action: "import.preview" },
  ];
  if (p) {
    const sum = p.summary;
    blocks.push(
      facts([
        ["File", p.batch.filename + " · read as " + p.source + (p.sheetName ? " (" + p.sheetName + ")" : "")],
        ["Rows", String(sum.rows)],
        ["Clients to create", String(sum.clientsToCreate)],
        ["Contacts to create", String(sum.contactsToCreate)],
        ["Policies to create", String(sum.policiesToCreate)],
        ["Need a decision / invalid", sum.needsReview + " / " + sum.invalid],
      ]),
    );
    if (p.blocking.length) blocks.push(note("red", "Before this can be imported", p.blocking.join(" ")));
    if (p.blocking.some((b) => /premium/i.test(b)) || (p.columns.some((c) => c.meaning === "premium") && !p.batch.premiumBasis)) {
      blocks.push(gate("Premiums in this file are gross", "Premium before levies and taxes.", "import.basis", { basis: "gross" }));
      blocks.push(gate("Premiums in this file are total payable", "Premium including levies and taxes.", "import.basis", { basis: "total_payable" }));
    }
    blocks.push(
      rows(
        "What each row would do",
        p.rows.slice(0, 60).map((r) => ({
          title: "Line " + r.lineNumber + " · " + (r.clientName || "no client name"),
          note: [r.policyNumber, r.insurerName, r.classOfBusiness, r.periodStart && r.periodEnd ? r.periodStart + " – " + r.periodEnd : null, r.problem].filter(Boolean).join(" · ") || "—",
          badge: r.outcome.replace(/_/g, " "),
          badgeTone: r.outcome === "invalid" ? bad : r.outcome === "needs_review" ? warn : ok,
        })),
      ),
    );
    if (p.rows.length > 60) blocks.push(note("amber", "Showing the first 60 rows", p.rows.length + " rows were read; all of them are imported on confirm."));
    blocks.push(
      gate(
        "Import " + (sum.rows - sum.invalid - sum.needsReview) + " row(s)",
        "Creates the clients, contacts, policies and periods above. Rows that are invalid or need a decision are left out. Repeating this cannot import twice.",
        "import.commit",
        {},
        p.blocking.length ? { requires: "Resolve what is listed above first." } : {},
      ),
    );
    blocks.push(gate("Discard this file", "Nothing from it is saved.", "import.clear", {}));
  }
  if (state.importResult) {
    const r = state.importResult;
    blocks.push(
      note(
        r.failures.length ? "amber" : "green",
        "Imported " + r.batch.filename,
        [r.batch.clientsCreated + " clients", r.batch.contactsCreated + " contacts", r.batch.policiesCreated + " policies", r.batch.periodsCreated + " periods"].join(", ") +
          " created." +
          (r.failures.length ? " " + r.failures.length + " row(s) could not be written: " + r.failures.slice(0, 5).map((f) => "line " + f.lineNumber + " — " + f.problem).join("; ") : ""),
      ),
    );
  }
  return { kind: "Import", title: "Bring your book into ASAP", status: "draft", statusLabel: p ? p.summary.rows + " rows read" : "Nothing read yet", blocks };
}

/* ---------------------------------------------------------------- quotation */

function quoteSpace(ref, state) {
  if (ref.opportunityId) return opportunitySpace(ref.opportunityId, state);
  const client = ref.clientId ? S.sel.client(ref.clientId) : null;
  if (!client) return { kind: "Quotation work", title: "Which client is this for?", status: "draft", statusLabel: "Choose a client", blocks: clientPicker("Start quotation work for", (c) => ({ ws: "quote", clientId: c.id })) };
  const list = S.all("opportunities").filter((o) => o.clientId === client.id);
  return {
    kind: "Quotation work",
    title: client.name + " — quotation",
    status: "draft",
    statusLabel: list.filter((o) => o.status === "Open").length + " open",
    blocks: [
      ...(list.length
        ? [rows("Quotation work for this client", list.map((o) => ({ title: o.title, note: o.cls + " · started " + date(o.createdAt), badge: o.status, badgeTone: o.status === "Open" ? ok : warn, action: { a: "open", ref: { ws: "quote", opportunityId: o.id } } })))]
        : [note("green", "No quotation work yet", "Start it here: name the cover wanted and the class of business. Insurers, requirements and replies are added next.")]),
      form(
        "quote:" + client.id,
        "Start quotation work",
        [
          { key: "title", label: "WHAT COVER IS WANTED", placeholder: "Motor fleet — five vehicles" },
          { key: "cls", label: "CLASS OF BUSINESS", placeholder: "Motor" },
          { key: "coverStart", label: "COVER FROM (OPTIONAL)", type: "date" },
          { key: "coverEnd", label: "COVER TO (OPTIONAL)", type: "date" },
        ],
        "opportunity.create",
        { clientId: client.id },
        "Start quotation work",
        "Creates the quotation and its Work item. Nothing is sent to an insurer.",
      ),
    ],
  };
}

function opportunitySpace(id, state) {
  const d = state.opportunities.get(id);
  if (!d) return { kind: "Quotation work", title: "This quotation could not be read", status: "draft", statusLabel: "Unavailable", blocks: [note("red", "Not available", "Refresh records from your profile and try again. Nothing was changed.")] };
  const o = d.opportunity;
  const live = d.insurers.filter((i) => !i.removedAt);
  const quoted = live.filter((i) => i.response?.outcome === "quoted");
  const addable = d.availableInsurers.filter((a) => !live.some((i) => i.insurerId === a.id));
  const act = (action, extra) => ({ id, action, ...extra });
  const blocks = [
    facts([
      ["Client", d.client.name],
      ["Cover", o.title],
      ["Class", o.classOfBusiness],
      ["Cover period", o.coverStart ? date(o.coverStart) + " – " + date(o.coverEnd) : "not recorded"],
      ["Owner", o.ownerName || "not recorded"],
      ["Status", o.closedAt ? "Closed — " + (o.closedReason || "") : "Open"],
    ]),
    rows(
      "Requirements",
      d.requirements.length
        ? d.requirements.map((r) => ({
            title: r.label,
            note: r.suppliedAt ? "Supplied " + date(r.suppliedAt) + (r.suppliedByName ? " by " + r.suppliedByName : "") : "Outstanding",
            badge: r.suppliedAt ? "Supplied" : "Missing",
            badgeTone: r.suppliedAt ? ok : bad,
            secondary: !r.suppliedAt && d.permissions.canEdit ? { a: "act", action: "opp.action", payload: act("supply_requirement", { requirementId: r.id, note: "Marked supplied in ASAP" }), label: "Mark supplied" } : null,
          }))
        : [{ title: "No requirements recorded", note: "Add what the insurers will need.", badge: "Empty", badgeTone: warn }],
    ),
    ...(d.permissions.canEdit ? [form("req:" + id, "Add a requirement", [{ key: "label", label: "REQUIREMENT", placeholder: "Logbooks for all vehicles" }], "opp.action", act("add_requirement"), "Add requirement")] : []),
    rows(
      "Insurers approached",
      live.length
        ? live.map((i) => ({
            title: i.insurerName,
            note: i.response
              ? i.response.outcome === "quoted"
                ? "Quoted " + money(i.response.premiumAmount, i.response.premiumCurrency) + (i.response.validUntil ? " · valid to " + date(i.response.validUntil) : "") + " · " + i.response.terms.length + " term(s)"
                : i.response.outcome === "declined"
                  ? "Declined" + (i.response.declineReason ? " — " + i.response.declineReason : "")
                  : "No response recorded as final"
              : i.request
                ? "Request prepared " + date(i.request.preparedAt) + (i.request.approvedAt ? " · approved" : " · awaiting approval") + (i.request.sentAt ? " · sent " + date(i.request.sentAt) : " · not sent")
                : "Added " + date(i.addedAt) + " · no request yet",
            badge: i.response ? i.response.outcome.replace(/_/g, " ") : i.request?.sentAt ? "With insurer" : "Not asked",
            badgeTone: i.response?.outcome === "quoted" ? ok : i.response ? warn : warn,
            secondary: !i.response && d.permissions.canRecordResponse ? { a: "act", action: "opp.action", payload: act("record_response", { opportunityInsurerId: i.id, outcome: "declined" }), label: "Record declined" } : null,
          }))
        : [{ title: "No insurers yet", note: addable.length ? "Add them from the list below." : "Insurers appear here once they are on file — importing your book adds them.", badge: "Empty", badgeTone: warn }],
    ),
    ...(addable.length && d.permissions.canEdit
      ? [rows("Insurers you can approach", addable.map((a) => ({ title: a.name, note: "On file in your brokerage", badge: "Available", badgeTone: ok, secondary: { a: "act", action: "opp.action", payload: act("add_insurer", { insurerId: a.id }), label: "Add" } })))]
      : []),
    ...live
      .filter((i) => !i.response && d.permissions.canRecordResponse)
      .map((i) =>
        form(
          "resp:" + i.id,
          "Record " + i.insurerName + "’s quote",
          [
            { key: "premiumAmount", label: "PREMIUM (NUMBERS ONLY)", placeholder: "485000" },
            { key: "premiumCurrency", label: "CURRENCY", value: "KES" },
            { key: "validUntil", label: "VALID UNTIL (OPTIONAL)", type: "date" },
            { key: "sourceNote", label: "WHERE IT CAME FROM", placeholder: "Email from the underwriter, 12 Sep" },
          ],
          "opp.action",
          act("record_response", { opportunityInsurerId: i.id, outcome: "quoted" }),
          "Record quote",
          "Recorded as the insurer's answer, with your name. Terms and excesses are added from the quotation document.",
        ),
      ),
    note(d.sending.available ? "green" : "amber", d.sending.available ? "Requests can be sent" : "Requests are not sent from ASAP yet", d.sending.reason || "Every request needs your approval before it leaves."),
  ];
  if (quoted.length >= 2) blocks.push(note("green", quoted.length + " quotes to compare", "Comparing them side by side is not connected in this view yet; each quote's premium and terms are listed above."));
  return { kind: "Quotation work", title: d.client.name + " — " + o.title, status: o.closedAt ? "draft" : "live", statusLabel: quoted.length + " of " + live.length + " quoted", recordRef: { ws: "quote", opportunityId: id }, blocks };
}

/* ---------------------------------------------------------------- claims */

function newClaimSpace(ref) {
  const client = ref.clientId ? S.sel.client(ref.clientId) : null;
  if (!client) return { kind: "Claim", title: "Which client is the claim for?", status: "draft", statusLabel: "Choose a client", blocks: clientPicker("Report a claim for", (c) => ({ ws: "claim", clientId: c.id })) };
  const existing = S.sel.claims(client.id);
  return {
    kind: "Claim",
    title: client.name + " — report a claim",
    status: "draft",
    statusLabel: existing.length + " on file",
    blocks: [
      note("amber", "What reporting a claim does", "It opens the claim as a draft with its Work item. It never means the loss is covered or accepted — that takes the insurer's written decision."),
      form(
        "claim:" + client.id,
        "The loss, as the client reported it",
        [
          { key: "incidentOn", label: "DATE OF LOSS", type: "date" },
          { key: "incidentSummary", label: "WHAT HAPPENED", placeholder: "Vehicle KDA 123A hit from behind at Westlands" },
        ],
        "claim.open",
        { clientId: client.id },
        "Report the claim",
        "Creates a draft claim and its Work item in your brokerage.",
      ),
      ...(existing.length
        ? [rows("Claims already on file", existing.map((c) => ({ title: c.title, note: date(c.lossAt) + " · " + c.status, badge: c.status, badgeTone: warn, action: { a: "open", ref: { ws: "claim", clientId: client.id, claimId: c.id } } })))]
        : []),
    ],
  };
}

/* ---------------------------------------------------------------- settings and connections */

function settingsSpace(state) {
  const org = state.me.active_organization;
  const members = state.members;
  return {
    kind: "Company settings",
    title: org.name,
    status: "live",
    statusLabel: members.length + " member" + (members.length === 1 ? "" : "s"),
    blocks: [
      facts([
        ["Brokerage", org.name],
        ["Country", org.country || "not recorded"],
        ["Currency", org.currency || "not recorded"],
        ["Time zone", org.timezone || "not recorded"],
        ["Your permissions", String(state.me.permissions.length)],
      ]),
      rows(
        "Team and roles",
        members.map((m) => ({
          title: m.user.display_name || m.user.full_name || m.user.email,
          note: m.role.name + (m.is_owner ? " · owner" : "") + " · " + m.user.email,
          badge: m.status,
          badgeTone: m.status === "active" ? ok : warn,
          action: { a: "open", ref: { ws: "team", userId: m.user.id } },
        })),
      ),
      rows(
        "Recent audit",
        S.sel.audit().slice(0, 10).map((a) => ({ title: a.text, note: date(a.at) + " · " + (a.actorName || "system"), badge: a.kind, badgeTone: ok })),
      ),
      note("amber", "Changing roles and inviting people", "Roles and invitations are managed by the brokerage's owner; changing them from this view is not connected yet."),
    ],
  };
}

function connectionsSpace(state) {
  const mb = state.mailboxes;
  const box = mb?.mailboxes?.[0] ?? null;
  const providers = mb?.providers ?? [];
  const mailNote = box
    ? box.emailAddress + " · " + box.status.replace(/_/g, " ") + (box.statusReason ? " — " + box.statusReason : "") + (box.lastSyncedAt ? " · last read " + date(box.lastSyncedAt) : "")
    : providers.length
      ? providers.map((p) => p.label + (p.available ? " can be connected" : " is not available: " + (p.unavailableReason || "not configured"))).join(" · ")
      : "No mailbox is connected.";
  return {
    kind: "Connections",
    title: "Connected email and data",
    status: "live",
    statusLabel: box && box.status === "connected" ? "Mailbox connected" : "No mailbox connected",
    blocks: [
      rows("What is connected", [
        { title: "Email", note: mailNote, badge: box ? box.status.replace(/_/g, " ") : "not connected", badgeTone: box?.status === "connected" ? ok : warn },
        { title: "Records import", note: "Spreadsheets, CSV and PDF books are read on ASAP's own server.", badge: "available", badgeTone: ok, action: { a: "open", ref: { ws: "import" } } },
        { title: "Documents", note: "Stored privately for this brokerage and read by ASAP's own extraction service.", badge: "available", badgeTone: ok },
        { title: "Ask ASAP", note: "Answers from your records. Questions it cannot match are sent to ASAP's server, which says when no model is configured.", badge: "available", badgeTone: ok },
      ]),
      note("green", "Read from the server", "Each status above comes from your brokerage's records on the server, not from this browser."),
    ],
  };
}

/** A live workspace for `ref`, or null when the engine's own workspace should be used. */
export function liveSpace(ref, state) {
  if (!ref) return null;
  switch (ref.ws) {
    case "clients":
      return clientsSpace();
    case "newclient":
      return newClientSpace(state);
    case "import":
      return importSpace(state);
    case "quote":
      return quoteSpace(ref, state);
    case "claim":
      return ref.claimId ? null : newClaimSpace(ref);
    case "settings":
      return settingsSpace(state);
    case "connections":
      return connectionsSpace(state);
    default:
      return null;
  }
}
