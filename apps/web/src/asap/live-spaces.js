/**
 * Live workspaces the approved engine has no live source for, built from this brokerage's API data
 * in the engine's own block vocabulary (facts, rows, note, gate, upload, builder, assign) so they
 * render in the approved interface exactly as its other workspaces do.
 *
 * Every value shown comes from an API response. Nothing here is example content.
 */
import { AUTOMATION_REGISTRY, automationProblems, IMPORT_COLUMN_SYNONYMS, ImportColumn } from "@asap/schema";
import * as S from "./engine/store.js";
import { compareQuotations } from "./quote-compare.js";
import { throughSupabaseBase } from "../lib/supabase.js";

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
          // The primary contact, optional: saved with the client, or left for later — never dropped silently.
          { key: "contactName", label: "PRIMARY CONTACT (OPTIONAL)", placeholder: "Full name", value: ref.contactName || "" },
          { key: "contactRole", label: "CONTACT'S ROLE", placeholder: "For example Finance manager", value: ref.contactRole || "" },
          { key: "contactEmail", label: "CONTACT'S EMAIL", placeholder: "name@company.co.ke", value: ref.contactEmail || "" },
          { key: "contactPhone", label: "CONTACT'S PHONE", placeholder: "+254…", value: ref.contactPhone || "" },
        ],
        "client.create",
        {},
        "Add client",
        "Created in your brokerage only, with an audit entry against your name. A contact given here is saved as the primary contact; no message is sent to them.",
      ),
      ...(dup
        ? [
            note("amber", "A similar client may already exist", "“" + dup.name + "” resembles a client on file. Open it if it is the same one; create it only if it is not."),
            rows("Possible matches", dup.candidates.map((c) => ({ title: c.name, note: c.kind === "individual" ? "Person" : "Company", badge: "Open", badgeTone: warn, action: { a: "open", ref: { ws: "client", clientId: c.id } } }))),
            gate("Create “" + dup.name + "” anyway", "Only if it is a different client from the matches above." + (dup.contact?.contactName ? " " + dup.contact.contactName + " is saved as its primary contact." : ""), "client.create", { name: dup.name, kind: dup.kind, confirmNew: "yes", ...(dup.contact || {}) }),
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
  if (!p && !state.importResult && state.unfinishedImport)
    blocks.push(
      note(
        "amber",
        "“" + state.unfinishedImport.filename + "” was read but not imported",
        "Its preview was only kept on the page that read it, so it could not be restored after the page was reloaded. Nothing from that file was saved to your records. Choose the file again to see the preview and continue.",
      ),
    );
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
        ["New contacts", String(sum.contactsToCreate) + (p.rows.some((r) => r.contactStatus === "on_file") ? " (" + plural(p.rows.filter((r) => r.contactStatus === "on_file").length, "contact is", "contacts are") + " already on file)" : "")],
        ["New policies", String(sum.policiesToCreate)],
        ["Your decision needed / invalid", sum.needsReview + " / " + sum.invalid],
      ]),
    );
    if (p.blocking.length) blocks.push(note("red", "Before this can be imported", p.blocking.join(" ")));
    // A workbook: every sheet, the one read marked, any other one read on request.
    if ((p.sheets || []).length > 1)
      blocks.push(
        rows(
          "Sheets in this workbook",
          p.sheets.map((sh) => ({
            title: sh.name,
            note: plural(sh.rows, "row", "rows") + (sh.headers.length ? " · headings: " + sh.headers.slice(0, 6).join(", ") + (sh.headers.length > 6 ? "…" : "") : " · no headings found"),
            badge: sh.name === p.sheetName ? "Reading" : "Other sheet",
            badgeTone: sh.name === p.sheetName ? ok : warn,
            ...(sh.name === p.sheetName ? {} : { secondary: { a: "act", action: "import.sheet", payload: { sheet: sh.name }, label: "Read this sheet" } }),
          })),
        ),
      );
    const unmapped = p.columns.filter((c) => !c.meaning).map((c) => c.header);
    if (unmapped.length) blocks.push(note("amber", "Headings ASAP did not recognise", unmapped.join(", ") + " — ignored unless you say what they hold below. Nothing is imported until you confirm."));
    // Say what each heading holds: the preview is read again with it, still writing nothing.
    if (unmapped.length || p.blocking.some((b) => /client's name/i.test(b)))
      blocks.push(
        form(
          "importmap:" + p.batch.id,
          "What each column holds",
          p.columns.map((c, i) => ({
            key: "col" + i,
            label: c.header.toUpperCase(),
            value: c.meaning || "ignore",
            options: [{ value: "ignore", label: "Ignore this column" }, ...ImportColumn.options.map((m) => ({ value: m, label: m.replace(/_/g, " ") }))],
          })),
          "import.map",
          {},
          "Read again with these columns",
          "Reads the same file again with your choices. Nothing is written until you import.",
        ),
      );
    // Asked only when the server needs it — that is, when a premium value is actually in the file.
    if (p.blocking.some((b) => /premium/i.test(b))) {
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
/** The draft to one insurer — the same text the server composes (composeQuoteRequest). */
export function requestDraft(d, insurerName) {
  const o = d.opportunity;
  const long = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });
  const supplied = d.requirements.filter((r) => r.suppliedAt);
  const outstanding = d.requirements.filter((r) => !r.suppliedAt);
  const period = o.coverStart ? ", from " + long(o.coverStart) + (o.coverEnd ? " to " + long(o.coverEnd) : "") : "";
  return [
    "Dear " + insurerName + " underwriting team,",
    "",
    "We invite terms for " + o.classOfBusiness + " cover for our client " + d.client.name + period + ".",
    "Cover wanted: " + o.title + ".",
    ...(o.riskSummary ? ["", "The risk: " + o.riskSummary] : []),
    ...(supplied.length ? ["", "Enclosed:", ...supplied.map((r) => "- " + r.label + (r.evidence?.label ? " (" + r.evidence.label + ")" : ""))] : []),
    ...(outstanding.length ? ["", "To follow from the client (not yet supplied):", ...outstanding.map((r) => "- " + r.label)] : []),
    "",
    "Please reply with your premium, excess, key conditions and how long the terms are valid.",
  ].join("\n");
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
  // "Now" is the server's current stage (D-120), so the Space and Ask always name the same step.
  const STAGE_AT = { requirements: 1, insurers: 2, prepare: 3, approve: 4, deliver: 5, with_insurer: 7, compare: 8 };
  const at = STAGE_AT[d.next?.stage];
  const now = at !== undefined ? (at === 8 && steps[8][1] ? 9 : at) : steps.findIndex(([, done]) => !done);
  return rows(
    "Where this quotation stands",
    steps.map(([title, done, note], k) => ({ title, note: note || (done ? "Done" : k === now ? "This is the current step" : "Not yet"), badge: k === now ? "Now" : done ? "Done" : k < now ? "Not done" : "Later", badgeTone: k === now ? warn : done ? ok : k < now ? bad : "neutral" })),
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
  if (i.stage === "request_prepared") {
    // The draft is read, copied or edited before anyone approves it — approval covers exact text.
    out.push(
      rows("Draft request to " + i.insurerName + " — not approved, not sent", [
        { title: i.request.subject, note: i.request.body.replace(/\n+/g, " ").slice(0, 600) + " · To: no insurer address on file — you choose where it goes when you deliver it.", badge: "Copy", badgeTone: warn, action: { a: "copy", text: reqText } },
        { title: "Download the draft as a text file", note: "To read it or share it inside the brokerage. ASAP has not sent it.", badge: "Download", badgeTone: warn, action: { a: "download", filename: "DRAFT Quotation request - " + i.insurerName + ".txt", text: reqText } },
      ]),
    );
    if (d.permissions.canEdit)
      out.push(
        form(
          "edit:" + i.request.id,
          "Edit the draft to " + i.insurerName,
          [
            { key: "subject", label: "SUBJECT", value: i.request.subject },
            { key: "body", label: "REQUEST", value: i.request.body, multiline: true },
          ],
          "opp.action",
          act("prepare_request", { opportunityInsurerId: i.id }),
          "Save draft",
          "Saved as the draft for approval. Nothing is sent.",
        ),
      );
  }
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
            note: r.suppliedAt
              ? "Supplied and confirmed " + date(r.suppliedAt) + (r.suppliedByName ? " by " + r.suppliedByName : "") + (r.evidence?.label ? " · evidence: " + r.evidence.label : "")
              : "Not yet supplied by the client. Insurers quote on it, so it must be in hand before a request is delivered — it does not stop you adding insurers or preparing drafts. To provide it: add the client's document on the client record, then mark it supplied below with what proves it.",
            badge: tooShort(r.label) || weakSupply(r) ? "Legacy — needs correction" : r.suppliedAt ? "Supplied" : "Outstanding",
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
        : [{ title: "No insurers yet", note: "Add them by name below" + (addable.length ? ", or from the insurers already on file." : " — a name not yet on file is put on file."), badge: "Empty", badgeTone: warn }],
    ),
    ...(d.permissions.canEdit && !o.closedAt
      ? [
          form(
            "approach:" + id,
            "Add insurers to approach",
            [
              { key: "names", label: "INSURERS", placeholder: "APA Insurance, CIC, Jubilee" },
              { key: "prepare", label: "DRAFT A REQUEST TO EACH", options: [{ value: "yes", label: "Yes — prepare a draft request to each (nothing is sent)" }, { value: "no", label: "No — only add them" }] },
            ],
            "opp.approach",
            { id },
            "Add insurers",
            "Each insurer is added to this quotation; a name not yet on file is put on file. Drafts wait for your approval. Nothing is sent." + (outstanding.length ? " Outstanding client information is listed in each draft as to follow." : ""),
          ),
        ]
      : []),
    ...(addable.length && d.permissions.canEdit
      ? [rows("Insurers on file you can approach", addable.map((a) => ({ title: a.name, note: "On file in your brokerage", badge: "Available", badgeTone: ok, secondary: { a: "act", action: "opp.action", payload: act("add_insurer", { insurerId: a.id }), label: "Add" } })))]
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
        ["Policy", pol ? pol.number + " — " + (pol.cls || "class not recorded") : "Policy not known — to be matched before registering"],
        ["Owner", w?.assigneeId ? (S.byId("users", w.assigneeId)?.name ?? "A member of this brokerage") : "Nobody yet — assign it"],
        ["Next check", w?.nextCheckAt ? date(w.nextCheckAt) : "not set"],
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

/* ---------------------------------------------------------------- renewal autopilot */

/**
 * The Renewal Space (D-129): what ASAP did, with its evidence; the one approval it needs; what it
 * is waiting on; and the exception, in plain words, when it stopped. Every value comes from the
 * run the server returned — nothing is composed here.
 */
const STEP_BADGE = { done: ["Done", ok], running: ["Working", warn], waiting: ["Waiting", warn], pending: ["Later", "neutral"], failed: ["Stopped", bad], skipped: ["Skipped", "neutral"] };
export function findRenewal(state, ref) {
  const runs = [...(state.renewals?.values?.() ?? [])];
  if (ref.runId) return runs.find((r) => r.id === ref.runId) ?? null;
  if (ref.workItemId) return runs.find((r) => r.workItemId === ref.workItemId) ?? null;
  return null;
}
const TONE_NOTE = { working: "green", waiting: "amber", attention: "amber", done: "green" };
const VIEW_LABEL = { needs_me: "Needs me", asap_handling: "ASAP is handling", waiting_on_others: "Waiting on others", upcoming: "Upcoming", done: "Done" };
const UPCOMING_LABEL = { follow_up: "Follow-up", escalate: "Escalation", recheck_delivery: "Delivery check", recheck_approval: "Approval check" };

/** One row for a workflow, wherever it is listed: status, owner, current step, waiting party, next follow-up. */
export function workflowRow(r) {
  const o = r.operational;
  return {
    title: r.title,
    note: [o.currentWork.title, o.owner ? "Owner: " + o.owner.name : "Unassigned", o.waitingFor ? "With " + o.waitingFor.party + (o.waitingFor.since ? " since " + date(o.waitingFor.since) : "") : null, o.nextFollowUpAt ? "Next follow-up " + date(o.nextFollowUpAt) : null].filter(Boolean).join(" · "),
    badge: o.status,
    badgeTone: o.tone === "attention" ? (r.state === "exception" ? bad : warn) : o.tone === "done" ? "neutral" : ok,
    action: { a: "open", ref: { ws: "renewal", runId: r.id, workItemId: r.workItemId } },
  };
}

/**
 * The supervision board (D-131): every workflow in the brokerage in the views people use — Needs
 * me, ASAP is handling, Waiting on others, Upcoming, Done — ranked exception-first, with what ASAP
 * plans to do next and the rules that govern it. Read from GET /supervision; nothing composed here.
 */
function supervisionSpace(ref, state) {
  const sup = state.supervision;
  if (!sup) return { kind: "Renewals", title: "Work ASAP is doing", status: "draft", statusLabel: "Could not be read", blocks: [note("red", "The workflows could not be read just now", "That does not mean there are none. Refresh records; if it keeps happening, tell your administrator.")] };
  const view = ref.view && VIEW_LABEL[ref.view] ? ref.view : "needs_me";
  const items = sup.items.filter((i) => i.views.includes(view));
  const tabs = Object.keys(VIEW_LABEL).map((k) => ({ title: VIEW_LABEL[k] + " · " + (sup.counts[k] ?? 0), note: k === view ? "Showing" : "", badge: k === view ? "Open" : "View", badgeTone: k === view ? ok : "neutral", action: { a: "open", ref: { ws: "renewal", view: k } } }));
  const blocks = [rows("Views", tabs)];
  if (view === "upcoming") {
    blocks.push(rows("What ASAP plans to do", sup.upcoming.length ? sup.upcoming.map((u) => ({ title: u.label + " — " + date(u.at), note: u.title + (u.paused ? " · paused, so this will not happen until it is resumed" : ""), badge: UPCOMING_LABEL[u.kind] ?? "Planned", badgeTone: u.paused ? "neutral" : warn, action: { a: "open", ref: { ws: "renewal", runId: u.runId, view: "actions" } } })) : [{ title: "Nothing planned", note: "When ASAP schedules a follow-up, a check or an escalation, it appears here with its date.", badge: "None", badgeTone: "neutral" }]));
    blocks.push(note("green", "Change what ASAP plans", "Open one to run it now, reschedule it, pause it or stop it. Every change is recorded against your name."));
  } else {
    blocks.push(rows(VIEW_LABEL[view], items.length ? items.map((i) => ({ ...workflowRow(i), note: workflowRow(i).note + (i.priorityReason && view !== "done" ? " · " + i.priorityReason : "") })) : [{ title: view === "needs_me" ? "Nothing needs you right now" : "Nothing here", note: view === "needs_me" ? "ASAP will put work here the moment it needs a decision, information or an approval from you." : "Workflows appear here as their state changes.", badge: "Clear", badgeTone: ok }]));
  }
  blocks.push(rows("Rules ASAP is working to", sup.rules.map((r) => ({ title: r.summary, note: r.version ? "Version " + r.version + (r.setByName ? " · set by " + r.setByName : "") + " · " + r.source : r.source, badge: r.version ? "Your rule" : "Default", badgeTone: r.version ? ok : "neutral" }))));
  blocks.push(nav("Autonomy rules", "Decide what ASAP may do on its own, what needs approval, the follow-up cadence and escalation.", { ws: "autonomy" }));
  return { kind: "Renewals", title: "Work ASAP is doing", status: "live", statusLabel: (sup.counts.needs_me ?? 0) + " need you", blocks };
}

function renewalSpace(ref, state) {
  const run = findRenewal(state, ref);
  if (!run) return supervisionSpace(ref, state);
  const o = run.operational;
  const back = { ws: "renewal", runId: run.id, workItemId: run.workItemId };
  const title = run.title;
  const recordRef = back;

  if (ref.view === "review" && run.approval) return renewalReview(run, back);
  if (ref.view === "history") return renewalHistory(run, back);
  if (ref.view === "actions") return renewalActions(run, back);
  if (ref.view === "receipt") return renewalReceipt(run, back, state);

  const blocks = [];
  // 1 · One clear status, with where this renewal came from and how far it is.
  blocks.push(note(TONE_NOTE[o.tone] ?? "green", o.status, o.originLabel + " · " + run.progress.done + " of " + run.progress.steps + " steps complete."));
  // 2 · What ASAP is doing now — one current-work card.
  blocks.push(facts([["Current work", o.currentWork.title], ["", o.currentWork.detail], ["Done so far", o.completed]].filter(([k, v]) => k || v)));
  // 3 · At most three blockers, blocking first; each says what fixes it.
  if (o.blockers.length)
    blocks.push(rows("What is in the way", [...o.blockers.map((b) => ({ title: b.label, note: b.blocking ? "Blocking — " + (b.fix ?? "ASAP cannot go on until this is put right") : "Not blocking — ASAP carries on and says so in the pack", badge: b.blocking ? "Blocking" : "Noted", badgeTone: b.blocking ? bad : warn })), ...(o.moreBlockers ? [{ title: o.moreBlockers + " more", note: "Listed in the renewal pack.", badge: "More", badgeTone: "neutral" }] : [])]));
  // 4 · What it needs from you, and the one primary action.
  if (o.needsFromYou) blocks.push(note("amber", "What ASAP needs from you", o.needsFromYou + (o.afterYouAct ? " " + o.afterYouAct : "")));
  const pa = primaryActionBlock(run);
  if (pa) blocks.push(pa);
  // 5–6 · Who we are waiting for, and when ASAP follows up or escalates.
  const when = [
    ...(o.waitingFor ? [["Waiting for", o.waitingFor.party + (o.waitingFor.since ? " since " + date(o.waitingFor.since) : "")]] : []),
    ["Next follow-up", o.nextFollowUpAt ? date(o.nextFollowUpAt) : o.chasing === "stopped" ? "Chasing stopped" : "None yet — " + (run.state === "waiting_approval" ? "after approval and delivery" : run.state === "exception" ? "the renewal is stopped" : run.state === "done" ? "finished" : "not scheduled")],
    ...(o.escalatesAt ? [["Escalates to " + (o.escalatesTo ?? "the work owner"), date(o.escalatesAt)]] : []),
    ["Responsible", o.owner?.name ?? "Unassigned"],
    ["Cover ends", run.periodEnd ? date(run.periodEnd) : "not recorded"],
  ];
  blocks.push(facts(when));
  // 7 · Prepared outputs.
  if (o.outputs.length) blocks.push(rows("Prepared", o.outputs.map((x) => ({ title: x.label, note: x.state, badge: x.state.startsWith("Delivered") ? "Delivered" : x.state.startsWith("Approved") ? "Approved" : "Prepared", badgeTone: x.state.startsWith("Delivered") ? ok : warn }))));
  // Collapsed: history and evidence, and every other intervention.
  blocks.push(nav("What ASAP has done", "Every step, its evidence and the rule it followed.", { ...back, view: "history" }));
  blocks.push(nav("More actions", "Assign, change dates, follow up now, pause, escalate, stop — and why any is unavailable.", { ...back, view: "actions" }));
  if (run.state === "done") blocks.push(nav("Completion receipt", "What was meant, what was achieved, approvals, people, evidence and delivery.", { ...back, view: "receipt" }));
  return { kind: "Renewal", title, status: run.state === "exception" ? "draft" : "live", statusLabel: o.status, recordRef, blocks };
}

/** The one primary action for the state the run is in — a real backend action, never a simulation. */
function primaryActionBlock(run) {
  const o = run.operational;
  const back = { ws: "renewal", runId: run.id, workItemId: run.workItemId };
  const ap = run.approval;
  if (o.primaryAction.kind === "approve" && ap?.state === "pending")
    return run.permissions.canApprove
      ? gate("Approve bundle", "You approve this exact pack and these exact messages. Nothing will be sent automatically. To read them first or say what is wrong, open the review.", "renewal.decide", { approvalId: ap.id, bundleSha256: ap.bundleSha256, decision: "approve" })
      : note("amber", "Approval needed from someone who may approve", "Your role cannot approve what leaves the brokerage.");
  if (o.primaryAction.kind === "resume" && run.permissions.canAct) return gate(o.primaryAction.label, "ASAP resumes this same renewal from the step that stopped — nothing is done twice.", "renewal.resume", { runId: run.id }, { heading: "Next step" });
  if (o.primaryAction.kind === "record_delivery") {
    const opp = run.steps.find((st) => st.key === "open_terms")?.output?.opportunityId;
    return opp ? nav("Record delivery", "Send the approved request yourself, then record how it reached the insurer — in the renewal quotation.", { ws: "quote", opportunityId: opp }) : null;
  }
  if (o.primaryAction.kind === "present") {
    const opp = run.steps.find((st) => st.key === "open_terms")?.output?.opportunityId;
    return opp ? nav("Open the comparison", "Present the terms against the expiring premium and record the client's instruction.", { ws: "quote", opportunityId: opp }) : null;
  }
  if (run.approval?.state === "pending") return nav("Review in Space", "The pack and both messages, as you will approve them.", { ...back, view: "review" });
  return null;
}

/** The bundle as it will be approved: pack, both messages, and approve or reject with a reason. */
function renewalReview(run, back) {
  const ap = run.approval;
  const pack = ap.bundle.find((b) => b.kind === "pack")?.pack ?? {};
  const blocks = [
    note("amber", ap.state === "pending" ? "One approval: the pack and both messages" : "Approved by " + (ap.decidedByName || "a person"), "Approving records them as approved — it sends nothing. ASAP has no mailbox connected."),
    facts([
      ["Client", pack.client ?? "not recorded"],
      ["Policy", pack.policyNumber ?? "number not recorded"],
      ["Insurer", pack.insurer ?? "not recorded"],
      ["Cover ends", pack.expiringPeriod?.end ? date(pack.expiringPeriod.end) : "not recorded"],
      ["Expiring premium", pack.expiringPremium ? money(pack.expiringPremium.amount, pack.expiringPremium.currency) + (pack.expiringPremium.basis ? " (" + pack.expiringPremium.basis + ")" : "") : "not recorded"],
    ]),
    ...(pack.missing?.length ? [rows("Still missing", pack.missing.map((m) => ({ title: m, note: "Not on file — listed in the pack", badge: "Missing", badgeTone: bad })))] : []),
    ...(pack.scheduleFindings?.length ? [rows("Schedule differs from the record", pack.scheduleFindings.map((f) => ({ title: f, note: "Check before approving", badge: "Check", badgeTone: bad })))] : []),
    ...ap.bundle.filter((b) => b.kind === "communication").map((b) => rows(b.label, [{ title: b.subject, note: (b.to ? "To " + b.to : "No verified address on file — you deliver it") + " · " + b.body.replace(/\n+/g, " ").slice(0, 600), badge: "Prepared", badgeTone: warn, action: { a: "copy", text: b.subject + "\n\n" + b.body } }])),
  ];
  if (ap.state === "pending" && run.permissions.canApprove)
    blocks.push(
      gate("Approve bundle", "You approve this exact pack and these exact messages. Nothing will be sent automatically.", "renewal.decide", { approvalId: ap.id, bundleSha256: ap.bundleSha256, decision: "approve" }),
      form("reject:" + ap.id, "Reject — say what is wrong", [{ key: "note", label: "WHAT IS WRONG", placeholder: "The premium on the record is last year's" }], "renewal.decide", { approvalId: ap.id, bundleSha256: ap.bundleSha256, decision: "reject" }, "Reject", "The renewal stops with your reason until it is put right on the records."),
    );
  blocks.push(nav("Back to the renewal", "Status, follow-up and what happens next.", back));
  return { kind: "Renewal", title: run.title + " — review", status: "live", statusLabel: run.operational.status, recordRef: back, blocks };
}

/** Collapsed by default: every step, its evidence and its output, in order. */
function renewalHistory(run, back) {
  const blocks = [
    note("green", "What ASAP has done", run.operational.completed),
    rows("Steps", run.steps.map((st) => {
      const [badge, tone] = STEP_BADGE[st.state] ?? [st.state, "neutral"];
      const ev = (st.evidence || []).map((e) => e.label).slice(0, 3).join(" · ");
      return { title: st.label, note: ev || (st.state === "waiting" && st.nextAttemptAt ? "Looked at again " + date(st.nextAttemptAt) : st.error || (st.state === "done" ? "Done" : "Not yet")), badge, badgeTone: tone };
    })),
  ];
  const windowBasis = run.steps.find((st) => st.key === "detect")?.output?.windowBasis;
  if (windowBasis) blocks.push(note("green", "The rule it followed", windowBasis));
  const cmp = run.steps.find((st) => st.key === "compare" && st.state === "done")?.output;
  if (cmp) blocks.push(rows("Terms against the expiring premium", cmp.terms.map((t) => ({ title: money(t.premium, t.currency), note: (t.changePercent !== null ? (t.changePercent > 0 ? "+" : "") + t.changePercent + "% on the expiring premium" : "Expiring premium not recorded") + (t.validUntil ? " · valid to " + date(t.validUntil) : ""), badge: "Terms", badgeTone: ok }))), note("amber", "Recommendation", cmp.recommendation));
  for (const m of run.communications.filter((x) => x.state !== "prepared")) {
    const text = m.subject + "\n\n" + m.bodyText;
    blocks.push(rows((m.audience === "client" ? "Letter to " : "Request to ") + m.partyName, [
      { title: m.subject, note: m.state === "delivered" ? "Delivered " + date(m.deliveredAt) + " · " + m.deliveryReference : "Approved, not sent", badge: m.state === "delivered" ? "Delivered" : "Approved", badgeTone: m.state === "delivered" ? ok : warn, action: { a: "copy", text } },
      { title: "Download as a text file", note: "For printing or attaching.", badge: "Download", badgeTone: ok, action: { a: "download", filename: m.subject + ".txt", text } },
    ]));
    if (m.state === "approved" && m.audience === "client" && run.permissions.canAct)
      blocks.push(form("deliver:" + m.id, "Record how the letter reached " + m.partyName, [{ key: "method", label: "HOW IT WENT", options: [{ value: "own_email", label: "From my own email" }, { value: "printed", label: "Printed and handed over" }, { value: "phone", label: "Read out on the phone" }, { value: "other", label: "Another way" }] }, { key: "reference", label: "WHAT PROVES IT", placeholder: "Emailed from Outlook 30 Sep, 10:02" }], "renewal.deliver", { communicationId: m.id }, "Record delivery", "Recorded as delivered by you — never as sent."));
  }
  if (run.workItemId) blocks.push(nav("Open the Work item", "Owner, due date and its activity.", { ws: "workitem", workItemId: run.workItemId }));
  blocks.push(nav("Back to the renewal", "Status, follow-up and what happens next.", back));
  return { kind: "Renewal", title: run.title + " — history", status: "live", statusLabel: run.operational.status, recordRef: back, blocks };
}

/** Every intervention, each a real action; one that is not available says why. */
function renewalActions(run, back) {
  const o = run.operational;
  const iv = Object.fromEntries(o.interventions.map((i) => [i.key, i]));
  const off = (k) => ({ title: iv[k].label, note: iv[k].why ?? "", badge: "Not available", badgeTone: "neutral" });
  const blocks = [note("green", "Intervene", "Every change here is recorded against your name, and Work, Today and this Space show it at once.")];
  if (o.upcoming.length) blocks.push(rows("What ASAP plans to do", o.upcoming.map((u) => ({ title: u.label, note: date(u.at), badge: UPCOMING_LABEL[u.kind] ?? "Planned", badgeTone: warn }))));
  const avail = [];
  if (iv.follow_up_now?.available) avail.push(gate("Follow up now", "The follow-up becomes due today; Work asks the owner to chase.", "renewal.followUpNow", { runId: run.id }, { heading: "Intervene" }));
  if (iv.follow_up_date?.available) avail.push(form("followup:" + run.id, "Change the follow-up date", [{ key: "on", label: "FOLLOW UP ON", type: "date", placeholder: "" }], "renewal.moveFollowUp", { runId: run.id }, "Reschedule", "Used once; the schedule resumes after it. Escalation is unchanged."));
  if (o.chasing === "active" && iv.pause?.available) avail.push(gate("Stop chasing this insurer", "No automatic follow-ups. ASAP still escalates on schedule.", "renewal.chasing", { runId: run.id, stop: true }, { heading: "Intervene" }));
  if (o.chasing === "stopped") avail.push(gate("Start chasing again", "Follow-ups resume on the brokerage's schedule.", "renewal.chasing", { runId: run.id, stop: false }, { heading: "Intervene" }));
  if (iv.pause?.available) avail.push(gate("Pause", "ASAP takes no further step until someone resumes it.", "renewal.pause", { runId: run.id }, { heading: "Intervene" }));
  if (iv.resume?.available) avail.push(gate("Resume", "Continue this same renewal from where it stopped.", "renewal.resume", { runId: run.id }, { heading: "Intervene" }));
  if (iv.escalate?.available) avail.push(form("escalate:" + run.id, "Escalate", [{ key: "reason", label: "WHY", placeholder: "Client asked for terms this week" }], "renewal.escalate", { runId: run.id }, "Escalate", "Work and Today ask the owner to act."));
  if (iv.stop?.available) avail.push(form("stop:" + run.id, "Stop automation", [{ key: "reason", label: "WHY", placeholder: "Client moving to another broker" }], "renewal.stop", { runId: run.id }, "Stop ASAP", "The renewal's Work stays open for a person to carry."));
  if (run.workItemId && iv.assign?.available) avail.push(nav("Assign or change the due date", "On the renewal's Work item.", { ws: "workitem", workItemId: run.workItemId }));
  blocks.push(...avail);
  const unavailable = o.interventions.filter((i) => !i.available && i.why);
  if (unavailable.length) blocks.push(rows("Not available now", unavailable.map((i) => off(i.key))));
  blocks.push(nav("Back to the renewal", "Status, follow-up and what happens next.", back));
  return { kind: "Renewal", title: run.title + " — actions", status: "live", statusLabel: o.status, recordRef: back, blocks };
}

/** The completion receipt, read from the server's stored copy. */
function renewalReceipt(run, back, state) {
  const rc = state.receipts?.get?.(run.id);
  if (!rc) return { kind: "Renewal", title: run.title + " — receipt", status: "live", statusLabel: run.operational.status, recordRef: back, blocks: [note("amber", "Loading the receipt", "Ask again in a moment, or refresh records."), nav("Back to the renewal", "", back)] };
  const r = rc.receipt;
  return {
    kind: "Renewal",
    title: run.title + " — receipt",
    status: "live",
    statusLabel: "Completed",
    recordRef: back,
    blocks: [
      note("green", rc.outcome, "Intended: " + r.intendedOutcome + ". " + r.nothingSent),
      facts((r.dates ?? []).map((d) => [d.label, date(d.at)])),
      rows("Approvals and people", [...(r.approvals ?? []).map((a) => ({ title: a.what, note: "Approved by " + (a.by ?? "a member") + (a.at ? " · " + date(a.at) : ""), badge: "Approved", badgeTone: ok })), ...(r.people ?? []).map((p) => ({ title: p.name, note: p.role, badge: "Person", badgeTone: "neutral" }))]),
      ...(r.delivery?.length ? [rows("Delivery evidence", r.delivery.map((d) => ({ title: "To " + d.to + " by " + d.method, note: d.reference + " · " + date(d.at), badge: "Delivered", badgeTone: ok })))] : []),
      ...(r.unresolved?.length ? [rows("Left unresolved", r.unresolved.map((u) => ({ title: u, note: "Not on file when the renewal finished", badge: "Open", badgeTone: warn })))] : []),
      rows("Evidence", (r.evidence ?? []).slice(0, 8).map((e) => ({ title: e, note: "", badge: "Evidence", badgeTone: "neutral" }))),
      nav("Back to the renewal", "", back),
    ],
  };
}

/* ---------------------------------------------------------------- setup (D-132) */

const READ_STATE = { uploading: "Uploading", not_started: "Waiting to be read", queued: "Waiting to be read", working: "Reading", extracted: "Read", failed: "Could not read", not_applicable: "Filed" };

/**
 * Setup: the same Space a brokerage keeps using, showing how far its book has come in — files
 * received, records found, what needs confirmation, what was created, and the one next step. Every
 * count is read from the records; a file is "Read" only when the server says extraction finished.
 */
function setupSpace(ref, state, db) {
  // Read from the server's records (state.uploads): survives a refresh and a new sign-in.
  const files = state.uploads ? state.uploads() : [...(state.ingested?.values?.() ?? [])];
  const clients = db?.clients?.length ?? 0;
  const policies = db?.policies?.length ?? 0;
  const onFile = files.filter((f) => f.id);
  const reading = files.filter((f) => f.id && !["extracted", "failed", "not_applicable"].includes(f.extractionState));
  const confirm = files.filter((f) => f.proposed > 0);
  const failed = files.filter((f) => f.extractionState === "failed");
  const imp = state.importPreview;
  /*
   * Progress from what is actually true (D-132): a file received is not a record; nothing is
   * "confirmed" while a file is still being read or failed, or while values wait for review.
   */
  const steps = [
    ["Brokerage created", true],
    ["Documents or records added", onFile.length > 0 || clients > 0],
    ["Everything read and reviewed", (onFile.length > 0 || clients > 0) && !reading.length && !confirm.length && !failed.length && !imp],
    ["Client and policy records created", clients > 0 && policies > 0],
  ];
  const doneN = steps.filter(([, d]) => d).length;
  const blocks = [
    note(doneN === steps.length ? "green" : "amber", doneN === steps.length ? "Your book is in" : "Setup · " + doneN + " of " + steps.length + " done", steps.map(([l, d]) => (d ? "✓ " : "○ ") + l).join("   ") + ". You can stop at any point and come back — the + beside the box is always there."),
  ];
  // The one primary next action.
  if (imp) blocks.push(nav("Confirm the records from " + (state.importFile?.name ?? "your spreadsheet"), "Review what ASAP found and create the records.", { ws: "import" }));
  else if (confirm.length) blocks.push(nav("Confirm what ASAP read", confirm[0].name + " — check each value against its page.", { ws: "document", documentId: confirm[0].id }));
  else if (reading.length) blocks.push(note("amber", "ASAP is reading " + plural(reading.length, "file", "files"), "Each moves on as soon as it is read; values it finds wait here for your review."));
  else if (!clients && !onFile.length) blocks.push(note("green", "Start with what you have", "Drop policy schedules, a client list or photos of documents on the conversation, or use the + beside the box. Gmail is optional and not needed yet."));
  else if (!clients) blocks.push(note("amber", "No client records yet", "Documents are filed, but no client or policy has been created from them. Open a document's review to create them, or import a client list."));
  else blocks.push(nav("Open Today", "What needs attention now, from your records.", { ws: "today" }));
  if (files.length)
    blocks.push(rows("Files received", files.map((f) => ({ title: f.name, note: (f.already ? "Already on file — not stored twice" : READ_STATE[f.extractionState] ?? "Uploading") + (f.proposed ? " · " + plural(f.proposed, "value needs", "values need") + " confirmation" : f.extractionState === "extracted" && f.accepted ? " · reviewed" : "") + (f.error ? " · " + f.error : ""), badge: f.extractionState === "failed" ? "Could not read" : f.proposed ? "Needs confirmation" : reading.includes(f) ? "Reading" : f.extractionState === "extracted" ? "Read" : "Filed", badgeTone: f.extractionState === "failed" ? bad : f.proposed || reading.includes(f) ? warn : ok, action: f.id ? { a: "open", ref: { ws: "document", documentId: f.id } } : undefined }))));
  blocks.push(facts([["Clients", String(clients)], ["Policies", String(policies)], ["Documents", String(onFile.length)], ["Being read", String(reading.length)], ["Needs confirmation", String(confirm.length + (imp ? 1 : 0))], ["Could not read", String(failed.length)]]));
  if (failed.length) blocks.push(rows("Could not read", failed.map((f) => ({ title: f.name, note: f.error ?? "The file could not be read. Check it opens on your device, then add it again.", badge: "Failed", badgeTone: bad }))));
  return { kind: "Setup", title: "Setting up your book", status: "live", statusLabel: doneN + " of " + steps.length, blocks };
}

/* ---------------------------------------------------------------- autonomy rules */

const LADDER = [
  ["observe", "1 · Observe"], ["prepare", "2 · Prepare"], ["recommend", "3 · Recommend"],
  ["act_after_approval", "4 · Act after approval"], ["act_within_rules", "5 · Act automatically within rules"], ["manage_exceptions", "6 · Manage exceptions"],
];
const AUTONOMY_ROWS = [
  ["detect_renewals", "Start renewal work when a period enters the renewal window", "manage_exceptions"],
  ["prepare_renewal", "Check the file and prepare the pack and messages", "manage_exceptions"],
  ["external_messages", "Messages to clients and insurers", "act_after_approval"],
  ["follow_up", "Follow up with insurers on the schedule", "manage_exceptions"],
  ["escalate", "Escalate to the work owner", "manage_exceptions"],
  ["recommend_quote", "Name a recommended quote", "recommend"],
];
const AUTONOMY_FALLBACK = { actions: { detect_renewals: "act_within_rules", prepare_renewal: "act_within_rules", external_messages: "act_after_approval", follow_up: "act_within_rules", escalate: "act_within_rules", recommend_quote: "prepare" }, approver: "any_approver", assignment: "client_file_owner", alsoNever: [] };

/**
 * Autonomy rules (D-131): how far ASAP may go on its own, per action, on the six-step ladder; who
 * approves; who gets new work; the follow-up cadence and escalation. Versioned and audited by the
 * server. ASAP never infers a rule from what people do.
 */
function autonomySpace(ref, state) {
  const rules = state.rules;
  if (!rules) return { kind: "Rules", title: "Autonomy rules", status: "draft", statusLabel: "Could not be read", blocks: [note("red", "The rules could not be read just now", "Nothing was changed. Refresh records and try again.")] };
  const auto = rules.rules.find((r) => r.key === "workflow.autonomy");
  const win = rules.rules.find((r) => r.key === "renewal.window");
  const a = auto?.value ?? AUTONOMY_FALLBACK;
  const w = win?.value ?? { leadDays: 60, followUpDays: 5, escalateDaysBeforeExpiry: 14 };
  const canEdit = rules.permissions.canEdit;
  const levelOptions = (cap) => LADDER.slice(0, LADDER.findIndex(([k]) => k === cap) + 1).map(([value, label]) => ({ value, label }));
  const blocks = [
    note("green", auto ? "This brokerage's autonomy rule · version " + (auto.version ?? 1) : "ASAP's default autonomy", auto ? "Set by " + (auto.setByName ?? "a member") + " · " + auto.source + " · checked " + date(auto.verifiedAt) : "Until you set your own, ASAP starts and prepares renewals and follows up on its own; every external message waits for approval; it never names a recommended quote."),
    rows("What ASAP may do on its own", AUTONOMY_ROWS.map(([k, label]) => ({ title: label, note: (LADDER.find(([v]) => v === a.actions[k]) ?? [null, a.actions[k]])[1], badge: k === "external_messages" ? "Approval always" : "Ladder", badgeTone: ok }))),
    rows("Never automatic", ["Bind or cancel cover", "Record a client's instruction", "Move money or record a payment", "Send an external message without a person's approval", "Make a claims or coverage decision", ...(a.alsoNever ?? [])].map((t) => ({ title: t, note: "A person does this, whatever is set here.", badge: "Never", badgeTone: bad }))),
    facts([
      ["Renewal work starts", w.leadDays + " days before expiry"],
      ["Follow-up cadence", "every " + w.followUpDays + " days after delivery"],
      ["Escalation", w.escalateDaysBeforeExpiry + " days before expiry"],
      ["Who approves", a.approver === "admin_or_owner" ? "An administrator or the owner" : "Anyone whose role may approve"],
      ["New work goes to", a.assignment === "client_file_owner" ? "The client file's owner" : "Nobody — left unassigned for a person to pick up"],
      ["Window rule", win ? "Version " + (win.version ?? 1) + " · " + win.source : "ASAP's default"],
    ]),
  ];
  if (canEdit) {
    blocks.push(form("autonomy", "Change what ASAP may do", [
      ...AUTONOMY_ROWS.map(([k, label, cap]) => ({ key: "lvl_" + k, label: label.toUpperCase(), options: levelOptions(cap), value: a.actions[k] })),
      { key: "approver", label: "WHO APPROVES", options: [{ value: "any_approver", label: "Anyone whose role may approve" }, { value: "admin_or_owner", label: "An administrator or the owner" }], value: a.approver },
      { key: "assignment", label: "NEW WORK GOES TO", options: [{ value: "client_file_owner", label: "The client file's owner" }, { value: "leave_unassigned", label: "Nobody — leave it unassigned" }], value: a.assignment },
      { key: "source", label: "WHERE THIS COMES FROM", placeholder: "Partners' meeting, 1 October" },
    ], "rules.autonomy", {}, "Save as a new version", "Saved with its source and your name; the previous version is kept."));
    blocks.push(form("window", "Change the renewal cadence", [
      { key: "leadDays", label: "START RENEWAL WORK (DAYS BEFORE EXPIRY)", value: String(w.leadDays), placeholder: "60" },
      { key: "followUpDays", label: "FOLLOW UP EVERY (DAYS)", value: String(w.followUpDays), placeholder: "5" },
      { key: "escalateDaysBeforeExpiry", label: "ESCALATE (DAYS BEFORE EXPIRY)", value: String(w.escalateDaysBeforeExpiry), placeholder: "14" },
      { key: "source", label: "WHERE THIS COMES FROM", placeholder: "Partners' meeting, 1 October" },
    ], "rules.window", {}, "Save as a new version", "Applies to the next step of every renewal; nothing already done changes."));
  } else blocks.push(note("amber", "Only an administrator can change these", "Ask your brokerage administrator. You can see every rule and its version here."));
  blocks.push(nav("Work ASAP is doing", "Needs me, ASAP is handling, waiting on others, upcoming and done.", { ws: "renewal" }));
  return { kind: "Rules", title: "Autonomy rules", status: "live", statusLabel: auto ? "Version " + (auto.version ?? 1) : "Default", blocks };
}

/* ---------------------------------------------------------------- automations */

/**
 * Automations from the server's registry (D-125). Every part shown as a rule is one ASAP can
 * execute; anything else is labelled a note that does not run. Test mode, the last test, the last
 * real run, pause/resume and failures all come from the server.
 */
const OUTCOME_WORDS = { working: "Working", prepared: "Prepared for review", conditions_not_met: "Conditions not met — nothing done", needs_approval: "Waiting for a person's approval", exception: "Stopped on an exception", could_not_finish: "Could not finish" };
function automationSpace(ref) {
  const reg = AUTOMATION_REGISTRY;
  const trigLabel = (e) => reg.triggers.find((t) => t.event === e)?.label ?? e;
  const factLabel = (f) => reg.facts.find((x) => x.fact === f)?.label ?? f;
  const actLabel = (v) => reg.actions.find((x) => x.verb === v)?.label ?? v;
  const a = ref.automationId ? S.byId("automations", ref.automationId) : null;
  if (a && a.raw) {
    const r = a.raw;
    const problems = automationProblems({ triggerEvent: r.trigger_event, conditions: r.conditions, preparedVerb: r.prepared_verb, approval: r.approval });
    const real = a.history || [];
    const lastReal = real[0] || null;
    const failures = real.filter((x) => x.outcome === "could_not_finish" || x.outcome === "exception");
    return {
      kind: "Automation",
      title: r.name,
      status: r.enabled ? "live" : "draft",
      statusLabel: problems.length ? "Cannot run" : r.enabled ? "On" : "Paused",
      recordRef: { ws: "automation", automationId: r.id },
      blocks: [
        ...(problems.length ? [note("red", "This automation cannot run", "It was saved before ASAP checked it: " + problems.join("; ") + ". It stays off. Save a new one from the parts below.")] : []),
        facts([
          ["When", trigLabel(r.trigger_event)],
          ["Only if", r.conditions.length ? r.conditions.map((c) => factLabel(c.fact) + " " + c.operator.replace(/_/g, " ") + (c.value == null ? "" : " " + (Array.isArray(c.value) ? c.value.join(", ") : c.value))).join("; ") : "No conditions — every time it fires"],
          ["Then", actLabel(r.prepared_verb)],
          ["Approval", r.approval === "always" ? "A person approves each result before it is used" : "Prepared without an approval step — it never sends, and never changes cover or money"],
          ["Explanation", reg.actions.find((x) => x.verb === r.prepared_verb)?.why ?? "—"],
          ["Last test", a.lastTest ? S.fmtDate(a.lastTest.testedAt) + " — would act on " + plural(a.lastTest.wouldFire, "item", "items") + " of " + a.lastTest.checked + (a.lastTest.problems.length ? "; cannot run: " + a.lastTest.problems.join("; ") : "") : "Never tested"],
          ["Last real run", lastReal ? S.fmtDate(lastReal.started_at) + " — " + (OUTCOME_WORDS[lastReal.outcome] || lastReal.outcome) : "It has not run yet"],
        ]),
        ...(failures.length ? [rows("Failures", failures.slice(0, 5).map((x) => ({ title: OUTCOME_WORDS[x.outcome], note: S.fmtDate(x.started_at) + (x.reason ? " · " + x.reason : ""), badge: "Failed", badgeTone: bad, action: x.work_item_id ? { a: "open", ref: { ws: "workitem", workItemId: x.work_item_id } } : null })))] : []),
        rows("Every firing, including the ones that did nothing", real.length ? real.slice(0, 12).map((x) => ({ title: OUTCOME_WORDS[x.outcome] || x.outcome, note: S.fmtDate(x.started_at) + " · " + x.event_name + (x.reason ? " · " + x.reason : "") + (x.condition_results?.some((c) => !c.held) ? " · failed: " + x.condition_results.filter((c) => !c.held).map((c) => factLabel(c.fact)).join(", ") : ""), badge: x.outcome === "could_not_finish" || x.outcome === "exception" ? "Failed" : "Recorded", badgeTone: x.outcome === "could_not_finish" || x.outcome === "exception" ? bad : ok, action: x.work_item_id ? { a: "open", ref: { ws: "workitem", workItemId: x.work_item_id } } : null })) : [{ title: "No firings yet", note: "Firings appear here, with why each did or did not act.", badge: "None", badgeTone: warn }]),
        gate("Run in test mode", "Checks its conditions against open work and says what it would act on. Nothing is prepared or changed.", "automation.test", { id: r.id }),
        ...(problems.length ? [] : [gate(r.enabled ? "Pause this automation" : "Switch this automation on", r.enabled ? "Stops it firing. Work it already prepared stays." : "It starts watching for “" + trigLabel(r.trigger_event).toLowerCase() + "”. Every result still needs a person where the action says so.", "automation.toggle", { id: r.id })]),
      ],
    };
  }
  const list = S.all("automations");
  const executable = reg.triggers.filter((t) => t.executable);
  return {
    kind: "Automations",
    title: "Automations",
    status: "live",
    statusLabel: plural(list.filter((x) => x.on).length, "on", "on"),
    blocks: [
      note("green", "People stay in charge", "An automation prepares; it never sends a message, changes cover or moves money. Those always need a person's approval."),
      rows("Standing instructions", list.length ? list.map((x) => {
        const bad2 = x.raw ? automationProblems({ triggerEvent: x.raw.trigger_event, conditions: x.raw.conditions, preparedVerb: x.raw.prepared_verb, approval: x.raw.approval }).length > 0 : true;
        return { title: x.name, note: (x.raw ? trigLabel(x.raw.trigger_event) + " → " + actLabel(x.raw.prepared_verb) : x.trigger) + (bad2 ? " · cannot run as saved" : ""), badge: bad2 ? "Cannot run" : x.on ? "On" : "Paused", badgeTone: bad2 ? "missing" : x.on ? ok : warn, action: { a: "open", ref: { ws: "automation", automationId: x.id } } };
      }) : [{ title: "No automations yet", note: "Build one from the parts below.", badge: "None", badgeTone: warn }]),
      rows("What can start an automation today", reg.triggers.map((t) => ({ title: t.label, note: t.executable ? t.why : "Not available yet — " + t.why.toLowerCase(), badge: t.executable ? "Available" : "Not yet", badgeTone: t.executable ? ok : warn }))),
      form(
        "automation:new",
        "Build an automation",
        [
          { key: "name", label: "NAME", placeholder: "Prepare new claim documents for review" },
          { key: "trigger", label: "WHEN", options: executable.map((t) => ({ value: t.event, label: t.label })) },
          { key: "fact", label: "ONLY IF (OPTIONAL)", options: [{ value: "", label: "No condition" }, ...reg.facts.map((f) => ({ value: f.fact, label: f.label }))] },
          { key: "operator", label: "CHECK", options: [...new Set(reg.facts.flatMap((f) => f.operators))].map((o) => ({ value: o, label: o.replace(/_/g, " ") })) },
          { key: "value", label: "VALUE (DAYS FOR DATE CHECKS; COMMAS FOR A LIST)", placeholder: "claim" },
          { key: "verb", label: "THEN", options: reg.actions.map((x) => ({ value: x.verb, label: x.label + (x.approvalRequired ? " — always needs approval" : "") })) },
        ],
        "automation.create",
        {},
        "Save switched off",
        "Each part is checked against what ASAP can execute before it is saved. It starts off; test it first.",
      ),
    ],
  };
}

/* ---------------------------------------------------------------- activity */

/**
 * Activity, as a manager reads it (D-124): what changed, who changed it, which client, whether
 * anything left the brokerage, whether cover or money moved, what is blocked, who owns the next
 * action and what is overdue — each row opening its record. Everything comes from existing audit
 * rows and Work as the server returned them; the actor is the person the row names, never a
 * "system" guessed in the browser.
 */
const ACTION_WORDS = {
  "client.created": "Client added", "client.create": "Client add attempted", "opportunity.insurer_added": "Insurer added to a quotation",
  "opportunity.requirement_added": "Requirement added", "opportunity.requirement_supplied": "Requirement supplied",
  "work_item.assigned": "Work assigned", "work_item.due_changed": "Due date changed", "work_item.managed": "Work owner or dates changed",
  "work_item.state_derived": "Work's next step updated", "work_item.draft": "Message preparation attempted",
  "workflow.renewal.started": "ASAP found a renewal and started it", "workflow.renewal.completeness": "ASAP checked the client, policy and documents",
  "workflow.renewal.read_schedule": "ASAP read the schedule's confirmed values", "workflow.renewal.assign_work": "ASAP created and assigned the renewal Work",
  "workflow.renewal.pack": "ASAP prepared the renewal pack", "workflow.renewal.communications": "ASAP prepared the client and insurer messages (not sent)",
  "workflow.renewal.approval_requested": "ASAP asked for one approval", "workflow.bundle_approved": "Renewal bundle approved", "workflow.bundle_rejected": "Renewal bundle rejected",
  "workflow.renewal.open_terms": "ASAP recorded the insurer request as approved (not sent)", "workflow.renewal.follow_up": "ASAP chased the insurer for renewal terms",
  "workflow.renewal.compare": "ASAP compared the terms with the expiring premium", "workflow.renewal.hand_over": "ASAP handed the renewal to a person to present",
  "workflow.renewal.exception": "Renewal stopped — needs a person", "workflow.communication_delivered": "Message delivered by a person", "workflow.resumed": "Renewal resumed",
};
const actionWords = (a) => ACTION_WORDS[a] || a.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
function refForRecord(rec, client) {
  if (!rec) return client ? { ws: "client", clientId: client.id } : null;
  if (rec.type === "work_item") return { ws: "workitem", workItemId: rec.id };
  if (rec.type === "opportunity") return { ws: "quote", opportunityId: rec.id };
  if (rec.type === "claim") return { ws: "claim", clientId: client?.id, claimId: rec.id };
  if (rec.type === "document") return { ws: "document", documentId: rec.id };
  if (rec.type === "client") return { ws: "client", clientId: rec.id };
  if (rec.type === "workflow_run") return { ws: "renewal", runId: rec.id };
  return client ? { ws: "client", clientId: client.id } : null;
}
function activitySpace(ref) {
  const events = S.sel.audit().filter((a) => !ref.clientId || a.client?.id === ref.clientId);
  const now = Date.now();
  const open = S.all("workItems").filter((w) => w.taskStatus !== "done" && (!ref.clientId || w.clientId === ref.clientId));
  const overdue = open.filter((w) => (w.dueAt && new Date(w.dueAt).getTime() < now) || (w.nextCheckAt && new Date(w.nextCheckAt).getTime() < now));
  const external = events.filter((a) => a.external);
  const coverMoney = events.filter((a) => a.coverOrMoney && a.result === "success");
  const blocked = events.filter((a) => a.result !== "success");
  const owners = new Map();
  for (const w of open) {
    const name = w.assigneeId ? S.byId("users", w.assigneeId)?.name || "A member no longer here" : "Nobody";
    owners.set(name, (owners.get(name) || 0) + 1);
  }
  const who = (a) => a.actorName || (a.actorType === "user" ? "A person no longer in this brokerage" : a.actorLabel || "The platform");
  return {
    kind: "Activity",
    title: ref.clientId ? (S.sel.client(ref.clientId)?.name || "Client") + " — activity" : "Activity",
    status: "live",
    statusLabel: plural(events.length, "change", "changes"),
    blocks: [
      facts([
        ["What changed", events.length ? plural(events.length, "recorded change", "recorded changes") + " — newest first below" : "Nothing recorded yet"],
        ["Sent outside the brokerage", external.length ? plural(external.length, "message or request", "messages or requests") + " — see the rows marked External" : "Nothing — no message left ASAP"],
        ["Cover or money", coverMoney.length ? plural(coverMoney.length, "change", "changes") + " to cover or money records" : "No change to cover or money"],
        ["Blocked or refused", blocked.length ? plural(blocked.length, "attempt", "attempts") + " refused or failed" : "None"],
        ["Next actions held by", owners.size ? [...owners.entries()].map(([n, k]) => n + " (" + k + ")").join(", ") : "No open work"],
        ["Overdue", overdue.length ? overdue.map((w) => w.title).slice(0, 4).join("; ") + (overdue.length > 4 ? " and " + (overdue.length - 4) + " more" : "") : "Nothing overdue"],
      ]),
      rows(
        "Changes, newest first",
        events.length
          ? events.slice(0, 60).map((a) => ({
              title: actionWords(a.action) + (a.record ? " — " + a.record.label : ""),
              note: [who(a), a.client ? a.client.name : null, a.result === "success" ? "Done" : a.result === "denied" ? "Refused" + (a.failureReason ? ": " + a.failureReason.replace(/_/g, " ") : "") : "Failed" + (a.failureReason ? ": " + a.failureReason : ""), S.fmtDate(a.at) + " " + new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), (a.changed || []).filter((c) => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(c) && !/nothing → nothing/.test(c)).slice(0, 2).map((c) => c.replace(/^due_on:/, "Due:").replace(/^task_next_check:/, "Next check:").replace(/^required_action:/, "Next step:")).join("; ") || null, a.evidence?.length ? "Evidence: " + a.evidence[0] : null].filter(Boolean).join(" · "),
              badge: a.external ? "External" : a.result === "success" ? (a.coverOrMoney ? "Cover/money" : "Done") : a.result === "denied" ? "Refused" : "Failed",
              badgeTone: a.result === "success" ? (a.external || a.coverOrMoney ? warn : ok) : bad,
              action: refForRecord(a.record, a.client) ? { a: "open", ref: refForRecord(a.record, a.client) } : null,
            }))
          : [{ title: "No activity yet", note: "Changes appear here as people and ASAP work.", badge: "Empty", badgeTone: warn }],
      ),
    ],
  };
}

/* ---------------------------------------------------------------- work items */

function workItemSpace(ref, state) {
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
      ...(() => {
        const run = state ? findRenewal(state, { workItemId: w.id }) : null;
        if (!run) return [];
        const o = run.operational;
        // The same operational view the Space and Ask read (D-131): status, current step, owner,
        // waiting party, next follow-up and approval — never the technical steps.
        return [
          note(run.state === "exception" ? "red" : o?.tone === "attention" ? "amber" : "green", "ASAP is handling this renewal — " + (o?.status ?? run.stateLabel), (o ? o.currentWork.title + ". " : "") + run.progress.done + " of " + run.progress.steps + " steps complete." + (run.exception ? " Stopped: " + run.exception.message : "")),
          ...(o ? [facts([
            ["Workflow", "Renewal" + (o.origin === "manual" ? " — started by a person" : " — found in the renewal window")],
            ["Responsible", o.owner?.name ?? "Unassigned"],
            ["Waiting for", o.waitingFor ? o.waitingFor.party + (o.waitingFor.since ? " since " + date(o.waitingFor.since) : "") : o.needsFromYou ? "You" : "Nobody outside the brokerage"],
            ["Next follow-up", o.nextFollowUpAt ? date(o.nextFollowUpAt) : "None scheduled"],
            ["Approval", run.approval ? (run.approval.state === "pending" ? "Waiting" : run.approval.state === "approved" ? "Approved — " + (run.approval.decidedByName ?? "a person") : run.approval.state) : "Not asked yet"],
            ["Prepared", o.outputs.map((x) => x.label + " (" + x.state + ")").join("; ") || "Nothing yet"],
          ])] : []),
          nav("Open the renewal", "What ASAP is doing, what it needs from you and when it follows up.", { ws: "renewal", runId: run.id, workItemId: w.id }),
        ];
      })(),
      facts([
        ["Client", client ? client.name : "Brokerage-wide"],
        ["Kind", w.kind],
        ["Where it stands", w.statusLabel || (w.state === "Completed" ? "Done" : "In progress")],
        ["Owner", owner ? owner.name : "unassigned"],
        ["Priority", { high: "High priority", medium: "Normal priority", low: "Low priority" }[w.priority] || "Normal priority"],
        ["Due", w.dueAt ? date(w.dueAt) : "not set"],
        ["Look again", w.nextCheckAt ? date(w.nextCheckAt) : "not set"],
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

/** A contact for a client: a new one (POST /contacts), or an existing one corrected (PATCH /contacts/:id). */
function newContactSpace(ref) {
  const c = ref.clientId ? S.sel.client(ref.clientId) : null;
  if (!c) return { kind: "Contact", title: "Choose the client first", status: "draft", statusLabel: "Not saved yet", blocks: [note("amber", "No client chosen", "Open the client, then add the contact from there. Nothing was changed.")] };
  const k = ref.contactId ? S.sel.contacts(c.id).find((x) => x.id === ref.contactId) : null;
  if (ref.contactId && !k) return { kind: "Contact", title: "That contact could not be found", status: "draft", statusLabel: "Not found", blocks: [note("red", "Not on this client", "It may have been removed. Refresh records from your profile. Nothing was changed."), nav("Open " + c.name, "Back to the client record.", { ws: "client", clientId: c.id })] };
  return {
    kind: "Contact",
    title: k ? "Edit " + k.name + " — " + c.name : "Add a contact for " + c.name,
    status: "draft",
    statusLabel: k ? (k.isPrimary ? "Primary contact" : "Contact") : "Not saved yet",
    blocks: [
      form(
        (k ? "editcontact:" + k.id : "newcontact:" + c.id),
        "Contact",
        [
          { key: "fullName", label: "FULL NAME", placeholder: "Who ASAP should talk to", value: k?.name || "" },
          { key: "roleLabel", label: "ROLE", placeholder: "For example Finance manager", value: k?.role || "" },
          { key: "email", label: "EMAIL", placeholder: "name@company.co.ke", value: k?.email || "" },
          { key: "phone", label: "PHONE (OPTIONAL)", placeholder: "+254…", value: k?.phone || "" },
        ],
        k ? "contact.update" : "contact.create",
        k ? { contactId: k.id } : { clientId: c.id },
        k ? "Save changes" : "Add contact",
        k ? "Saved to " + c.name + "’s record with an audit entry against your name. No message is sent to them." : "Saved to " + c.name + "’s file as the primary contact. No message is sent to them.",
      ),
      nav("Back to " + c.name, "The client record, with its contacts.", { ws: "client", clientId: c.id }),
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
  const fileLink = (page) => (d.fileUrl ? throughSupabaseBase(d.fileUrl) + (page ? "#page=" + page : "") : null);
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
                    badge: f.state === "proposed" ? (f.condition === "conflicting" ? "Different values — check" : "Proposed") : words(f.state),
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
                    open.map((f) =>
                      f.condition === "conflicting"
                        ? // Read more than one way: nothing prefilled, so the person checks the page and types it.
                          { key: f.id, label: words(f.fieldKey).toUpperCase() + " — DIFFERENT VALUES ON THE DOCUMENT" + (f.page ? " (FIRST ON PAGE " + f.page + ")" : ""), value: "", placeholder: "The document gives more than one value (one reads “" + (f.proposedValue ?? "") + "”) — check the page and type the right one" }
                        : { key: f.id, label: words(f.fieldKey).toUpperCase() + (f.page ? " (PAGE " + f.page + ")" : f.proposedValue ? "" : " — NOT FOUND"), value: f.proposedValue ?? "", placeholder: f.proposedValue ? "" : "Not found on this document — leave empty, or type it" },
                    ),
                    "doc.review",
                    { documentId: doc.id },
                    "Confirm these values",
                    "Unchanged values are accepted; edited ones are saved as your correction beside what was read; anything left empty is recorded as not on this document. Creating or updating records is the next step.",
                  ),
                ]
              : []),
            // A document read before any client exists creates its client and policy (D-132).
            ...(!open.length && settled.length && !doc.clientId ? createRecordsBlocks(d) : []),
            ...(!open.length && settled.length && doc.clientId ? applyBlocks(d, state) : []),
          ]
        : [note(doc.extractionState === "failed" ? "red" : "amber", reading, doc.extractionState === "failed" ? "Nothing was read from this file. It is still stored and can be opened." : "The values appear here for you to confirm once ASAP has read the file. Refresh records to check.")]),
    ],
  };
}

/**
 * Create the client and policy a reviewed document describes (D-132): only from values a person
 * accepted or corrected, shown before anything is written; anything missing is asked for, never
 * guessed. Confirming twice creates nothing twice.
 */
function createRecordsBlocks(d) {
  const accepted = (key) => {
    const f = (d.fields || []).find((x) => x.fieldKey === key && (x.state === "accepted" || x.state === "corrected"));
    return f ? f.correctedValue ?? f.proposedValue ?? "" : "";
  };
  const name = accepted("insured_name");
  const looksCompany = /\b(ltd|limited|plc|llc|inc|co|company|sacco|group|holdings|enterprises|traders|motors|services)\b/i.test(name);
  return [
    note("amber", "Create the client and policy from this document", "ASAP uses only the values you confirmed. Check them, fill in anything missing, then create the records. Nothing is sent to anyone."),
    form("create:" + d.document.id, "Records to create", [
      { key: "clientName", label: "CLIENT (INSURED)", value: name, placeholder: "As on the schedule" },
      { key: "kind", label: "CLIENT IS A", options: [{ value: looksCompany ? "corporate" : "individual", label: looksCompany ? "Company" : "Person" }, { value: looksCompany ? "individual" : "corporate", label: looksCompany ? "Person" : "Company" }] },
      { key: "insurerName", label: "INSURER", value: accepted("insurer_name"), placeholder: "Insurer on the schedule" },
      { key: "classOfBusiness", label: "CLASS OF BUSINESS", value: accepted("class_of_business"), placeholder: "Motor, Fire, Medical…" },
      { key: "policyNumber", label: "POLICY NUMBER", value: accepted("policy_number"), placeholder: "Optional" },
      { key: "periodStart", label: "COVER STARTS", value: accepted("period_start"), placeholder: "YYYY-MM-DD" },
      { key: "periodEnd", label: "COVER ENDS", value: accepted("period_end"), placeholder: "YYYY-MM-DD" },
      ...(accepted("premium") ? [{ key: "premiumBasis", label: "PREMIUM " + accepted("premium") + " IS", options: [{ value: "", label: "Not sure — don't apply the premium yet" }, { value: "gross", label: "The gross premium" }, { value: "total_payable", label: "Everything payable (with levies)" }] }] : []),
    ], "doc.createRecords", { documentId: d.document.id }, "Create client and policy", "Recorded with an audit entry against your name; the confirmed values stay linked to this document and their pages."),
  ];
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

/**
 * Quotations compared as ASAP read them (D-135): every value from the server's reading of its
 * document, each with where it was read; unread, missing and unclear values said as such; and no
 * recommendation — material terms missing, or values unconfirmed, are named instead.
 */
function quoteCompareSpace(ref, state) {
  const ids = ref.documentIds || [];
  const readings = ids.map((id) => state.quoteReadings?.get(id)).filter(Boolean);
  const failed = ids.filter((id) => state.quoteReadingErrors?.has(id));
  if (readings.length + failed.length < ids.length)
    return { kind: "Quote comparison", title: "Reading the quotations…", status: "live", statusLabel: "Loading", blocks: [note("green", "Reading what ASAP found in each quotation", "From your brokerage's records. Nothing is confirmed or chosen here.")] };
  if (readings.length < 2)
    return { kind: "Quote comparison", title: "Not enough quotations to compare", status: "draft", statusLabel: "Cannot compare", blocks: [note("red", "Fewer than two quotations could be read", (failed.length ? plural(failed.length, "quotation could", "quotations could") + " not be opened. " : "") + "A comparison needs at least two. Nothing was compared or chosen.")] };
  const fieldIdOf = (docId, key) => state.documents.get(docId)?.fields?.find((f) => f.fieldKey === key)?.id ?? null;
  const c = compareQuotations(readings, fieldIdOf);
  const open = (documentId, fieldId) => ({ a: "open", ref: { ws: "document", documentId, ...(fieldId ? { fieldId } : {}) } });
  return {
    kind: "Quote comparison",
    title: "Comparing " + plural(readings.length, "quotation", "quotations") + " as read",
    status: "draft",
    statusLabel: c.unconfirmed ? plural(c.unconfirmed, "value", "values") + " not confirmed" : "All values confirmed",
    blocks: [
      note(c.missingMaterial.length ? "red" : "amber", "No recommendation", c.whyNoRecommendation),
      ...(c.unconfirmed ? [note("amber", "These are readings, not confirmed terms", "Values marked “read, not confirmed” come from ASAP reading the documents. Confirm each quotation from its document before presenting this to the client. Nothing here was confirmed or chosen for you.")] : []),
      ...(failed.length ? [note("red", plural(failed.length, "quotation could not be opened", "quotations could not be opened"), "It is left out of the comparison rather than shown as empty.")] : []),
      { t: "compare", label: "Side by side", cols: c.cols, rows: c.rows },
      rows(
        "What could hurt the client",
        c.risks.length
          ? c.risks.map((r) => ({ title: r.insurer, note: r.text + (r.page ? " · page " + r.page : ""), badge: "Check", badgeTone: bad, action: open(r.documentId, null) }))
          : [{ title: "Nothing flagged from what was read", note: "That is not the same as nothing to worry about: geographic scope and payment terms are not read by ASAP — check them in each document.", badge: "Read", badgeTone: warn }],
      ),
      rows(
        "Where each value was read",
        c.evidence.map((e) => ({ title: e.insurer + " · " + e.label, note: e.value + (e.page ? " · page " + e.page : " · page not placed"), badge: e.confirmed ? "Confirmed" : "Read, not confirmed", badgeTone: e.confirmed ? ok : warn, action: open(e.documentId, e.fieldId) })),
      ),
      ...readings.map((r) => nav("Review " + r.document.filename, "Confirm what ASAP read from this quotation, value by value.", { ws: "document", documentId: r.document.id })),
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
    case "quotecompare":
      return quoteCompareSpace(ref, state);
    case "claim":
      return ref.claimId ? claimSpace(ref, state) : newClaimSpace(ref);
    case "workitem":
      return workItemSpace(ref, state);
    case "document":
      return documentSpace(ref, state);
    case "automation":
      return automationSpace(ref);
    case "renewal":
      return renewalSpace(ref, state);
    case "autonomy":
      return autonomySpace(ref, state);
    case "setup":
      return setupSpace(ref, state, state.db);
    case "activity":
    case "audit":
      return activitySpace(ref);
    case "settings":
      return settingsSpace(state);
    case "connections":
      return connectionsSpace(state);
    default:
      return null;
  }
}
