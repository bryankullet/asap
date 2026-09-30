/**
 * Live workspaces the approved engine has no live source for, built from this brokerage's API data
 * in the engine's own block vocabulary (facts, rows, note, gate, upload, builder, assign) so they
 * render in the approved interface exactly as its other workspaces do.
 *
 * Every value shown comes from an API response. Nothing here is example content.
 */
import { IMPORT_COLUMN_SYNONYMS } from "@asap/schema";
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

export const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const date = (iso) => (iso ? S.fmtDate(iso) : "not recorded");
const money = (amount, currency) => (amount == null ? "not recorded" : (currency || "") + " " + Number(amount).toLocaleString("en-KE"));
const words = (s) => (s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

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
    title: clients.length ? plural(clients.length, "client", "clients") : "No clients yet",
    status: "live",
    statusLabel: clients.length + " on file",
    blocks: clients.length
      ? [
          rows(
            "Your clients",
            clients.map((c) => {
              const pols = S.sel.policies(c.id).length;
              const open = S.sel.work({ clientId: c.id }).filter((w) => w.state !== "Completed").length;
              return { title: c.name, note: plural(pols, "policy", "policies") + " · " + plural(open, "open item", "open items"), badge: c.legacyInvalid ? "Legacy — needs correction" : "Open", badgeTone: c.legacyInvalid ? bad : ok, action: { a: "open", ref: { ws: "client", clientId: c.id } } };
            }),
          ),
          nav("Add a client", "Start with the client's name.", { ws: "newclient" }),
        ]
      : clientPicker("", () => ({})),
  };
}

function newClientSpace(state, ref = {}) {
  // A duplicate result describes one name only: opening the form for a different name drops it.
  if (ref.name && state.duplicate && state.duplicate.name.toLowerCase() !== ref.name.toLowerCase()) state.duplicate = null;
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
          { key: "name", label: "CLIENT NAME", placeholder: "The name on their documents", value: ref.name || "" },
          { key: "kind", label: "COMPANY OR PERSON", value: ref.kind || undefined, options: [{ value: "corporate", label: "Company" }, { value: "individual", label: "Person" }] },
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

/** The headers the server reads, one per meaning: the first spelling is the one to use. */
export const IMPORT_HEADERS = Object.entries(IMPORT_COLUMN_SYNONYMS).map(([meaning, spellings]) => ({ meaning, header: spellings[0], also: spellings.slice(1) }));

function importSpace(state) {
  const p = state.importPreview;
  const blocks = [
    note("amber", "Nothing is saved until you confirm", "ASAP reads the file privately, shows what each row would do, and waits for you. If a client is only a possible match, you choose — ASAP never assumes."),
    { t: "upload", label: "Choose a spreadsheet, CSV or PDF of clients and policies", action: "import.preview" },
  ];
  if (state.importError && !p) blocks.push(note("red", state.importError.title, state.importError.text));
  if (!p)
    blocks.push(
      rows(
        "Column headings ASAP reads",
        IMPORT_HEADERS.map((h) => ({ title: h.header, note: h.meaning === "client_name" ? "Required · also read: " + h.also.slice(0, 4).join(", ") : "Also read: " + h.also.slice(0, 4).join(", "), badge: h.meaning === "client_name" ? "Required" : "Optional", badgeTone: h.meaning === "client_name" ? bad : ok })),
      ),
      gate("Download a template", "A CSV with every heading ASAP reads, ready to fill in.", "import.template", {}),
    );
  if (p) {
    const sum = p.summary;
    const choices = state.importResolutions;
    const resolved = p.rows.filter((r) => r.outcome === "needs_review" && choices.has(r.lineNumber)).length;
    const writable = sum.rows - sum.invalid - sum.needsReview + resolved;
    blocks.push(
      facts([
        ["File", p.batch.filename + " · read as " + p.source + (p.sheetName ? " (" + p.sheetName + ")" : "")],
        ["Rows read", String(sum.rows)],
        ["New clients", String(sum.clientsToCreate)],
        ["New contacts", String(sum.contactsToCreate)],
        ["New policies", String(sum.policiesToCreate)],
        ["Your decision needed / invalid", sum.needsReview + " / " + sum.invalid],
      ]),
    );
    if (p.blocking.length) blocks.push(note("red", "Before this can be imported", p.blocking.join(" ")));
    const unmapped = p.columns.filter((c) => !c.meaning).map((c) => c.header);
    if (unmapped.length) blocks.push(note("amber", "Headings ASAP did not recognise", unmapped.join(", ") + " — these columns are ignored. Rename them to a heading from the list if they matter."));
    if (p.blocking.some((b) => /premium/i.test(b)) || (p.columns.some((c) => c.meaning === "premium_amount") && !p.batch.premiumBasis)) {
      blocks.push(gate("Premiums in this file are gross", "Premium before levies and taxes.", "import.basis", { basis: "gross" }));
      blocks.push(gate("Premiums in this file are total payable", "Premium including levies and taxes.", "import.basis", { basis: "total_payable" }));
    }
    const nameOf = (id) => S.sel.client(id)?.name || "an existing client";
    blocks.push(
      rows(
        "What each row would do",
        p.rows.slice(0, 60).map((r) => {
          const choice = choices.get(r.lineNumber);
          const doing =
            r.outcome === "match" && r.matchedClientId
              ? "Adds to existing client " + nameOf(r.matchedClientId) + " (same name)"
              : r.outcome === "match"
                ? "Adds to the client created by an earlier line"
                : r.outcome === "create"
                  ? "Creates client “" + r.clientName + "”"
                  : r.outcome === "needs_review"
                    ? choice === undefined
                      ? "Your decision: could be " + r.candidates.map((c) => c.name).join(" or ")
                      : choice === null
                        ? "You chose: create a new client “" + r.clientName + "”"
                        : "You chose: add to " + (r.candidates.find((c) => c.id === choice)?.name || "the chosen client")
                    : r.problem || "Cannot be imported";
          return {
            title: "Line " + r.lineNumber + " · " + (r.clientName || "no client name"),
            note: doing + ([r.policyNumber, r.insurerName, r.periodStart && r.periodEnd ? r.periodStart + " – " + r.periodEnd : null].filter(Boolean).length ? " · " + [r.policyNumber, r.insurerName, r.periodStart && r.periodEnd ? r.periodStart + " – " + r.periodEnd : null].filter(Boolean).join(" · ") : ""),
            badge: r.outcome === "needs_review" ? (choice === undefined ? "Choose" : "Decided") : words(r.outcome),
            badgeTone: r.outcome === "invalid" ? bad : r.outcome === "needs_review" && choice === undefined ? warn : ok,
          };
        }),
      ),
    );
    for (const r of p.rows.filter((x) => x.outcome === "needs_review")) {
      blocks.push(
        rows(
          "Line " + r.lineNumber + " — which client is “" + r.clientName + "”?",
          [
            ...r.candidates.map((c) => ({ title: c.name, note: "An existing client whose name overlaps", badge: choices.get(r.lineNumber) === c.id ? "Chosen" : "Possible", badgeTone: choices.get(r.lineNumber) === c.id ? ok : warn, secondary: { a: "act", action: "import.resolve", payload: { lineNumber: r.lineNumber, clientId: c.id }, label: "It is this client" } })),
            { title: "A different client", note: "Create a new client called “" + r.clientName + "”", badge: choices.get(r.lineNumber) === null ? "Chosen" : "Possible", badgeTone: choices.get(r.lineNumber) === null ? ok : warn, secondary: { a: "act", action: "import.resolve", payload: { lineNumber: r.lineNumber, clientId: null }, label: "Create new" } },
          ],
        ),
      );
    }
    if (p.rows.length > 60) blocks.push(note("amber", "Showing the first 60 rows", plural(p.rows.length, "row was", "rows were") + " read; every writable one is imported on confirm."));
    blocks.push(
      gate(
        "Import " + plural(writable, "row", "rows"),
        "Creates the clients, contacts, policies and periods above. Invalid rows, and rows still waiting for your decision, are left out. Repeating this cannot import twice.",
        "import.commit",
        {},
        p.blocking.length ? { requires: "Resolve what is listed above first." } : writable === 0 ? { requires: "No row can be imported yet." } : {},
      ),
    );
    blocks.push(gate("Discard this file", "Nothing from it is saved.", "import.clear", {}));
  }
  if (state.importResult) {
    const r = state.importResult;
    const b = r.batch;
    const made = [b.clientsCreated ? plural(b.clientsCreated, "client", "clients") : null, b.contactsCreated ? plural(b.contactsCreated, "contact", "contacts") : null, b.policiesCreated ? plural(b.policiesCreated, "policy", "policies") : null].filter(Boolean);
    blocks.push(
      note(
        r.failures.length || r.unverified ? "amber" : "green",
        "Imported " + b.filename,
        (made.length ? "Created " + made.join(", ") + "." : "Nothing new was created.") +
          (r.unverified ? " " + r.unverified : "") +
          (r.failures.length ? " " + plural(r.failures.length, "row", "rows") + " could not be written: " + r.failures.slice(0, 5).map((f) => "line " + f.lineNumber + " — " + f.problem).join("; ") : ""),
      ),
    );
  }
  return { kind: "Import", title: "Bring your book into ASAP", status: "draft", statusLabel: p ? plural(p.summary.rows, "row read", "rows read") : "Nothing read yet", blocks };
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
        : [note("green", "No quotation work yet", "Start it here: describe the cover wanted and its class of business. Insurers, requirements and replies are added next.")]),
      form(
        "quote:" + client.id,
        "Start quotation work",
        [
          { key: "title", label: "WHAT COVER IS WANTED", placeholder: "Motor fleet — five vehicles" },
          { key: "cls", label: "CLASS OF BUSINESS", placeholder: "Motor commercial" },
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

// Records saved before today's validation (a one-letter title, a supply with no real evidence)
// are shown as they are but named for what they are, so nobody takes them as sound.
const LEGACY = "Legacy record — invalid, needs correction";
const tooShort = (v, n = 3) => (v || "").trim().length < n;
const weakSupply = (r) => r.suppliedAt && (/^marked supplied in asap$/i.test((r.evidence?.label || r.evidenceNote || "").trim()) || tooShort(r.evidence?.label || r.evidenceNote, 10));

const DELIVERY_METHODS = [
  { value: "own_email", label: "Copied into my own email" },
  { value: "portal", label: "Uploaded to the insurer's portal" },
  { value: "printed", label: "Printed and delivered" },
  { value: "hand_delivered", label: "Handed over in person" },
  { value: "phone", label: "Read out on the phone" },
  { value: "other", label: "Another way" },
];
const deliveryWords = (m) => (DELIVERY_METHODS.find((x) => x.value === m)?.label || "hand").toLowerCase();

/** The request text a person would send, prepared from the records — edited before approval. */
export function requestDraft(d, insurerName) {
  const o = d.opportunity;
  const reqs = d.requirements.filter((r) => r.suppliedAt).map((r) => "- " + r.label);
  return [
    "Dear " + insurerName + " underwriting team,",
    "",
    "We invite terms for " + o.classOfBusiness + " cover for our client " + d.client.name + (o.coverStart ? ", from " + date(o.coverStart) + (o.coverEnd ? " to " + date(o.coverEnd) : "") : "") + ".",
    o.riskSummary ? "\nThe risk: " + o.riskSummary : "",
    reqs.length ? "\nEnclosed:\n" + reqs.join("\n") : "",
    "",
    "Please reply with your premium, excess, key conditions and how long the terms are valid.",
  ].filter((x) => x !== "").join("\n");
}

/**
 * Where the quotation stands, read from its records — never authored. Each stage is done only
 * when the record that proves it exists: a request prepared is not a request sent.
 */
function stagesBlock(d, live) {
  const any = (f) => live.some(f);
  const withIns = live.filter((i) => i.stage === "with_insurer").map((i) => i.insurerName);
  const required = d.requirements.filter((r) => r.required !== false);
  const steps = [
    ["Need recorded", true, d.opportunity.title],
    ["Requirements gathered", required.length > 0 && required.every((r) => r.suppliedAt), required.length ? required.filter((r) => r.suppliedAt).length + " of " + required.length + " supplied" : "None recorded"],
    ["Insurers selected", live.length > 0, live.length ? live.map((i) => i.insurerName).join(", ") : "None yet"],
    ["Request prepared", any((i) => !!i.request), ""],
    ["Reviewed and approved", any((i) => !!i.request?.approvedAt), "Approval does not send it"],
    ["Delivered by a person, with evidence", any((i) => !!i.request?.delivery), "Copy or download it, deliver it yourself, record how"],
    [withIns.length ? "With " + withIns.join(", ") : "With the insurer", any((i) => ["with_insurer", "quoted", "declined"].includes(i.stage)), ""],
    ["Response received", any((i) => !!i.response), ""],
    ["Terms reviewed", any((i) => (i.response?.terms?.length ?? 0) > 0), ""],
    ["Comparison ready", !!d.comparisonView?.comparison, ""],
  ];
  const now = steps.findIndex(([, done]) => !done);
  return rows(
    "Where this quotation stands",
    steps.map(([title, done, note], k) => ({ title, note: note || (done ? "Done" : k === now ? "This is the current step" : "Not yet"), badge: done ? "Done" : k === now ? "Now" : "Later", badgeTone: done ? ok : k === now ? warn : "neutral" })),
  );
}

function insurerControls(i, d, act) {
  const out = [];
  const reqText = i.request ? i.request.subject + "\n\n" + i.request.body : "";
  if (i.stage === "not_asked" && d.permissions.canEdit)
    out.push(
      form(
        "prep:" + i.id,
        "Prepare the request to " + i.insurerName,
        [
          { key: "subject", label: "SUBJECT", value: "Quotation request — " + d.client.name + ", " + d.opportunity.classOfBusiness },
          { key: "body", label: "REQUEST", value: requestDraft(d, i.insurerName), multiline: true },
        ],
        "opp.action",
        act("prepare_request", { opportunityInsurerId: i.id }),
        "Prepare request",
        "Saved as a draft for approval. Nothing is sent — ASAP has no mailbox connected.",
      ),
    );
  if (i.stage === "request_prepared")
    out.push(
      d.permissions.canApprove
        ? gate("Approve the request to " + i.insurerName, "You approve this exact text. Editing it afterwards clears the approval. Approving does not send it.", "opp.action", act("approve_request", { quoteRequestId: i.request.id }), { label: "Approve request" })
        : note("amber", "Waiting for approval", "The request to " + i.insurerName + " needs approval by someone who may approve messages leaving the brokerage."),
    );
  if (i.stage === "approved_to_deliver") {
    out.push(
      rows("Approved request to " + i.insurerName, [
        { title: i.request.subject, note: "Copy it into the email or portal it should go from. ASAP does not send it.", badge: "Copy", badgeTone: ok, action: { a: "copy", text: reqText } },
        { title: "Download as a text file", note: "For printing or attaching.", badge: "Download", badgeTone: ok, action: { a: "download", filename: "Quotation request - " + i.insurerName + ".txt", text: reqText } },
      ]),
      form(
        "deliver:" + i.id,
        "Record how it reached " + i.insurerName,
        [
          { key: "method", label: "HOW IT WENT", options: DELIVERY_METHODS },
          { key: "reference", label: "WHAT PROVES IT", placeholder: "Emailed from Outlook to underwriting@… on 30 Sep, 10:02" },
          { key: "deliveredOn", label: "DATE DELIVERED (IF NOT TODAY)", type: "date" },
        ],
        "opp.action",
        act("record_delivery", { quoteRequestId: i.request.id }),
        "Record delivery",
        "Recorded as delivered by you, with this reference. It is not recorded as sent — nothing left through ASAP.",
      ),
    );
  }
  if (i.stage === "with_insurer" && d.permissions.canRecordResponse) out.push(responseForm(i, act, false));
  // A reply that came without a delivered request is allowed, but only as an explicit manual record.
  if (["not_asked", "request_prepared", "approved_to_deliver"].includes(i.stage) && d.permissions.canRecordResponse) out.push(responseForm(i, act, true));
  return out;
}

function responseForm(i, act, withoutRequest) {
  return form(
    (withoutRequest ? "resp-manual:" : "resp:") + i.id,
    withoutRequest ? "Manual record: " + i.insurerName + " replied without a delivered request" : "Record " + i.insurerName + "’s reply",
    [
      { key: "outcome", label: "ANSWER", options: [{ value: "quoted", label: "Quoted" }, { value: "declined", label: "Declined" }] },
      { key: "premiumAmount", label: "PREMIUM, IF QUOTED (NUMBERS ONLY)", placeholder: "485000" },
      { key: "premiumCurrency", label: "CURRENCY", options: ["KES", "USD", "EUR", "GBP"] },
      { key: "validUntil", label: "VALID UNTIL (OPTIONAL)", type: "date" },
      { key: "declineReason", label: "REASON, IF DECLINED", placeholder: "Outside their appetite for this class" },
      { key: "sourceNote", label: "WHERE IT CAME FROM", placeholder: "Email from the underwriter, 12 Sep" },
    ],
    "opp.action",
    act("record_response", { opportunityInsurerId: i.id, ...(withoutRequest ? { withoutRequest: "yes" } : {}) }),
    withoutRequest ? "Record as received without a request" : "Record reply",
    withoutRequest ? "Only for a reply that genuinely arrived with no request delivered — for example an answer on the phone. It is recorded as such." : "Recorded as the insurer's reply, with your name.",
  );
}

/** The server's next action, shown the same way on every quotation. */
function nextBlock(n) {
  if (!n) return [];
  const bits = [n.why];
  if (n.missing?.length) bits.push("Missing: " + n.missing.join("; ") + ".");
  if (n.holder === "outside_party" && n.party) bits.push("With " + n.party + (n.since ? " since " + date(n.since) : "") + ".");
  if (n.checkAt) bits.push("Look again " + date(n.checkAt) + ".");
  return [note(n.holder === "outside_party" ? "amber" : n.stage === "closed" ? "green" : "green", "Next: " + n.what, bits.join(" "))];
}

function opportunitySpace(id, state) {
  const d = state.opportunities.get(id);
  if (!d) return { kind: "Quotation work", title: "This quotation could not be read", status: "draft", statusLabel: "Unavailable", blocks: [note("red", "Not available", "Refresh records from your profile and try again. Nothing was changed.")] };
  const o = d.opportunity;
  const live = d.insurers.filter((i) => !i.removedAt);
  const quoted = live.filter((i) => i.response?.outcome === "quoted");
  const addable = d.availableInsurers.filter((a) => !live.some((i) => i.insurerId === a.id));
  const outstanding = d.requirements.filter((r) => !r.suppliedAt);
  const act = (action, extra) => ({ id, action, ...extra });
  const legacy = tooShort(o.title) || tooShort(o.classOfBusiness) || tooShort(d.client.name, 2) || d.requirements.some((r) => tooShort(r.label) || weakSupply(r));
  const blocks = [
    ...nextBlock(d.next),
    stagesBlock(d, live),
    ...(legacy ? [note("red", LEGACY, "Some of this quotation was saved before ASAP checked its details — a title, class or requirement too short to mean anything, or a requirement marked supplied without evidence. Correct it before relying on it.")] : []),
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
            note: r.suppliedAt ? "Supplied " + date(r.suppliedAt) + (r.suppliedByName ? " by " + r.suppliedByName : "") + (r.evidence?.label ? " · " + r.evidence.label : "") : "Outstanding",
            badge: tooShort(r.label) || weakSupply(r) ? "Legacy — needs correction" : r.suppliedAt ? "Supplied" : "Missing",
            badgeTone: tooShort(r.label) || weakSupply(r) ? bad : r.suppliedAt ? ok : bad,
          }))
        : [{ title: "No requirements recorded", note: "Add what the insurers will need.", badge: "Empty", badgeTone: warn }],
    ),
    ...(d.permissions.canEdit && outstanding.length
      ? [
          form(
            "supply:" + id,
            "Mark a requirement supplied",
            [
              { key: "requirementId", label: "REQUIREMENT", options: outstanding.map((r) => ({ value: r.id, label: r.label })) },
              { key: "note", label: "WHAT PROVES IT", placeholder: "Logbooks received by email from the client on 12 Sep" },
            ],
            "opp.action",
            act("supply_requirement"),
            "Mark supplied",
            "Recorded with your name and what you wrote as its evidence.",
          ),
        ]
      : []),
    ...(d.permissions.canEdit ? [form("req:" + id, "Add a requirement", [{ key: "label", label: "REQUIREMENT", placeholder: "Logbooks for all vehicles" }], "opp.action", act("add_requirement"), "Add requirement")] : []),
    rows(
      "Insurers approached",
      live.length
        ? live.map((i) => ({
            title: i.insurerName,
            note: i.response
              ? i.response.outcome === "quoted"
                ? "Quoted " + money(i.response.premiumAmount, i.response.premiumCurrency) + (i.response.validUntil ? " · valid to " + date(i.response.validUntil) : "") + " · " + plural(i.response.terms.length, "term", "terms")
                : i.response.outcome === "declined"
                  ? "Declined" + (i.response.declineReason ? " — " + i.response.declineReason : "")
                  : "Recorded as no response"
              : i.request?.delivery
                ? "Delivered " + date(i.request.delivery.deliveredAt) + " by " + deliveryWords(i.request.delivery.method) + " · " + i.request.delivery.reference
                : i.request
                  ? "Prepared " + date(i.request.preparedAt) + (i.request.approvedAt ? " · approved " + date(i.request.approvedAt) + (i.request.approvedByName ? " by " + i.request.approvedByName : "") : "")
                  : "Added " + date(i.addedAt),
            badge: i.stageLabel,
            badgeTone: i.stage === "quoted" ? ok : i.stage === "declined" ? bad : warn,
          }))
        : [{ title: "No insurers yet", note: addable.length ? "Add them from the list below." : "Insurers appear here once they are on file — importing your book adds them.", badge: "Empty", badgeTone: warn }],
    ),
    ...(addable.length && d.permissions.canEdit
      ? [rows("Insurers you can approach", addable.map((a) => ({ title: a.name, note: "On file in your brokerage", badge: "Available", badgeTone: ok, secondary: { a: "act", action: "opp.action", payload: act("add_insurer", { insurerId: a.id }), label: "Add" } })))]
      : []),
    // One control per insurer: the one its stage calls for, and nothing ahead of it.
    ...live.flatMap((i) => insurerControls(i, d, act)),
    note(d.sending.available ? "green" : "amber", d.sending.available ? "Requests can be sent" : "ASAP does not send requests", d.sending.reason || "Every request needs your approval before it leaves."),
  ];
  const cv = d.comparisonView;
  if (cv?.comparison) blocks.push(note("green", "Comparison ready", "Built " + date(cv.comparison.generatedAt) + " from the recorded quotes" + (cv.comparison.stale ? " — a quote has changed since, so build it again before presenting." : ". Present it to the client once reviewed.")));
  else if (cv?.readiness?.ready && cv.permissions?.canGenerate) blocks.push(gate("Build the comparison", "From the " + plural(quoted.length, "recorded quote", "recorded quotes") + " and their terms. Nothing is sent to the client.", "comparison.generate", { id }, { label: "Build comparison" }));
  else if (cv?.readiness && !cv.readiness.ready) blocks.push(note("amber", "Comparison not ready yet", cv.readiness.blockers.join(" ")));
  return { kind: "Quotation work", title: d.client.name + " — " + o.title, status: o.closedAt ? "draft" : "live", statusLabel: quoted.length + " of " + live.length + " quoted", recordRef: { ws: "quote", opportunityId: id }, blocks };
}

/* ---------------------------------------------------------------- claims */

function newClaimSpace(ref) {
  const client = ref.clientId ? S.sel.client(ref.clientId) : null;
  if (!client) return { kind: "Claim", title: "Which client is the claim for?", status: "draft", statusLabel: "Choose a client", blocks: clientPicker("Report a claim for", (c) => ({ ws: "claim", clientId: c.id })) };
  const existing = S.sel.claims(client.id);
  const years = S.sel.policyYears(client.id);
  const active = years.filter((y) => y.status === "active");
  const policyOptions = years.map((y) => {
    const pol = S.byId("policies", y.policyId);
    return { value: y.policyId, label: (pol?.number || "Number not recorded") + " · " + (pol?.cls || "") + " · " + date(y.from) + " – " + date(y.to) + " · " + (y.status === "active" ? "Active cover" : y.status) };
  });
  return {
    kind: "Claim",
    title: client.name + " — report a claim",
    status: "draft",
    statusLabel: existing.length + " on file",
    blocks: [
      note("amber", "What reporting a claim does", "It opens the claim as a draft with its Work item. It never means the loss is covered or accepted — that takes the insurer's written decision."),
      ...(active.length ? [] : [note("red", years.length ? "No active cover found for this client" : "No policy found for this client", years.length ? "None of this client's policies shows verified active cover today. Choose the policy the loss falls under, or report it with the policy marked unknown." : "Import or record the client's policy first, or report the loss with the policy marked unknown — the claim then says so everywhere it appears.")]),
      form(
        "claim:" + client.id,
        "The loss, as the client reported it",
        [
          // Values carried from Ask or the policy in front are kept, never dropped.
          { key: "policyId", label: "POLICY THE LOSS FALLS UNDER", value: ref.policyId || undefined, options: [...policyOptions, { value: "unknown", label: "Policy not known yet — report without one" }] },
          { key: "incidentOn", label: "DATE OF LOSS", type: "date", value: ref.incidentOn || "" },
          { key: "incidentSummary", label: "WHAT HAPPENED", placeholder: "Vehicle KDA 123A hit from behind at Westlands", value: ref.incidentSummary || "" },
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

/**
 * A claim, read from its record: what was reported, which policy (or that it is not known), the
 * documents it needs, and the server's next action. No notification draft is offered here: none
 * can be addressed while no mailbox is connected, and none before the insurer and policy are known.
 */
function claimSpace(ref, state) {
  const d = state.claims?.get(ref.claimId);
  const row = S.byId("claims", ref.claimId);
  if (!d || !row) return { kind: "Claim", title: "This claim could not be read", status: "draft", statusLabel: "Unavailable", blocks: [note("red", "Not available", "Refresh records and try again. Nothing was changed.")] };
  const c = d.claim;
  const client = S.sel.client(c.client_id);
  const pol = c.policy_id ? S.byId("policies", c.policy_id) : null;
  const w = S.all("workItems").find((x) => x.id === c.work_item_id);
  const step = (d.item?.steps || []).find((st) => st.state === "now" || st.state === "blocked");
  const stepMissing = step ? step.evidence.filter((e) => !step.recorded.some((r) => r.kind === e.kind)).map((e) => e.label) : [];
  const status = { draft: "Draft — not registered", registered: "Registered", closed: "Closed" }[c.status] || c.status;
  return {
    kind: "Claim",
    title: (client ? client.name + " — " : "") + "claim, " + date(c.incident_on),
    status: c.status === "draft" ? "draft" : "live",
    statusLabel: status,
    recordRef: { ws: "claim", clientId: c.client_id, claimId: c.id },
    blocks: [
      ...(w?.next ? nextBlock(w.next) : []),
      facts([
        ["Client", client ? client.name : "not recorded"],
        ["Policy", pol ? pol.number + " — " + (pol.cls || "") : "Not known yet — to be matched before registering"],
        ["Date of loss", date(c.incident_on)],
        ["What happened", c.incident_summary],
        ["Where it stands", status],
        ["Insurer reference", c.insurer_reference || "none yet"],
      ]),
      rows(
        "Documents the claim needs",
        d.documents.length || stepMissing.length
          ? [
              ...d.documents.map((doc) => ({ title: doc.label, note: doc.received_at ? "Received " + date(doc.received_at) : doc.requested_at ? "Requested " + date(doc.requested_at) + " from the " + words(doc.holder).toLowerCase() : "Not requested yet", badge: doc.received_at ? "Received" : "Missing", badgeTone: doc.received_at ? ok : bad })),
              ...stepMissing.filter((m) => !d.documents.some((doc) => doc.label === m)).map((m) => ({ title: m, note: "Needed before the claim can move", badge: "Missing", badgeTone: bad })),
            ]
          : [{ title: "No document list yet", note: "The insurer's claim form and supporting documents are requested once the policy is known.", badge: "Pending", badgeTone: warn }],
      ),
      note("amber", "Nothing is sent from here", "No message goes to the insurer from ASAP: no mailbox is connected, and a notification is only prepared once the insurer and the policy are known — and then it waits for your approval. Nothing here says the loss is covered; that is the insurer's written decision."),
      ...(d.notes.length ? [rows("Notes", d.notes.map((n) => ({ title: n.body.slice(0, 120), note: date(n.noted_at) + (n.spoke_with ? " · with " + n.spoke_with : ""), badge: words(n.kind), badgeTone: ok })))] : []),
      ...(client ? [nav("Open " + client.name, "The client's policies, documents and other work.", { ws: "client", clientId: client.id })] : []),
    ],
  };
}

/* ---------------------------------------------------------------- work items */

function workItemSpace(ref) {
  const w = S.byId("workItems", ref.workItemId);
  if (!w) return { kind: "Work", title: "This item is no longer open", status: "draft", statusLabel: "Unavailable", blocks: [note("amber", "Not found", "It may have been completed or moved. Your Work list shows everything open.")] };
  const client = w.clientId ? S.sel.client(w.clientId) : null;
  const owner = w.assigneeId ? S.sel.user(w.assigneeId) : null;
  const claim = S.all("claims").find((c) => c.workItemId === w.id);
  return {
    kind: w.kind,
    title: w.title,
    status: w.state === "Completed" ? "draft" : "live",
    statusLabel: w.state === "Completed" ? "Done" : w.statusLabel || "In progress",
    blocks: [
      facts([
        ["Client", client ? client.name : "Brokerage-wide"],
        ["Kind", w.kind],
        ["Where it stands", w.statusLabel || (w.state === "Completed" ? "Done" : "In progress")],
        ["Owner", owner ? owner.name : "unassigned"],
        ["Priority", { high: "High priority", medium: "Normal priority", low: "Low priority" }[w.priority] || "Normal priority"],
        ["Look again", w.dueAt ? date(w.dueAt) : "not set"],
      ]),
      // The server's next action (D-120): the same words Today and Ask show for this item.
      ...(w.next ? nextBlock(w.next) : w.reason ? [note("green", "Why it is here", w.reason)] : []),
      ...(claim ? [nav("Open the claim", claim.title, { ws: "claim", clientId: w.clientId, claimId: claim.id })] : []),
      ...(w.opportunityId ? [nav("Open the quotation", "Requirements, insurers and replies.", { ws: "quote", opportunityId: w.opportunityId })] : []),
      ...(client ? [nav("Open " + client.name, "The client's policies, documents and other work.", { ws: "client", clientId: client.id })] : []),
      ...(w.state !== "Completed" ? [{ t: "assign", label: "Who holds it", workItemId: w.id }] : []),
    ],
  };
}

/** A contact for a client, through the same POST /contacts the client record uses. */
function newContactSpace(ref) {
  const c = ref.clientId ? S.sel.client(ref.clientId) : null;
  if (!c) return { kind: "Contact", title: "Choose the client first", status: "draft", statusLabel: "Not saved yet", blocks: [note("amber", "No client chosen", "Open the client, then add the contact from there. Nothing was changed.")] };
  return {
    kind: "Contact",
    title: "Add a contact for " + c.name,
    status: "draft",
    statusLabel: "Not saved yet",
    blocks: [
      form(
        "newcontact:" + c.id,
        "Contact",
        [
          { key: "fullName", label: "FULL NAME", placeholder: "Who ASAP should talk to" },
          { key: "roleLabel", label: "ROLE", placeholder: "For example Finance manager" },
          { key: "phone", label: "PHONE", placeholder: "+254…" },
          { key: "email", label: "EMAIL", placeholder: "name@company.co.ke" },
        ],
        "contact.create",
        { clientId: c.id },
        "Add contact",
        "Saved to " + c.name + "’s file as the primary contact. No message is sent to them.",
      ),
    ],
  };
}

/* ---------------------------------------------------------------- documents */

function documentSpace(ref, state) {
  const d = ref.documentId ? state.documents.get(ref.documentId) : null;
  if (!d) return null; // the engine's own document workspace, over what was hydrated
  const doc = d.document;
  const fields = d.fields || [];
  const open = fields.filter((f) => f.state === "proposed");
  const settled = fields.filter((f) => f.state === "accepted" || f.state === "corrected");
  const client = doc.clientId ? S.sel.client(doc.clientId) : null;
  const reading = { not_started: "Not read yet", queued: "Waiting to be read", working: "Being read now", extracted: "Read", failed: "Could not be read", not_applicable: "This kind of file is not read" }[doc.extractionState] || words(doc.extractionState);
  const valueOf = (f) => f.correctedValue ?? f.proposedValue;
  const focus = ref.fieldId ? fields.find((f) => f.id === ref.fieldId) : null;
  const fileLink = (page) => (d.fileUrl ? d.fileUrl + (page ? "#page=" + page : "") : null);
  const base = { ws: "document", documentId: doc.id };
  return {
    kind: "Document",
    title: doc.filename,
    status: doc.extractionState === "extracted" ? "live" : "draft",
    statusLabel: reading,
    recordRef: base,
    blocks: [
      ...(state.docNotice?.documentId === doc.id ? [note("green", state.docNotice.title, state.docNotice.text)] : []),
      ...identityWarning(fields, client),
      ...nextBlock(d.next),
      facts([
        ["Client", client ? client.name : "Not filed under a client"],
        ["Kind", words(doc.kind)],
        ["Pages", doc.pageCount == null ? "not counted yet" : String(doc.pageCount)],
        ["Reading", reading + (doc.extractionError ? " — " + doc.extractionError : "")],
        ["Filed", date(doc.createdAt)],
      ]),
      rows("Source file", [
        d.fileUrl
          ? { title: doc.filename, note: "Opens the stored file in a new tab. The link is private and short-lived; refresh records for a new one.", badge: "Open file", badgeTone: ok, action: { a: "link", url: fileLink(null) } }
          : { title: doc.filename, note: "The stored file could not be opened just now. Its text and the values read from it are shown here; refresh records to try again.", badge: "Unavailable", badgeTone: warn },
      ]),
      ...(focus ? evidenceBlocks(d, focus, fileLink, base) : []),
      ...(doc.extractionState === "extracted"
        ? [
            rows(
              "What ASAP read",
              fields.length
                ? fields.map((f) => ({
                    title: words(f.fieldKey),
                    note: (valueOf(f) ?? "nothing read") + (f.page ? " · page " + f.page + " — show where" : " · page not placed"),
                    badge: f.state === "proposed" ? "Proposed" : words(f.state),
                    badgeTone: f.state === "proposed" ? warn : f.state === "rejected" ? bad : ok,
                    ...(f.page ? { action: { a: "open", ref: { ...base, fieldId: f.id } } } : {}),
                  }))
                : [{ title: "Nothing to review", note: "ASAP found no fields it reads in this document.", badge: "Read", badgeTone: ok }],
            ),
            ...(open.length
              ? [
                  form(
                    "review:" + doc.id,
                    "Confirm what ASAP read",
                    open.map((f) => ({ key: f.id, label: words(f.fieldKey).toUpperCase() + (f.page ? " (PAGE " + f.page + ")" : ""), value: f.proposedValue ?? "" })),
                    "doc.review",
                    { documentId: doc.id },
                    "Confirm these values",
                    "Unchanged values are accepted; edited ones are saved as your correction beside what was read. Applying them to a record is the next step, after this.",
                  ),
                ]
              : []),
            ...(!open.length && settled.length ? applyBlocks(d, state) : []),
          ]
        : [note(doc.extractionState === "failed" ? "red" : "amber", reading, doc.extractionState === "failed" ? "Nothing was read from this file. It is still stored and can be opened." : "The values appear here for you to confirm once ASAP has read the file. Refresh records to check.")]),
    ],
  };
}

/** Names compared as a person would: case, punctuation and company suffixes do not matter. */
const comparable = (v) => (v || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(limited|ltd|plc|llc|inc|co|company|the)\b/g, " ").replace(/\s+/g, " ").trim();

/** A document that names a different insured than the client it is filed under is flagged first. */
function identityWarning(fields, client) {
  const f = fields.find((x) => x.fieldKey === "insured_name" && x.state !== "rejected");
  const named = (f?.correctedValue ?? f?.proposedValue ?? "").trim();
  if (!named || !client) return [];
  const a = comparable(named);
  const b = comparable(client.name);
  if (!a || !b || a === b || a.includes(b) || b.includes(a)) return [];
  return [note("red", "This document may belong to another client", "It names the insured as " + named + ", but it is filed under " + client.name + ". Nothing from it can be applied until that is resolved — file it under the right client, or correct the insured name.")];
}

/** The page a value was read from, with the value marked where it stands, and the file itself. */
function evidenceBlocks(d, f, fileLink, base) {
  const page = d.pages.find((p) => p.pageNumber === f.page);
  const value = (f.correctedValue ?? f.proposedValue ?? "").trim();
  const lines = page ? page.text.split(/\n/).map((l) => l.replace(/\|/g, "¦")).filter((l) => l.trim()) : [];
  let found = false;
  const marked = lines.map((l) => {
    const at = value ? l.toLowerCase().indexOf(value.toLowerCase()) : -1;
    if (at < 0) return l;
    found = true;
    return l.slice(0, at) + "|" + l.slice(at, at + value.length) + "|" + l.slice(at + value.length);
  });
  // Keep the page readable: the lines around the mark, not a wall of text.
  const hit = marked.findIndex((l) => l.includes("|"));
  const shown = hit < 0 ? marked.slice(0, 18) : marked.slice(Math.max(0, hit - 6), hit + 10);
  const r = f.region;
  const where = r && page ? " Marked area: " + Math.round((r.x / page.width) * 100) + "% across, " + Math.round((r.y / page.height) * 100) + "% down the page." : "";
  return [
    { t: "doc", name: words(f.fieldKey) + " — page " + f.page, kind: "What ASAP read: " + (value || "nothing"), title: "PAGE " + f.page, lines: shown.length ? shown : ["This page has no text ASAP could read."] },
    note(found ? "green" : "amber", found ? "Highlighted where it was read" : "Not found word for word on this page", (found ? "The highlighted words on page " + f.page + " are the value ASAP read." : "The value does not appear verbatim in the page text — it may be split across lines or reformatted. Open the file at page " + f.page + " to check it yourself.") + where),
    rows("Check it in the file", [
      d.fileUrl
        ? { title: "Open the file at page " + f.page, note: "The original, as stored — not ASAP's reading of it.", badge: "Open", badgeTone: ok, action: { a: "link", url: fileLink(f.page) } }
        : { title: "The file could not be opened just now", note: "Refresh records to try again.", badge: "Unavailable", badgeTone: warn },
      { title: "Back to every value", note: "Close this page view.", badge: "Back", badgeTone: ok, action: { a: "open", ref: base } },
    ]),
  ];
}

const PREMIUM_BASIS = [
  { value: "gross", label: "Gross premium (before levies)" },
  { value: "total_payable", label: "Total payable (including levies)" },
];

/** Choosing a record, seeing exactly what would change, then applying — in that order. */
function applyBlocks(d, state) {
  const doc = d.document;
  const t = state.applyTargets.get(doc.id);
  const preview = state.applyPreviews.get(doc.id);
  if (!t) return [note("amber", "Apply to a record", "ASAP could not work out which records this document may belong to just now. Refresh records to try again.")];
  const out = [];
  if (!t.suggestions.length) out.push(note("amber", "No record to apply to", t.whyNoTarget || "ASAP found no record this document is about."));
  else
    out.push(
      form(
        "applyTarget:" + doc.id,
        "Apply confirmed values to a record",
        [{ key: "target", label: "RECORD", options: t.suggestions.map((x) => ({ value: x.targetType + ":" + x.targetId, label: x.label + " — " + x.reason })) }],
        "doc.applyPreview",
        { documentId: doc.id },
        preview ? "Preview again" : "Preview the change",
        "Nothing is written until you apply. The preview shows what the record holds now beside what would replace it.",
      ),
    );
  if (preview) {
    const usable = preview.fields.filter((f) => !f.blockedBecause && !f.unchanged && f.proposedValue);
    out.push(
      rows(
        "What would change on " + preview.target.label,
        preview.fields.map((f) => ({
          title: words(f.fieldKey),
          note: (f.currentValue ?? "nothing recorded") + " → " + (f.proposedValue ?? "nothing read") + (f.blockedBecause ? " · " + f.blockedBecause : f.unchanged ? " · already recorded" : ""),
          badge: f.blockedBecause ? "Cannot apply" : f.unchanged ? "Unchanged" : "Will change",
          badgeTone: f.blockedBecause ? bad : f.unchanged ? ok : warn,
        })).concat(preview.missing.map((m) => ({ title: words(m), note: "This record takes it, but the document did not give it.", badge: "Not in document", badgeTone: warn }))),
      ),
    );
    if (usable.length) {
      const needsBasis = usable.some((f) => f.fieldKey === "premium");
      out.push(
        form(
          "apply:" + doc.id,
          "Apply " + plural(usable.length, "value", "values"),
          needsBasis ? [{ key: "premiumBasis", label: "WHAT THE PREMIUM FIGURE IS", options: PREMIUM_BASIS }] : [],
          "doc.apply",
          { documentId: doc.id },
          "Apply " + plural(usable.length, "value", "values") + " to the record",
          "Written with an audit entry against your name. If the record changed since this preview, nothing is written and you are asked to preview again.",
        ),
      );
    } else out.push(note("green", "Nothing to apply", "The record already holds these values, or none of them can go on it."));
  }
  return out;
}

/* ---------------------------------------------------------------- settings and connections */

function settingsSpace(state) {
  const org = state.me.active_organization;
  const members = state.members.length
    ? state.members.map((m) => ({ name: m.user.display_name || m.user.full_name || m.user.email, role: m.role.name + (m.is_owner && !/owner/i.test(m.role.name) ? " · owner" : ""), email: m.user.email, status: m.status, id: m.user.id }))
    : S.sel.users().map((u) => ({ name: u.name, role: S.ROLES[u.role], email: u.email || "", status: "active", id: u.id }));
  // The permissions the server resolved, grouped by what they are about, in words.
  const grouped = new Map();
  for (const p of state.me.permissions) {
    const [obj, verb] = p.split(":");
    if (!grouped.has(obj)) grouped.set(obj, []);
    grouped.get(obj).push(words(verb).toLowerCase());
  }
  return {
    kind: "Company settings",
    title: org.name,
    status: "live",
    statusLabel: plural(members.length, "member", "members"),
    blocks: [
      facts([
        ["Brokerage", org.name],
        ["Country", org.country || "not recorded"],
        ["Currency", org.currency || "not recorded"],
        ["Time zone", org.timezone || "not recorded"],
      ]),
      rows(
        "Team and roles",
        members.map((m) => ({ title: m.name, note: m.role + (m.email ? " · " + m.email : ""), badge: words(m.status), badgeTone: m.status === "active" ? ok : warn, action: { a: "open", ref: { ws: "team", userId: m.id } } })),
      ),
      rows(
        "What you may do here",
        [...grouped.entries()].sort().map(([obj, verbs]) => ({ title: words(obj), note: verbs.join(", "), badge: plural(verbs.length, "permission", "permissions"), badgeTone: ok })),
      ),
      rows(
        "Recent audit",
        S.sel.audit().slice(0, 10).map((a) => ({ title: a.text, note: date(a.at) + " · " + (a.actorName || "system"), badge: words(a.kind), badgeTone: ok })),
      ),
      note("amber", "Changing roles and inviting people", "Roles and invitations are managed by the brokerage's owner; changing them from this view is not connected yet."),
    ],
  };
}

function connectionsSpace(state) {
  const mb = state.mailboxes;
  const boxes = mb?.mailboxes ?? [];
  const providers = mb?.providers ?? [];
  const model = state.modelConfigured;
  const mailRows = providers.length
    ? providers.map((p) => {
        const box = boxes.find((b) => b.provider === p.id);
        return box
          ? { title: p.label, note: box.emailAddress + " · " + words(box.status) + (box.statusReason ? " — " + box.statusReason : "") + (box.lastSyncedAt ? " · last read " + date(box.lastSyncedAt) : ""), badge: words(box.status), badgeTone: box.status === "connected" ? ok : warn }
          : { title: p.label, note: p.available ? "Can be connected; no mailbox is connected yet." : "Not available on this deployment — " + (p.unavailableReason || "not configured").replace(/[.\s]+$/, "") + ".", badge: p.available ? "Not connected" : "Not configured", badgeTone: warn };
      })
    : [{ title: "Email", note: "No mailbox is connected.", badge: "Not connected", badgeTone: warn }];
  return {
    kind: "Connections",
    title: "Connected email and data",
    status: "live",
    statusLabel: boxes.some((b) => b.status === "connected") ? "Mailbox connected" : "No mailbox connected",
    blocks: [
      rows("Email", mailRows),
      rows("Records and questions", [
        { title: "Records import", note: "Spreadsheets, CSV files and PDFs are read privately by ASAP.", badge: "Available", badgeTone: ok, action: { a: "open", ref: { ws: "import" } } },
        S.getDb().meta?.docsDegraded
          ? { title: "Documents", note: "Some documents or client files didn’t load just now, so they may be missing from where you expect them. Nothing was lost; refresh records to try again.", badge: "Degraded", badgeTone: warn }
          : { title: "Documents", note: "Stored privately for this brokerage and read by ASAP's own extraction service.", badge: "Available", badgeTone: ok },
        { title: "Questions about your records", note: "Clients, work, policies and documents are answered in the app from the records it has read.", badge: "Available", badgeTone: ok },
        {
          title: "AI model",
          note: model === true ? "Switched on. Questions ASAP can’t answer straight from your records go to the assistant." : model === false ? "Not configured on this deployment. Questions beyond your records are answered with that message, never guessed." : "Could not be checked just now.",
          badge: model === true ? "Configured" : model === false ? "Not configured" : "Unknown",
          badgeTone: model === true ? ok : warn,
        },
      ]),
      note("green", "From your records", "Each status above comes from your brokerage’s own records."),
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
      return newClientSpace(state, ref);
    case "newcontact":
      return newContactSpace(ref);
    case "import":
      return importSpace(state);
    case "quote":
      return quoteSpace(ref, state);
    case "claim":
      return ref.claimId ? claimSpace(ref, state) : newClaimSpace(ref);
    case "workitem":
      return workItemSpace(ref);
    case "document":
      return documentSpace(ref, state);
    case "settings":
      return settingsSpace(state);
    case "connections":
      return connectionsSpace(state);
    default:
      return null;
  }
}
