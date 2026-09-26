/**
 * Placement (4B-4).
 *
 * Every test here is one of the collapses the flow must refuse:
 *
 *   recommendation → client decision      a click is not evidence of what the client said
 *   decision → approved request            only someone permitted approves, and only a digest
 *   approved → submitted                   only evidence of transmission submits
 *   submitted → confirmed                  only the insurer's evidenced answer confirms
 *   confirmed → active cover               only the insurer's own effective date begins it
 *   confirmed → issued policy              4B-5, and a person; nothing here creates a policy
 *
 * The database enforces each as a constraint or trigger, proven in pgTAP (0327). The fake below
 * stands in for those triggers so the route is tested against the sequencing it really meets.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { coverOf, placementTitle } from "../src/routes/placement.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const OTIENO = { id: "a0000000-0000-4000-8000-000000000003", email: "placement@acme-brokers.test" };
const BAHATI = { id: "a0000000-0000-4000-8000-000000000002", email: "readonly@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";
const PLACEMENT_ROLE = "30000000-0000-4000-8000-000000000003";
const MANAGER_ROLE = "30000000-0000-4000-8000-000000000004";

const CLIENT = "20000000-0000-4000-8000-00000000000a";
const WORK = "26000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const OPP2 = "30000000-0000-4000-8000-00000000000c";
const INS_A = "21000000-0000-4000-8000-00000000000a";
const INS_B = "21000000-0000-4000-8000-00000000000b";
const INS_C = "21000000-0000-4000-8000-00000000000c";
const APPROACH_A = "31000000-0000-4000-8000-00000000000a";
const APPROACH_B = "31000000-0000-4000-8000-00000000000b";
const APPROACH_C = "31000000-0000-4000-8000-00000000000c";
const RESP_A = "34000000-0000-4000-8000-00000000000a";
const RESP_B = "34000000-0000-4000-8000-00000000000b";
const RESP_C = "34000000-0000-4000-8000-00000000000c";
const REV_A = "37000000-0000-4000-8000-00000000000a";
const REV_B = "37000000-0000-4000-8000-00000000000b";
const REV_C = "37000000-0000-4000-8000-00000000000c";
const TERM_A = "35000000-0000-4000-8000-00000000000a";
const TERM_REV_A = "38000000-0000-4000-8000-00000000000a";
const CMP = "36000000-0000-4000-8000-00000000000a";
const EMAIL = "3d000000-0000-4000-8000-00000000000a";
const DOC = "3a000000-0000-4000-8000-00000000000a";
const iso = "2026-09-05T09:00:00.000Z";
const LATER = "2027-06-30";

const PERMS: Record<string, [string, string][]> = {
  [ADMIN_ROLE]: [["placement", "create"], ["placement", "edit"], ["placement", "approve"], ["placement", "send_external"], ["space", "create"]],
  [MANAGER_ROLE]: [["placement", "approve"]],
  [PLACEMENT_ROLE]: [["placement", "create"], ["placement", "edit"], ["placement", "send_external"], ["space", "create"]],
  [READONLY_ROLE]: [["placement", "view"]],
};

function membership(userId: string, roleId: string, org = ORG) {
  return {
    id: `60000000-0000-4000-8000-00000000000${userId.slice(-1)}`,
    organization_id: org,
    user_id: userId,
    is_owner: roleId === ADMIN_ROLE,
    status: "active",
    joined_at: iso,
    organization: { id: org, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
    role: { id: roleId, key: "r", name: "R", description: null, is_system: true },
  };
}

function response(id: string, approachId: string, premium: string, validUntil = LATER) {
  return {
    id, organization_id: ORG, opportunity_id: OPP, opportunity_insurer_id: approachId,
    outcome: "quoted", received_at: iso, source_note: "Quotation letter.", source_document_id: null,
    source_email_message_id: null, premium_amount: premium, premium_currency: "KES",
    valid_until: validUntil, decline_reason: null, recorded_by: AMINA.id, recorded_at: iso,
  };
}

function revisionOf(id: string, r: Record<string, unknown>, revision = 1) {
  return {
    id, organization_id: ORG, insurer_response_id: r["id"], opportunity_id: OPP, revision,
    outcome: r["outcome"], received_at: r["received_at"], premium_amount: r["premium_amount"],
    premium_currency: r["premium_currency"], valid_until: r["valid_until"], decline_reason: null,
    source_document_id: null, source_email_message_id: null, source_note: r["source_note"],
    sha256: "0".repeat(64), created_at: iso,
  };
}

function makeDb(): FakeDb {
  const resA = response(RESP_A, APPROACH_A, "5310000.00");
  const resB = response(RESP_B, APPROACH_B, "5620000.00");
  const resC = response(RESP_C, APPROACH_C, "5900000.00");
  const db: FakeDb = {
    users: { "tok-amina": AMINA, "tok-otieno": OTIENO, "tok-bahati": BAHATI },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: OTIENO.id, email: OTIENO.email, full_name: "Otieno", display_name: "Otieno", active_organization_id: ORG },
        { id: BAHATI.id, email: BAHATI.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organization_memberships: [membership(AMINA.id, ADMIN_ROLE), membership(OTIENO.id, PLACEMENT_ROLE), membership(BAHATI.id, READONLY_ROLE)],
      roles: [
        { id: ADMIN_ROLE, organization_id: ORG, name: "Brokerage administrator" },
        { id: MANAGER_ROLE, organization_id: ORG, name: "Manager" },
        { id: PLACEMENT_ROLE, organization_id: ORG, name: "Placement officer" },
        { id: READONLY_ROLE, organization_id: ORG, name: "Read-only user" },
      ],
      role_permissions: Object.entries(PERMS).flatMap(([role, perms]) =>
        perms.map(([object_type, verb]) => ({ role_id: role, permission: { object_type, verb } })),
      ),
      clients: [{ id: CLIENT, organization_id: ORG, name: "Acme Ltd", kind: "corporate", file_status: "cleared", created_at: iso, deleted_at: null }],
      insurers: [
        { id: INS_A, organization_id: ORG, name: "Jubilee" },
        { id: INS_B, organization_id: ORG, name: "CIC" },
        { id: INS_C, organization_id: ORG, name: "Britam" },
      ],
      work_items: [
        { id: WORK, organization_id: ORG, client_id: CLIENT, kind: "new_business", title: "Acme motor fleet quotation — 2027", task_status: "needs_you", task_party: null, task_since: null, version: 1, steps: [], created_at: iso, deleted_at: null },
      ],
      requirement_templates: [],
      opportunities: [
        { id: OPP, organization_id: ORG, client_id: CLIENT, work_item_id: WORK, title: "Acme motor fleet quotation — 2027", class_of_business: "Commercial motor", risk_summary: null, cover_start: null, cover_end: null, source_email_message_id: null, source_document_id: null, owner_id: AMINA.id, created_by: AMINA.id, created_at: iso, closed_at: null, closed_outcome: null, closed_reason: null },
      ],
      opportunity_requirements: [],
      opportunity_insurers: [
        { id: APPROACH_A, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_A, added_by: AMINA.id, added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
        { id: APPROACH_B, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_B, added_by: AMINA.id, added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
        { id: APPROACH_C, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_C, added_by: AMINA.id, added_at: iso, removed_at: null, removed_by: null, removed_reason: null },
      ],
      quote_requests: [],
      insurer_responses: [resA, resB, resC],
      insurer_response_revisions: [revisionOf(REV_A, resA), revisionOf(REV_B, resB), revisionOf(REV_C, resC)],
      quote_terms: [
        { id: TERM_A, organization_id: ORG, insurer_response_id: RESP_A, term_type: "excess", label: "Own damage", extracted_value: "5% min KES 30,000", corrected_value: null, corrected_by: null, corrected_at: null, amount: null, currency: null, unclear: false, evidence_document_id: null, evidence_page: null, position: 0, created_at: iso },
      ],
      quote_term_revisions: [
        { id: TERM_REV_A, organization_id: ORG, quote_term_id: TERM_A, insurer_response_id: RESP_A, revision: 1, term_type: "excess", label: "Own damage", extracted_value: "5% min KES 30,000", corrected_value: null, corrected_by: null, corrected_at: null, amount: null, currency: null, unclear: false, evidence_document_id: null, evidence_page: null, region_x: null, region_y: null, region_width: null, region_height: null, sha256: "0".repeat(64), created_at: iso },
      ],
      /* A comparison of A and B — not C — made, current, and put to the client. */
      quote_comparisons: [
        { id: CMP, organization_id: ORG, opportunity_id: OPP, generated_by: AMINA.id, generated_at: iso, presented_at: iso, presented_by: AMINA.id, superseded_at: null, superseded_reason: null, version: 1 },
      ],
      quote_comparison_inputs: [
        { id: "3e000000-0000-4000-8000-00000000000a", organization_id: ORG, comparison_id: CMP, insurer_response_id: RESP_A, insurer_id: INS_A, response_sha256: "0".repeat(64), response_revision_id: REV_A, created_at: iso },
        { id: "3e000000-0000-4000-8000-00000000000b", organization_id: ORG, comparison_id: CMP, insurer_response_id: RESP_B, insurer_id: INS_B, response_sha256: "0".repeat(64), response_revision_id: REV_B, created_at: iso },
      ],
      quote_comparison_terms: [
        { id: "3f000000-0000-4000-8000-00000000000a", organization_id: ORG, comparison_input_id: "3e000000-0000-4000-8000-00000000000a", quote_term_id: TERM_A, term_type: "excess", label: "Own damage", term_sha256: "0".repeat(64), term_revision_id: TERM_REV_A },
      ],
      company_rules: [],
      documents: [],
      email_messages: [],
      policies: [],
      client_instructions: [],
      placements: [],
      placement_basis_terms: [],
      placement_requests: [],
      placement_request_approvals: [],
      placement_submissions: [],
      placement_insurer_responses: [],
      placement_cancellations: [],
      placement_basis_versions: [],
      placement_confirmation_terms: [],
      cover_match_results: [],
      cover_match_items: [],
      client_change_acceptances: [],
      client_change_acceptance_items: [],
      prepared_actions: [],
      audit_log: [],
    },
    defaults: {
      client_instructions: { superseded_at: null, superseded_reason: null, outside_comparison: false, exception_reason: null, exception_by: null, client_conditions: null, evidence_email_message_id: null, evidence_document_id: null, evidence_note: null, recorded_at: iso },
      placements: { abandoned_at: null, abandoned_reason: null, requested_expiry_at: null },
      placement_requests: { superseded_at: null, superseded_reason: null, outstanding_conditions: null, prepared_at: iso },
      placement_request_approvals: { superseded_at: null, superseded_reason: null, approved_at: iso },
      placement_submissions: { evidence_document_id: null, evidence_note: null, provider_message_id: null, recorded_at: iso },
      placement_insurer_responses: { superseded_at: null, superseded_reason: null, effective_at: null, expiry_at: null, insurer_reference: null, changes_note: null, information_required: null, decline_reason: null, evidence_document_id: null, evidence_email_message_id: null, evidence_note: null, recorded_at: iso },
      placement_cancellations: { evidence_document_id: null, evidence_email_message_id: null, evidence_note: null, recorded_at: iso },
      placement_basis_versions: { created_at: iso },
      cover_match_results: { compared_at: iso },
      client_change_acceptances: { recorded_at: iso },
      prepared_actions: { state: "prepared", decided_by: null, decided_at: null, receipt: null, prepared_at: iso },
    },
    uniques: {
      client_instructions: [],
      placements: [["client_instruction_id"]],
      placement_submissions: [["organization_id", "idempotency_key"], ["placement_request_id"]],
      placement_cancellations: [["placement_id"]],
      placement_basis_versions: [["placement_id", "version"]],
      client_change_acceptances: [["cover_match_result_id"]],
      prepared_actions: [["organization_id", "idempotency_key"]],
    },
  };

  /* ---- The triggers of 0054, stood in for so the route meets the sequencing it really will. -- */
  db.beforeInsert = {
    placement_requests: (row, d) => {
      const mine = (d.tables["placement_requests"] ?? []).filter((r) => r["placement_id"] === row["placement_id"]);
      row["version"] = mine.reduce((m, r) => Math.max(m, r["version"] as number), 0) + 1;
      /* The digest is the database's: distinct per content, so an edit really is a new digest. */
      row["sha256"] = String(JSON.stringify([row["subject"], row["body_text"], row["cover_requested"], row["outstanding_conditions"] ?? null]).length)
        .padStart(64, "a");
      for (const r of mine) {
        if (r["superseded_at"] === null) {
          r["superseded_at"] = iso;
          r["superseded_reason"] = "A newer version of this request was prepared.";
          for (const a of d.tables["placement_request_approvals"] ?? []) {
            if (a["placement_request_id"] === r["id"] && a["superseded_at"] === null) {
              a["superseded_at"] = iso;
              a["superseded_reason"] = "The request was changed after it was approved.";
            }
          }
        }
      }
    },
    placement_request_approvals: (row, d) => {
      const live = (d.tables["placement_request_approvals"] ?? []).find(
        (a) => a["placement_request_id"] === row["placement_request_id"] && a["superseded_at"] === null,
      );
      if (live) return { code: "23505", message: "one live approval per request" };
      const req = (d.tables["placement_requests"] ?? []).find((r) => r["id"] === row["placement_request_id"]);
      if (!req || req["sha256"] !== row["sha256"]) return { code: "23514", message: "approval must cover the request" };
    },
    placement_submissions: (row, d) => {
      const approval = (d.tables["placement_request_approvals"] ?? []).find(
        (a) => a["placement_request_id"] === row["placement_request_id"] && a["superseded_at"] === null,
      );
      if (!approval || approval["sha256"] !== row["sha256"]) return { code: "23514", message: "not approved" };
    },
    placement_insurer_responses: (row, d) => {
      const reqs = (d.tables["placement_requests"] ?? []).filter((r) => r["placement_id"] === row["placement_id"]).map((r) => r["id"]);
      const sent = (d.tables["placement_submissions"] ?? []).some((s) => reqs.includes(s["placement_request_id"]));
      if (!sent) return { code: "23514", message: "nothing sent" };
    },
  };

  /*
   * The engine's Work functions of 0055, stood in for: identity is (organization, source type,
   * source id, reason code) — never the title — and at most one open item per identity.
   */
  db.rpc = {
    quote_comparison_changes: () => ({ data: [] }),
    work_item_ensure: (args) => {
      const rows = db.tables["work_items"]!;
      if (args["p_task_status"] === "with_party" && (!args["p_task_party"] || !args["p_task_since"])) {
        return { error: { code: "23514", message: "with_party needs a party and a since date" } };
      }
      const open = rows.find(
        (r) =>
          r["organization_id"] === args["p_organization_id"] &&
          r["source_type"] === args["p_source_type"] &&
          r["source_id"] === args["p_source_id"] &&
          r["reason_code"] === args["p_reason_code"] &&
          r["task_status"] !== "done",
      );
      const fields = {
        title: args["p_title"], reason: args["p_reason"], required_action: args["p_required_action"],
        evidence_needed: args["p_evidence_needed"], task_status: args["p_task_status"], task_party: args["p_task_party"],
        task_since: args["p_task_since"], task_next_check: args["p_task_next_check"],
        owner_id: args["p_owner_id"] ?? open?.["owner_id"] ?? null,
      };
      if (open) {
        Object.assign(open, fields, { version: (open["version"] as number) + 1 });
        db.tables["audit_log"]!.push({ action: "work.refreshed", organization_id: open["organization_id"] });
        return { data: { id: open["id"], reopened: true } };
      }
      const id = `26000000-0000-4000-8000-${String(100000000000 + rows.length).slice(-12)}`;
      rows.push({
        id, organization_id: args["p_organization_id"], kind: args["p_kind"], client_id: args["p_client_id"],
        insurer_id: args["p_insurer_id"], source_type: args["p_source_type"], source_id: args["p_source_id"],
        reason_code: args["p_reason_code"], version: 1, steps: [], created_at: iso, deleted_at: null, ...fields,
      });
      db.tables["audit_log"]!.push({ action: "work.opened", organization_id: args["p_organization_id"] });
      return { data: { id, reopened: false } };
    },
    work_item_resolve: (args) => {
      let n = 0;
      for (const r of db.tables["work_items"]!) {
        if (
          r["organization_id"] === args["p_organization_id"] &&
          r["source_type"] === args["p_source_type"] &&
          r["source_id"] === args["p_source_id"] &&
          r["reason_code"] === args["p_reason_code"] &&
          r["task_status"] !== "done"
        ) {
          r["task_status"] = "done";
          r["version"] = (r["version"] as number) + 1;
          n += 1;
        }
      }
      return { data: n };
    },
  };
  return db;
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = () =>
  createApp({
    logger: pino({ level: process.env["DBG"] ? "error" : "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "t",
  });

beforeEach(() => {
  db = makeDb();
});

const asUser = (token = "tok-amina") => ({ authorization: `Bearer ${token}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

async function post(path: string, body: unknown, token = "tok-amina") {
  return await readJson(
    await build().request(path, {
      method: "POST",
      headers: { ...asUser(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const INSTRUCTION = {
  insurerResponseId: RESP_A,
  source: "telephone",
  evidenceNote: "Client rang at 10:40 on 7 September and chose Jubilee on the terms shown.",
  instructedAt: "2026-09-07T10:40:00.000Z",
  requestedEffectiveAt: "2026-10-01T00:00:00.000Z",
  requestedExpiryAt: "2027-09-30T23:59:59.000Z",
};

const instruct = (over: Record<string, unknown> = {}, token = "tok-amina") =>
  post(`/opportunities/${OPP}/instruction`, { ...INSTRUCTION, ...over }, token);

async function placed() {
  const res = await instruct();
  expect(res.outcome).toBe("done");
  return res.placementId as string;
}

const act = (placementId: string, body: unknown, token = "tok-amina") =>
  post(`/placements/${placementId}/actions`, body, token);

async function read(placementId: string, token = "tok-amina") {
  const res = await build().request(`/placements/${placementId}`, { headers: asUser(token) });
  return { status: res.status, body: res.status === 200 ? await readJson(res) : null };
}

const REQUEST = {
  action: "prepare_request",
  subject: "Placement instruction — Acme Ltd",
  body: "Please place commercial motor cover on the terms quoted.",
  coverRequested: "Commercial motor, fleet of five vehicles",
};

async function approved(placementId: string) {
  await act(placementId, REQUEST);
  const { body } = await read(placementId);
  expect((await act(placementId, { action: "approve_request", placementRequestId: body.request.id })).outcome).toBe("done");
  return (await read(placementId)).body.request.id as string;
}

const SUBMISSION = (requestId: string, key = "submit-0001") => ({
  action: "record_submission",
  placementRequestId: requestId,
  method: "recorded_manual_email",
  recipient: "underwriting@jubilee.test",
  sentAt: "2026-09-08T11:02:00.000Z",
  evidenceNote: "Sent from my own mailbox at 11:02 on 8 September to the Jubilee underwriting desk.",
  idempotencyKey: key,
});

async function submitted(placementId: string) {
  const requestId = await approved(placementId);
  expect((await act(placementId, SUBMISSION(requestId))).outcome).toBe("done");
  return requestId;
}

const CONFIRM = (over: Record<string, unknown> = {}) => ({
  action: "record_insurer_response",
  outcome: "confirmed_as_requested",
  receivedAt: "2026-09-09T14:10:00.000Z",
  effectiveAt: "2026-10-01T00:00:00.000Z",
  expiryAt: "2027-09-30T23:59:59.000Z",
  insurerReference: "CN-2027-0041",
  evidenceNote: "Cover note CN-2027-0041 received by email at 14:10.",
  ...over,
});

/* ============================================================================================= */

describe("who may reach it", () => {
  it("refuses an unauthenticated reading and an unauthenticated action", async () => {
    const id = await placed();
    expect((await build().request(`/placements/${id}`)).status).toBe(401);
    expect(
      (await build().request(`/placements/${id}/actions`, { method: "POST", body: "{}" })).status,
    ).toBe(401);
  });

  it("is invisible to another brokerage", async () => {
    const id = await placed();
    db.tables["placements"]![0]!["organization_id"] = OTHER_ORG;
    expect((await read(id)).status).toBe(404);
  });
});

describe("a recommendation is not a decision", () => {
  it("creates no placement by reading a comparison or its recommendation", async () => {
    await build().request(`/opportunities/${OPP}/comparison`, { headers: asUser() });
    expect(db.tables["placements"]).toHaveLength(0);
    expect(db.tables["client_instructions"]).toHaveLength(0);
  });
});

describe("the client's instruction", () => {
  it("records a telephone instruction written down by the person who took it", async () => {
    const id = await placed();
    const { body } = await read(id);
    expect(body.instruction.source).toBe("telephone");
    expect(body.instruction.evidence.label).toMatch(/Client rang at 10:40/);
    expect(body.instruction.recordedByName).toBe("Amina");
    expect(body.instruction.comparisonVersion).toBe(1);
  });

  it("records an instruction by email, linked to the email", async () => {
    const res = await instruct({ source: "email", evidenceNote: undefined, evidenceEmailMessageId: EMAIL });
    expect(res.outcome).toBe("done");
    const { body } = await read(res.placementId);
    expect(body.instruction.evidence).toMatchObject({ kind: "email", id: EMAIL });
  });

  it("records an instruction in an uploaded document, which opens at that document", async () => {
    const res = await instruct({ source: "signed_acceptance", evidenceNote: undefined, evidenceDocumentId: DOC });
    expect(res.outcome).toBe("done");
    const { body } = await read(res.placementId);
    expect(body.instruction.evidence).toMatchObject({ kind: "document", id: DOC, path: `/documents/${DOC}` });
  });

  it("refuses an instruction with no evidence of how it arrived — a click is not a decision", async () => {
    const res = await instruct({ evidenceNote: "ok" });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/Say how the client's instruction arrived/);
    expect(db.tables["placements"]).toHaveLength(0);
  });

  it("refuses a document instruction with no document", async () => {
    const res = await instruct({ source: "document" });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/needs the document attached/);
  });

  it("refuses against a comparison that is out of date", async () => {
    db.tables["quote_comparisons"]![0]!["superseded_at"] = iso;
    db.tables["quote_comparisons"]![0]!["superseded_reason"] = "Jubilee changed its quote.";
    const res = await instruct();
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/No comparison has been made|cannot be relied on/);
  });

  it("refuses against a comparison holding an expired quote", async () => {
    db.tables["insurer_response_revisions"]![0]!["valid_until"] = "2026-01-01";
    const res = await instruct();
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/expired quotation is not an offer/);
  });

  it("refuses when the comparison was never put to the client", async () => {
    db.tables["quote_comparisons"]![0]!["presented_at"] = null;
    db.tables["quote_comparisons"]![0]!["presented_by"] = null;
    const res = await instruct();
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/Record that this comparison went to the client first/);
  });

  it("refuses a quote the client was not shown, by the ordinary route", async () => {
    const res = await instruct({ insurerResponseId: RESP_C });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/The client was not shown this quote/);
  });

  it("allows that quote only as a recorded exception, by someone who may approve", async () => {
    const refused = await instruct(
      { insurerResponseId: RESP_C, outsideComparison: { reason: "Client asked for Britam by name after the meeting." } },
      "tok-otieno",
    );
    expect(refused.outcome).toBe("blocked");
    expect(refused.reason).toMatch(/Only someone who may approve placements/);
    expect(refused.reason).toMatch(/Brokerage administrator or Manager/);

    const res = await instruct({
      insurerResponseId: RESP_C,
      outsideComparison: { reason: "Client asked for Britam by name after the meeting." },
    });
    expect(res.outcome).toBe("done");
    const { body } = await read(res.placementId);
    expect(body.instruction.outsideComparison).toBe(true);
    expect(body.instruction.exceptionReason).toMatch(/asked for Britam by name/);
  });

  it("is idempotent: the same instruction again is the same placement", async () => {
    const first = await placed();
    const again = await instruct();
    expect(again.outcome).toBe("already");
    expect(again.placementId).toBe(first);
    expect(db.tables["placements"]).toHaveLength(1);
  });

  it("a changed choice supersedes the old instruction and abandons its placement, keeping both", async () => {
    const first = await placed();
    const second = await instruct({ insurerResponseId: RESP_B });
    expect(second.outcome).toBe("done");
    expect(second.placementId).not.toBe(first);

    const old = db.tables["client_instructions"]!.find((i) => i["insurer_response_id"] === RESP_A)!;
    expect(old["superseded_reason"]).toMatch(/changed their choice of insurer/);
    expect(db.tables["placements"]!.find((p) => p["id"] === first)!["abandoned_at"]).not.toBeNull();

    const { body } = await read(second.placementId);
    expect(body.instructionHistory).toHaveLength(1);
  });

  it("refuses somebody who may not record an instruction", async () => {
    const res = await instruct({}, "tok-bahati");
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/may not record a client's instruction/);
  });
});

describe("the frozen basis", () => {
  it("copies exactly what the client accepted, by revision", async () => {
    const id = await placed();
    const { body } = await read(id);
    expect(body.basis.premiumAmount).toBe("5310000.00");
    expect(body.basis.terms).toEqual([
      expect.objectContaining({ termType: "excess", label: "Own damage", value: "5% min KES 30,000" }),
    ]);
    expect(db.tables["placement_basis_terms"]![0]!["quote_term_revision_id"]).toBe(TERM_REV_A);
  });

  it("does not move when the quotation moves, and names what did", async () => {
    const id = await placed();
    /* The insurer revises: a new revision of the answer and of the excess. */
    db.tables["insurer_response_revisions"]!.push({ ...db.tables["insurer_response_revisions"]![0]!, id: "37000000-0000-4000-8000-0000000000aa", revision: 2, premium_amount: "5410000.00" });
    db.tables["quote_term_revisions"]!.push({ ...db.tables["quote_term_revisions"]![0]!, id: "38000000-0000-4000-8000-0000000000aa", revision: 2, corrected_value: "5% min KES 50,000" });

    const { body } = await read(id);
    expect(body.basis.premiumAmount).toBe("5310000.00");
    expect(body.basis.terms[0].value).toBe("5% min KES 30,000");
    expect(body.drift.stale).toBe(true);
    expect(body.drift.changes).toEqual(
      expect.arrayContaining([
        { label: "Premium", was: "KES 5,310,000", now: "KES 5,410,000" },
        { label: "Own damage", was: "5% min KES 30,000", now: "5% min KES 50,000" },
      ]),
    );
  });

  it("blocks preparing, approving and sending while the quotation has moved", async () => {
    const id = await placed();
    await act(id, REQUEST);
    const requestId = (await read(id)).body.request.id;
    db.tables["insurer_response_revisions"]!.push({ ...db.tables["insurer_response_revisions"]![0]!, id: "37000000-0000-4000-8000-0000000000aa", revision: 2, premium_amount: "5410000.00" });

    const approve = await act(id, { action: "approve_request", placementRequestId: requestId });
    expect(approve.outcome).toBe("blocked");
    expect(approve.reason).toMatch(/quotation has changed since the client accepted it/);

    const prepare = await act(id, { ...REQUEST, body: "Changed." });
    expect(prepare.outcome).toBe("blocked");
    expect(prepare.reason).toMatch(/Premium/);
  });
});

describe("the request and its approval", () => {
  it("prepares a draft that is plainly not sent", async () => {
    const id = await placed();
    expect((await act(id, REQUEST)).outcome).toBe("done");
    const { body } = await read(id);
    expect(body.request.version).toBe(1);
    expect(body.request.approval).toBeNull();
    expect(body.request.submission).toBeNull();
    expect(body.cover.state).toBe("requested");
    expect(body.cover.line).toMatch(/has not been sent, and there is no cover/);
    expect(body.sending.available).toBe(false);
    expect(body.sending.reason).toMatch(/not connected yet/);
  });

  it("refuses approval to somebody without the permission, names who may, and puts it in Work", async () => {
    const id = await placed();
    await act(id, REQUEST);
    const requestId = (await read(id)).body.request.id;
    const before = JSON.stringify(db.tables["placement_request_approvals"]);

    const res = await act(id, { action: "approve_request", placementRequestId: requestId }, "tok-otieno");
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/You may not approve placement requests/);
    expect(res.reason).toMatch(/Brokerage administrator or Manager/);

    /* Nothing about the placement changed, and Work says what it waits for. */
    expect(JSON.stringify(db.tables["placement_request_approvals"])).toBe(before);
    expect(db.tables["audit_log"]!.some((a) => a["action"] === "placement.approval_refused")).toBe(true);
    const open = db.tables["work_items"]!.filter((w) => w["source_id"] === id && w["task_status"] !== "done");
    expect(open.map((w) => w["reason_code"])).toEqual(["approval_required"]);
  });

  it("is approved by someone permitted, against the exact digest", async () => {
    const id = await placed();
    const requestId = await approved(id);
    const approval = db.tables["placement_request_approvals"]![0]!;
    const request = db.tables["placement_requests"]!.find((r) => r["id"] === requestId)!;
    expect(approval["sha256"]).toBe(request["sha256"]);
    expect(approval["approved_by"]).toBe(AMINA.id);
  });

  it("approving twice records one approval", async () => {
    const id = await placed();
    const requestId = await approved(id);
    expect((await act(id, { action: "approve_request", placementRequestId: requestId })).outcome).toBe("already");
    expect(db.tables["placement_request_approvals"]).toHaveLength(1);
  });

  it("an approved request that is changed loses its approval and cannot be sent", async () => {
    const id = await placed();
    const oldRequest = await approved(id);

    expect((await act(id, { ...REQUEST, body: "Please place cover, with the windscreen extension." })).outcome).toBe("done");
    const { body } = await read(id);
    expect(body.request.version).toBe(2);
    expect(body.request.approval).toBeNull();
    expect(body.requestHistory[0]).toMatchObject({ version: 1, supersededReason: expect.stringMatching(/newer version/) });

    /* The old version's approval is stale, and neither version can go. */
    expect(db.tables["placement_request_approvals"]![0]!["superseded_at"]).not.toBeNull();
    const oldSend = await act(id, SUBMISSION(oldRequest));
    expect(oldSend.outcome).toBe("blocked");
    const newSend = await act(id, SUBMISSION(body.request.id, "submit-0002"));
    expect(newSend.outcome).toBe("blocked");
    expect(newSend.reason).toMatch(/has not been approved/);
  });
});

describe("recording that it was sent", () => {
  it("refuses to record a draft as sent", async () => {
    const id = await placed();
    await act(id, REQUEST);
    const res = await act(id, SUBMISSION((await read(id)).body.request.id));
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/A draft is not sent/);
    expect(db.tables["placement_submissions"]).toHaveLength(0);
  });

  it("refuses \"sent\" with nothing behind it", async () => {
    const id = await placed();
    const requestId = await approved(id);
    const res = await act(id, { ...SUBMISSION(requestId), evidenceNote: "sent" });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/is not evidence/);
    expect(db.tables["placement_submissions"]).toHaveLength(0);
  });

  it("records a manual submission with its evidence, and Work names the insurer and the date", async () => {
    const id = await placed();
    await submitted(id);
    const { body } = await read(id);
    expect(body.request.submission).toMatchObject({ method: "recorded_manual_email", recipient: "underwriting@jubilee.test" });
    expect(body.cover.state).toBe("submitted");
    expect(body.cover.line).toMatch(/Not confirmed — there is no cover yet/);

    expect(body.work).toHaveLength(1);
    expect(body.work[0].headline).toBe("cover confirmation requested");
    const work = db.tables["work_items"]!.find((w) => w["id"] === body.work[0].id)!;
    expect(work["reason_code"]).toBe("awaiting_insurer");
    expect(work["task_status"]).toBe("with_party");
    expect(work["task_party"]).toBe("Jubilee");
    expect(work["task_since"]).toBe("2026-09-08T11:02:00.000Z");
  });

  it("recording the same submission twice records one", async () => {
    const id = await placed();
    const requestId = await submitted(id);
    expect((await act(id, SUBMISSION(requestId))).outcome).toBe("already");
    expect(db.tables["placement_submissions"]).toHaveLength(1);
  });

  it("refuses somebody who may not record sending", async () => {
    const id = await placed();
    const requestId = await approved(id);
    const res = await act(id, SUBMISSION(requestId), "tok-bahati");
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/may not record that a placement request was sent/);
  });
});

describe("what the insurer said", () => {
  it("cannot be recorded before anything was sent", async () => {
    const id = await placed();
    await approved(id);
    const res = await act(id, CONFIRM());
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/Nothing has been sent to the insurer/);
  });

  it("records a confirmation as requested, and policy issuance becomes preparable", async () => {
    const id = await placed();
    await submitted(id);
    expect((await act(id, CONFIRM())).outcome).toBe("done");
    const { body } = await read(id);
    expect(body.insurerResponse).toMatchObject({ outcome: "confirmed_as_requested", insurerReference: "CN-2027-0041" });
    expect(body.coverMatch).toMatchObject({ current: true, materialDifferences: 0 });
    expect(body.readiness.state).toBe("ready");
    expect(body.readiness.reasons).toEqual([]);
    expect(body.readiness.deferredChecks.join(" ")).toMatch(/Money \(4D\)/);
    expect(body.work.map((w: { reason: string }) => w.reason)).toEqual(["issue_policy"]);
  });

  it("refuses a confirmation that does not say when cover begins", async () => {
    const id = await placed();
    await submitted(id);
    const res = await act(id, CONFIRM({ effectiveAt: undefined }));
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/must say when cover begins/);
  });

  it("refuses a confirmation with no evidence", async () => {
    const id = await placed();
    await submitted(id);
    const res = await act(id, CONFIRM({ evidenceNote: undefined }));
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/needs evidence/);
  });

  it("does not silently confirm changed terms — it names them and blocks issuance", async () => {
    const id = await placed();
    await submitted(id);
    const res = await act(id, CONFIRM({
      outcome: "confirmed_with_changes",
      changesNote: "Own damage excess raised to 7.5%, minimum KES 45,000.",
      termChanges: [{ termType: "excess", label: "Own damage", value: "7.5% min KES 45,000" }],
    }));
    expect(res.outcome).toBe("done");
    const { body } = await read(id);
    expect(body.cover.line).toMatch(/on the insurer's changed terms/);
    expect(body.blockers.join(" ")).toMatch(/differ from what the client accepted: Own damage/);
    expect(body.readiness.state).toBe("blocked");
    expect(body.readiness.reasons.map((r: { code: string }) => r.code)).toContain("unaccepted_differences");
    expect(body.work.map((w: { reason: string }) => w.reason)).toEqual(["review_changed_terms"]);
    const issuance = await act(id, { action: "prepare_issuance" });
    expect(issuance.outcome).toBe("blocked");
  });

  it("records a request for more information as something a person must do", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, { action: "record_insurer_response", outcome: "more_information_required", receivedAt: "2026-09-09T14:10:00.000Z", informationRequired: "Logbooks for all five vehicles." });
    const { body } = await read(id);
    expect(body.cover.state).toBe("submitted");
    expect(body.blockers.join(" ")).toMatch(/Jubilee needs: Logbooks/);
    expect(body.work[0]).toMatchObject({ reason: "insurer_needs_information", taskStatus: "needs_you" });
  });

  it("records a decline, which is no cover", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, { action: "record_insurer_response", outcome: "declined", receivedAt: "2026-09-09T14:10:00.000Z", declineReason: "Outside appetite for this fleet." });
    const { body } = await read(id);
    expect(body.cover.state).toBeNull();
    expect(body.cover.line).toMatch(/declined. There is no cover/);
  });
});

describe("the cover-period line", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const confirmed = (effective: string, expiry: string | null) => ({
    outcome: "confirmed_as_requested", effective_at: effective, expiry_at: expiry,
  });

  it("is Active cover only once the insurer's own effective date has begun", () => {
    expect(coverOf({}, {}, confirmed("2026-09-01T00:00:00Z", "2027-08-31T00:00:00Z"), null, "Jubilee", now).state).toBe("active");
  });

  it("is Confirmed, not active, when cover begins in the future", () => {
    const line = coverOf({}, {}, confirmed("2026-10-01T00:00:00Z", null), null, "Jubilee", now);
    expect(line.state).toBe("confirmed");
    expect(line.line).toMatch(/has not started yet/);
  });

  it("is Expired once the end has passed", () => {
    expect(coverOf({}, {}, confirmed("2025-09-01T00:00:00Z", "2026-08-31T00:00:00Z"), null, "Jubilee", now).state).toBe("expired");
  });

  it("is Cancelled when there is evidence of cancellation, whatever else is true", () => {
    expect(
      coverOf({}, {}, confirmed("2026-09-01T00:00:00Z", null), { cancelled_at: "2026-09-10T00:00:00Z" }, "Jubilee", now).state,
    ).toBe("cancelled");
  });

  it("is Submitted, not confirmed, when only a submission exists", () => {
    expect(coverOf({}, { sent_at: "2026-09-08T00:00:00Z" }, null, null, "Jubilee", now).state).toBe("submitted");
  });

  it("is Requested for a draft, and nothing at all before one", () => {
    expect(coverOf({}, null, null, null, "Jubilee", now).state).toBe("requested");
    expect(coverOf(null, null, null, null, "Jubilee", now).state).toBeNull();
  });
});

describe("cancellation", () => {
  it("needs evidence, and then ends the cover", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM());

    const bare = await act(id, { action: "record_cancellation", cancelledAt: "2026-09-20T00:00:00.000Z", reason: "Client withdrew." });
    expect(bare.outcome).toBe("blocked");
    expect(bare.reason).toMatch(/needs evidence/);

    const ok = await act(id, {
      action: "record_cancellation",
      cancelledAt: "2026-09-20T00:00:00.000Z",
      reason: "Client withdrew.",
      evidenceNote: "Client's signed withdrawal letter received 19 September.",
    });
    expect(ok.outcome).toBe("done");
    expect((await read(id)).body.cover.state).toBe("cancelled");
  });
});

describe("the handoff to policy issuance", () => {
  it("creates no policy — only Work, once", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM());

    /* A clean match opens the issuance Work itself; asking for it again finds the same item. */
    expect((await act(id, { action: "prepare_issuance" })).outcome).toBe("already");
    expect((await act(id, { action: "prepare_issuance" })).outcome).toBe("already");

    const issuance = db.tables["work_items"]!.filter((w) => w["source_id"] === id && w["reason_code"] === "issue_policy");
    expect(issuance).toHaveLength(1);
    expect(issuance[0]!["task_status"]).toBe("needs_you");
    expect(db.tables["policies"]).toHaveLength(0);

    const { body } = await read(id);
    expect(body.readiness.workItemId).toBe(issuance[0]!["id"]);
  });

  it("refuses before cover is confirmed", async () => {
    const id = await placed();
    await submitted(id);
    const res = await act(id, { action: "prepare_issuance" });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/The insurer has not confirmed cover/);
  });
});

describe("Work", () => {
  it("opens a placement item named for the work, without anybody opening Activity", async () => {
    const id = await placed();
    const { body } = await read(id);
    const work = db.tables["work_items"]!.find((w) => w["id"] === body.work[0].id)!;
    expect(work["kind"]).toBe("placement");
    expect(work["title"]).toBe("Acme motor fleet placement — 2027: prepare the placement request");
    expect(work).toMatchObject({ source_type: "placement", source_id: id, reason_code: "prepare_request" });
    expect(body.placement.title).toBe("Acme motor fleet placement — 2027");
  });

  it("does not open a second item when the instruction is retried", async () => {
    await placed();
    await instruct();
    expect(db.tables["work_items"]!.filter((w) => w["kind"] === "placement")).toHaveLength(1);
  });
});

describe("two placements at once", () => {
  it("keeps them apart", async () => {
    const first = await placed();

    db.tables["opportunities"]!.push({ ...db.tables["opportunities"]![0]!, id: OPP2, title: "Acme property quotation — 2027", class_of_business: "Property" });
    for (const r of db.tables["insurer_responses"]!.slice(0, 2)) {
      db.tables["insurer_responses"]!.push({ ...r, id: `${String(r["id"]).slice(0, -1)}f`, opportunity_id: OPP2 });
    }
    db.tables["insurer_response_revisions"]!.push({ ...db.tables["insurer_response_revisions"]![0]!, id: "37000000-0000-4000-8000-0000000000af", insurer_response_id: "34000000-0000-4000-8000-00000000000f", opportunity_id: OPP2 });
    db.tables["quote_comparisons"]!.push({ ...db.tables["quote_comparisons"]![0]!, id: "36000000-0000-4000-8000-00000000000f", opportunity_id: OPP2 });
    db.tables["quote_comparison_inputs"]!.push({ ...db.tables["quote_comparison_inputs"]![0]!, id: "3e000000-0000-4000-8000-00000000000f", comparison_id: "36000000-0000-4000-8000-00000000000f", insurer_response_id: "34000000-0000-4000-8000-00000000000f", response_revision_id: "37000000-0000-4000-8000-0000000000af" });

    const second = await post(`/opportunities/${OPP2}/instruction`, { ...INSTRUCTION, insurerResponseId: "34000000-0000-4000-8000-00000000000f" });
    expect(second.outcome).toBe("done");
    expect(second.placementId).not.toBe(first);

    expect((await read(first)).body.placement.title).toBe("Acme motor fleet placement — 2027");
    expect((await read(second.placementId)).body.placement.title).toBe("Acme property placement — 2027");
    expect(db.tables["work_items"]!.filter((w) => w["kind"] === "placement")).toHaveLength(2);
  });
});

describe("the title", () => {
  it("is the work's own name, never a module's", () => {
    expect(placementTitle("Acme motor fleet quotation — 2027")).toBe("Acme motor fleet placement — 2027");
    expect(placementTitle("Acme fleet")).toBe("Acme fleet — placement");
  });
});

/* =============================================================================================
 * 4B-4A — Work identity, cover check, client acceptance, readiness and prepared actions.
 * ============================================================================================= */

/** A second placement on another opportunity — with the *same* title unless told otherwise. */
async function secondPlacement(title = "Acme motor fleet quotation — 2027") {
  db.tables["opportunities"]!.push({ ...db.tables["opportunities"]![0]!, id: OPP2, title });
  for (const r of db.tables["insurer_responses"]!.slice(0, 2)) {
    db.tables["insurer_responses"]!.push({ ...r, id: `${String(r["id"]).slice(0, -1)}f`, opportunity_id: OPP2 });
  }
  db.tables["insurer_response_revisions"]!.push({ ...db.tables["insurer_response_revisions"]![0]!, id: "37000000-0000-4000-8000-0000000000af", insurer_response_id: "34000000-0000-4000-8000-00000000000f", opportunity_id: OPP2 });
  db.tables["quote_comparisons"]!.push({ ...db.tables["quote_comparisons"]![0]!, id: "36000000-0000-4000-8000-00000000000f", opportunity_id: OPP2 });
  db.tables["quote_comparison_inputs"]!.push({ ...db.tables["quote_comparison_inputs"]![0]!, id: "3e000000-0000-4000-8000-00000000000f", comparison_id: "36000000-0000-4000-8000-00000000000f", insurer_response_id: "34000000-0000-4000-8000-00000000000f", response_revision_id: "37000000-0000-4000-8000-0000000000af" });
  const res = await post(`/opportunities/${OPP2}/instruction`, { ...INSTRUCTION, insurerResponseId: "34000000-0000-4000-8000-00000000000f" });
  expect(res.outcome).toBe("done");
  return res.placementId as string;
}

const openWork = (placementId: string) =>
  db.tables["work_items"]!.filter((w) => w["source_id"] === placementId && w["task_status"] !== "done");

const CHANGED = CONFIRM({
  outcome: "confirmed_with_changes",
  changesNote: "Own damage excess raised to 7.5%, minimum KES 45,000.",
  termChanges: [{ termType: "excess", label: "Own damage", value: "7.5% min KES 45,000" }],
});

async function confirmedWithChanges() {
  const id = await placed();
  await submitted(id);
  expect((await act(id, CHANGED)).outcome).toBe("done");
  return id;
}

const ACCEPTANCE = (coverMatchId: string, over: Record<string, unknown> = {}) => ({
  action: "record_client_acceptance",
  coverMatchId,
  decision: "accept_all",
  source: "email",
  decidedAt: "2026-09-10T09:00:00.000Z",
  evidenceNote: "Client's finance director replied at 09:00 accepting the higher excess.",
  ...over,
});

describe("Work identity (4B-4A)", () => {
  it("keeps two placements with the same title as two separate Work items", async () => {
    const first = await placed();
    const second = await secondPlacement();
    expect((await read(first)).body.placement.title).toBe((await read(second)).body.placement.title);
    expect(openWork(first)).toHaveLength(1);
    expect(openWork(second)).toHaveLength(1);
    expect(openWork(first)[0]!["id"]).not.toBe(openWork(second)[0]!["id"]);
  });

  it("resolving one placement's blocker completes that item only", async () => {
    const first = await placed();
    const second = await secondPlacement();
    await act(first, REQUEST);
    expect(openWork(first).map((w) => w["reason_code"])).toEqual(["approval_required"]);
    expect(openWork(second).map((w) => w["reason_code"])).toEqual(["prepare_request"]);
  });

  it("a retried action reuses the open item and does not duplicate it", async () => {
    const id = await placed();
    await act(id, REQUEST);
    await act(id, REQUEST);
    await read(id);
    await read(id);
    const all = db.tables["work_items"]!.filter((w) => w["source_id"] === id);
    expect(all.filter((w) => w["reason_code"] === "approval_required")).toHaveLength(1);
    expect(all.filter((w) => w["reason_code"] === "prepare_request")).toHaveLength(1);
  });

  it("creates each next lifecycle item once, and completes the one before", async () => {
    const id = await placed();
    await submitted(id);
    const reasons = db.tables["work_items"]!.filter((w) => w["source_id"] === id).map((w) => `${w["reason_code"]}:${w["task_status"]}`);
    expect(reasons).toEqual([
      "prepare_request:done",
      "approval_required:done",
      "submission_proof_missing:done",
      "awaiting_insurer:with_party",
    ]);
  });

  it("explains itself: headline, reason, party, since, action, evidence and what comes after", async () => {
    const id = await placed();
    await submitted(id);
    const w = (await read(id)).body.work[0];
    expect(w).toMatchObject({
      reason: "awaiting_insurer",
      headline: "cover confirmation requested",
      taskStatus: "with_party",
      taskParty: "Jubilee",
      taskSince: "2026-09-08T11:02:00.000Z",
    });
    expect(w.why).toMatch(/has not answered/);
    expect(w.action).toMatch(/Record the insurer's answer/);
    expect(w.evidence).toMatch(/confirmation, decline or query/);
    expect(w.after).toMatch(/checked against what the client accepted/);
  });

  it("puts the approval with the named approver when asked", async () => {
    const id = await placed();
    await act(id, REQUEST);
    expect((await act(id, { action: "request_approval", approverUserId: AMINA.id }, "tok-otieno")).outcome).toBe("done");
    const w = openWork(id);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ reason_code: "approval_required", owner_id: AMINA.id });
  });

  it("refuses to hand an approval to someone who may not approve", async () => {
    const id = await placed();
    await act(id, REQUEST);
    const res = await act(id, { action: "request_approval", approverUserId: OTIENO.id });
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/may not approve placements/);
  });

  it("brings Work into line when a placement is opened", async () => {
    const id = await placed();
    for (const w of openWork(id)) w["task_status"] = "done";
    const { body } = await read(id);
    expect(body.work.map((w: { reason: string }) => w.reason)).toEqual(["prepare_request"]);
  });
});

describe("the cover check (4B-4A)", () => {
  it("compares field by field against the frozen basis and records who and when", async () => {
    const id = await confirmedWithChanges();
    const m = (await read(id)).body.coverMatch;
    expect(m).toMatchObject({ current: true, basisVersion: 1, materialDifferences: 1, comparedByName: null });
    const excess = m.items.find((i: { label: string }) => i.label === "Own damage");
    expect(excess).toMatchObject({ classification: "changed", acceptedValue: "5% min KES 30,000", confirmedValue: "7.5% min KES 45,000", material: true });
    expect(m.items.find((i: { field: string }) => i.field === "premium").classification).toBe("match");
    expect(db.tables["cover_match_results"]![0]).toMatchObject({ placement_insurer_response_id: db.tables["placement_insurer_responses"]![0]!["id"] });
  });

  it("finds a changed start date even on a confirmation 'as requested'", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM({ effectiveAt: "2026-09-15T00:00:00.000Z" }));
    const { body } = await read(id);
    expect(body.coverMatch.items.find((i: { field: string }) => i.field === "effective_at").classification).toBe("changed");
    expect(body.readiness.state).toBe("blocked");
  });

  it("finds an exclusion the insurer added and a condition it dropped", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM({
      outcome: "confirmed_with_changes",
      changesNote: "Riot and strike excluded; own damage excess not restated.",
      termChanges: [
        { termType: "exclusion", label: "Riot and strike", value: "Excluded" },
        { termType: "excess", label: "Own damage", value: null },
      ],
    }));
    const items = (await read(id)).body.coverMatch.items;
    expect(items.find((i: { label: string }) => i.label === "Riot and strike").classification).toBe("added_by_insurer");
    expect(items.find((i: { label: string }) => i.label === "Own damage").classification).toBe("missing_from_confirmation");
  });

  it("is stale when the insurer's answer changes, and re-runs", async () => {
    const id = await confirmedWithChanges();
    const firstMatch = (await read(id)).body.coverMatch.id;
    await act(id, CONFIRM());
    const m = (await read(id)).body.coverMatch;
    expect(m.id).not.toBe(firstMatch);
    expect(m).toMatchObject({ current: true, materialDifferences: 0 });
  });

  it("reports an older check as stale rather than current", async () => {
    const id = await confirmedWithChanges();
    const r = db.tables["placement_insurer_responses"]![0]!;
    db.tables["placement_insurer_responses"]!.push({ ...r, id: "f1000000-0000-4000-8000-000000000001" });
    r["superseded_at"] = iso;
    const m = (await read(id)).body.coverMatch;
    expect(m.current).toBe(false);
    expect(m.staleReason).toMatch(/insurer's answer has changed/);
    expect((await read(id)).body.readiness.reasons.map((x: { code: string }) => x.code)).toContain("cover_check_stale");
  });
});

describe("cover reality and client acceptance (4B-4A)", () => {
  it("shows cover in force on changed terms without saying the client accepted them", async () => {
    const id = await confirmedWithChanges();
    db.tables["placement_insurer_responses"]![0]!["effective_at"] = "2026-09-01T00:00:00.000Z";
    db.tables["placement_insurer_responses"]![0]!["expiry_at"] = "2027-09-30T23:59:59.000Z";
    const { body } = await read(id);
    expect(body.cover.state).toBe("active");
    expect(body.cover.line).toMatch(/on the insurer's changed terms/);
    expect(JSON.stringify(body)).not.toMatch(/client accepted the insurer's changed/i);
    expect(body.blockers.join(" ")).toMatch(/The cover is in force on the insurer's terms; the client has not agreed to them/);
    expect(body.changeAcceptance).toBeNull();
    expect(body.readiness.state).toBe("blocked");
    expect(body.work[0]).toMatchObject({ reason: "review_changed_terms", headline: "review changed insurer terms" });
    expect((await act(id, { action: "prepare_issuance" })).outcome).toBe("blocked");
  });

  it("accepting all: a new instruction revision, the original kept, basis version 2, re-checked, ready", async () => {
    const id = await confirmedWithChanges();
    const before = (await read(id)).body;
    expect((await act(id, ACCEPTANCE(before.coverMatch.id))).outcome).toBe("done");
    const { body } = await read(id);

    expect(body.instruction.id).not.toBe(before.instruction.id);
    expect(body.instructionHistory.map((i: { id: string }) => i.id)).toContain(before.instruction.id);
    expect(db.tables["client_instructions"]!.find((i) => i["id"] === body.instruction.id)!["revises_instruction_id"]).toBe(before.instruction.id);
    expect(body.basis).toMatchObject({ version: 2, origin: "client_accepted_changes" });
    expect(body.basis.terms.find((t: { label: string }) => t.label === "Own damage").value).toBe("7.5% min KES 45,000");
    expect(db.tables["placement_basis_versions"]).toHaveLength(2);
    expect(body.coverMatch).toMatchObject({ current: true, materialDifferences: 0, basisVersion: 2 });
    expect(body.readiness.state).toBe("ready");
    expect(body.work.map((w: { reason: string }) => w.reason)).toEqual(["issue_policy"]);
    expect(db.tables["client_change_acceptances"]![0]).toMatchObject({ decision: "accept_all", recorded_by: AMINA.id });
  });

  it("needs evidence of the client's decision", async () => {
    const id = await confirmedWithChanges();
    const m = (await read(id)).body.coverMatch.id;
    const res = await act(id, ACCEPTANCE(m, { evidenceNote: undefined }));
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/how the client's decision arrived/);
  });

  it("rejecting: cover stays visible, issuance blocked, a draft is prepared and not sent", async () => {
    const id = await confirmedWithChanges();
    const m = (await read(id)).body.coverMatch.id;
    expect((await act(id, ACCEPTANCE(m, { decision: "reject" }))).outcome).toBe("done");
    const { body } = await read(id);
    expect(body.cover.state).not.toBeNull();
    expect(body.basis.version).toBe(1);
    expect(body.readiness.state).toBe("blocked");
    expect(body.readiness.reasons.map((r: { code: string }) => r.code)).toContain("unaccepted_differences");
    expect(body.work[0].reason).toBe("resolve_rejected_changes");
    expect(body.changeAcceptance.followUpDraft).toMatch(/not sent/);
    expect(body.changeAcceptance.followUpDraft).toMatch(/do not accept the change to: Own damage/);
    expect(db.tables["placement_submissions"]).toHaveLength(1);
  });

  it("partial is never full: it needs every difference decided and changes nothing agreed", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM({
      outcome: "confirmed_with_changes",
      changesNote: "Excess raised and riot excluded.",
      termChanges: [
        { termType: "excess", label: "Own damage", value: "7.5% min KES 45,000" },
        { termType: "exclusion", label: "Riot and strike", value: "Excluded" },
      ],
    }));
    const m = (await read(id)).body.coverMatch;
    const [excess, riot] = m.items.filter((i: { material: boolean }) => i.material);

    const half = await act(id, ACCEPTANCE(m.id, { decision: "partial", items: [{ coverMatchItemId: excess.id, decision: "accepted" }] }));
    expect(half.outcome).toBe("blocked");
    expect(half.reason).toMatch(/Still undecided: Riot and strike/);

    const allYes = await act(id, ACCEPTANCE(m.id, { decision: "partial", items: [{ coverMatchItemId: excess.id, decision: "accepted" }, { coverMatchItemId: riot.id, decision: "accepted" }] }));
    expect(allYes.outcome).toBe("blocked");
    expect(allYes.reason).toMatch(/accepting all the changes, not as partial/);

    const ok = await act(id, ACCEPTANCE(m.id, { decision: "partial", items: [{ coverMatchItemId: excess.id, decision: "accepted" }, { coverMatchItemId: riot.id, decision: "clarify" }] }));
    expect(ok.outcome).toBe("done");
    const { body } = await read(id);
    expect(body.basis.version).toBe(1);
    expect(body.readiness.state).toBe("blocked");
    expect(body.work[0].reason).toBe("clarify_changes");
    expect(body.changeAcceptance.items).toEqual([
      { label: "Own damage", decision: "accepted" },
      { label: "Riot and strike", decision: "clarify" },
    ]);
  });

  it("refuses a decision against an out-of-date check", async () => {
    const id = await confirmedWithChanges();
    const old = (await read(id)).body.coverMatch.id;
    await act(id, CHANGED);
    const res = await act(id, ACCEPTANCE(old));
    expect(res.outcome).toBe("blocked");
    expect(res.reason).toMatch(/not the current cover check/);
  });
});

describe("issuance readiness (4B-4A)", () => {
  it("is blocked with structured reasons before anything is sent", async () => {
    const id = await placed();
    const r = (await read(id)).body.readiness;
    expect(r.state).toBe("blocked");
    expect(r.reasons.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(["not_submitted", "not_confirmed"]));
  });

  it("is blocked after cancellation", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM());
    await act(id, { action: "record_cancellation", cancelledAt: "2026-09-20T00:00:00.000Z", reason: "Client withdrew.", evidenceNote: "Signed withdrawal letter received 19 September." });
    const { body } = await read(id);
    expect(body.readiness.reasons.map((x: { code: string }) => x.code)).toContain("cancelled");
    expect(body.work).toEqual([]);
  });

  it("is blocked for someone who may not prepare issuance", async () => {
    const id = await placed();
    await submitted(id);
    await act(id, CONFIRM());
    const r = (await read(id, "tok-bahati")).body.readiness;
    expect(r.reasons.map((x: { code: string }) => x.code)).toEqual(["not_permitted"]);
  });

  it("records payment as a deferred check, not a hard-coded rule", async () => {
    const id = await placed();
    const r = (await read(id)).body.readiness;
    expect(r.deferredChecks).toHaveLength(1);
    expect(r.reasons.map((x: { code: string }) => x.code)).not.toContain("payment");
  });
});

/* ---- Prepared actions ------------------------------------------------------------------------ */

const prepare = (placementId: string, body: Record<string, unknown>, token = "tok-amina") =>
  post(`/placements/${placementId}/prepare`, body, token);
const confirm = (id: string, token = "tok-amina") => post(`/prepared-actions/${id}/confirm`, {}, token);

describe("prepared actions (4B-4A)", () => {
  it("'The client chose Jubilee' asks one question when facts are missing, and never invents them", async () => {
    const res = await post(`/opportunities/${OPP}/prepare`, { actionType: "record_instruction", insurerName: "Jubilee" });
    expect(res.state).toBe("clarify");
    expect(res.missing).toEqual(expect.arrayContaining(["source", "evidence", "instructedAt", "requestedEffectiveAt"]));
    expect(db.tables["prepared_actions"]).toHaveLength(0);
    expect(db.tables["client_instructions"]).toHaveLength(0);
  });

  it("offers the quotes the client was shown when the insurer is not one of them", async () => {
    const res = await post(`/opportunities/${OPP}/prepare`, { actionType: "record_instruction", insurerName: "Britam" });
    expect(res.state).toBe("clarify");
    expect(res.options.map((o: { label: string }) => o.label).sort()).toEqual(["CIC", "Jubilee"]);
  });

  it("'The client chose Jubilee', with the facts, prepares — and only confirmation records it", async () => {
    const res = await post(`/opportunities/${OPP}/prepare`, {
      actionType: "record_instruction",
      insurerName: "jubilee",
      params: { source: "email", evidenceNote: INSTRUCTION.evidenceNote, instructedAt: INSTRUCTION.instructedAt, requestedEffectiveAt: INSTRUCTION.requestedEffectiveAt },
    });
    expect(res.state).toBe("prepared");
    expect(res.action).toMatchObject({ actionType: "record_instruction", state: "prepared", permitted: true, requiresConfirmation: true, blockers: [] });
    expect(res.action.summary).toBe("Record that the client chose Jubilee");
    expect(db.tables["client_instructions"]).toHaveLength(0);
    expect(db.tables["prepared_actions"]![0]).toMatchObject({ prepared_by: AMINA.id });
    expect(String(db.tables["prepared_actions"]![0]!["fingerprint"])).toHaveLength(64);

    const done = await confirm(res.action.id);
    expect(done.outcome).toBe("done");
    expect(done.action.state).toBe("executed");
    expect(done.action.receipt.message).toMatch(/Record that the client chose Jubilee — done/);
    expect(db.tables["client_instructions"]).toHaveLength(1);
    expect(db.tables["placements"]).toHaveLength(1);
    expect(db.tables["audit_log"]!.some((a) => a["action"] === "prepared_action.executed")).toBe(true);
  });

  it("confirming twice executes once", async () => {
    const id = await placed();
    const p = await prepare(id, { actionType: "prepare_request" });
    expect((await confirm(p.action.id)).outcome).toBe("done");
    expect((await confirm(p.action.id)).outcome).toBe("already");
    expect(db.tables["placement_requests"]).toHaveLength(1);
  });

  it("preparing the same thing twice returns the same prepared action", async () => {
    const id = await placed();
    const a = await prepare(id, { actionType: "prepare_request" });
    const b = await prepare(id, { actionType: "prepare_request" });
    expect(a.action.id).toBe(b.action.id);
    expect(db.tables["prepared_actions"]).toHaveLength(1);
  });

  it("refuses as stale when the placement changed before confirmation", async () => {
    const id = await placed();
    const p = await prepare(id, { actionType: "prepare_request" });
    await act(id, REQUEST);
    const res = await confirm(p.action.id);
    expect(res.outcome).toBe("refused");
    expect(res.reason).toMatch(/changed after this was prepared/);
    expect(res.action.state).toBe("stale");
    expect(db.tables["placement_requests"]).toHaveLength(1);
  });

  it("refuses an expired action", async () => {
    const id = await placed();
    const p = await prepare(id, { actionType: "prepare_request" });
    db.tables["prepared_actions"]![0]!["expires_at"] = "2020-01-01T00:00:00.000Z";
    const res = await confirm(p.action.id);
    expect(res.outcome).toBe("refused");
    expect(res.action.state).toBe("expired");
  });

  it("'Ask Mary to approve this' resolves the name exactly, or asks", async () => {
    const id = await placed();
    await act(id, REQUEST);
    const unknown = await prepare(id, { actionType: "request_approval", approverName: "Mary" });
    expect(unknown.state).toBe("clarify");
    expect(unknown.options.map((o: { label: string }) => o.label)).toEqual(["Amina"]);
    const ok = await prepare(id, { actionType: "request_approval", approverName: "amina" });
    expect(ok.state).toBe("prepared");
    expect((await confirm(ok.action.id)).outcome).toBe("done");
    expect(openWork(id)[0]).toMatchObject({ reason_code: "approval_required", owner_id: AMINA.id });
  });

  it("an approval prepared for someone without the permission shows it, and is refused on confirmation", async () => {
    const id = await placed();
    await act(id, REQUEST);
    const p = await prepare(id, { actionType: "approve_request" }, "tok-otieno");
    expect(p.action.permitted).toBe(false);
    expect(p.action.blockers.join(" ")).toMatch(/You may not do this/);
    const res = await confirm(p.action.id, "tok-otieno");
    expect(res.outcome).toBe("refused");
    expect(db.tables["placement_request_approvals"]).toHaveLength(0);
  });

  it("'Record that I sent it outside ASAP' needs the recipient, the time and evidence", async () => {
    const id = await placed();
    await approved(id);
    const missing = await prepare(id, { actionType: "record_submission" });
    expect(missing.state).toBe("clarify");
    expect(missing.missing).toEqual(["recipient", "sentAt", "evidence"]);
    const p = await prepare(id, { actionType: "record_submission", params: { recipient: "underwriting@jubilee.test", sentAt: "2026-09-08T11:02:00.000Z", evidenceNote: "Sent from my mailbox at 11:02 to the Jubilee desk." } });
    expect(p.action.changes.join(" ")).toMatch(/by a person, outside ASAP/);
    expect((await confirm(p.action.id)).outcome).toBe("done");
    expect((await read(id)).body.work[0]).toMatchObject({ taskStatus: "with_party", taskParty: "Jubilee" });
  });

  it("'Jubilee confirmed cover' records the answer and runs the check; it assumes no client agreement", async () => {
    const id = await placed();
    await submitted(id);
    const p = await prepare(id, { actionType: "record_insurer_response", insurerName: "Jubilee", params: { receivedAt: "2026-09-09T14:10:00.000Z", effectiveAt: "2026-10-01T00:00:00.000Z", expiryAt: "2027-09-30T23:59:59.000Z", evidenceNote: "Cover note received by email at 14:10." } });
    expect(p.action.changes.join(" ")).toMatch(/Nothing about the client's agreement is assumed/);
    expect((await confirm(p.action.id)).outcome).toBe("done");
    expect((await read(id)).body.coverMatch.current).toBe(true);
  });

  it("refuses an action about a different insurer than the placement's", async () => {
    const id = await placed();
    await submitted(id);
    const p = await prepare(id, { actionType: "record_insurer_response", insurerName: "CIC", params: {} });
    expect(p.state).toBe("refused");
    expect(p.reason).toMatch(/with Jubilee, not CIC/);
  });

  it("'The client accepted Jubilee's changes' prepares the acceptance with its consequences", async () => {
    const id = await confirmedWithChanges();
    const p = await prepare(id, { actionType: "record_client_acceptance", params: { source: "email", decidedAt: "2026-09-10T09:00:00.000Z", evidenceNote: "Client replied accepting the higher excess at 09:00." } });
    expect(p.action.changes.join(" ")).toMatch(/version 2/);
    expect((await confirm(p.action.id)).outcome).toBe("done");
    expect((await read(id)).body.readiness.state).toBe("ready");
  });

  it("'Prepare policy issuance' lists the blockers, and confirming changes nothing while blocked", async () => {
    const id = await confirmedWithChanges();
    const p = await prepare(id, { actionType: "prepare_issuance" });
    expect(p.action.blockers.join(" ")).toMatch(/client has not accepted them/);
    const res = await confirm(p.action.id);
    expect(res.outcome).toBe("refused");
    expect(db.tables["policies"]).toHaveLength(0);
  });

  it("is invisible to another brokerage", async () => {
    const id = await placed();
    const p = await prepare(id, { actionType: "prepare_request" });
    db.tables["prepared_actions"]![0]!["organization_id"] = OTHER_ORG;
    const res = await build().request(`/prepared-actions/${p.action.id}/confirm`, { method: "POST", headers: asUser() });
    expect(res.status).toBe(404);
    expect(db.tables["placement_requests"]).toHaveLength(0);
  });

  it("refuses the unauthenticated", async () => {
    expect((await build().request(`/prepared-actions/${CMP}/confirm`, { method: "POST" })).status).toBe(401);
    expect((await build().request(`/placements/${CMP}/prepare`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("can be discarded, and a discarded action cannot be confirmed", async () => {
    const id = await placed();
    const p = await prepare(id, { actionType: "prepare_request" });
    expect((await post(`/prepared-actions/${p.action.id}/discard`, {})).outcome).toBe("done");
    const res = await confirm(p.action.id);
    expect(res.outcome).toBe("refused");
    expect(db.tables["placement_requests"]).toHaveLength(0);
  });

  it("appears on the placement, so a refresh does not lose it", async () => {
    const id = await placed();
    const p = await prepare(id, { actionType: "prepare_request" });
    const { body } = await read(id);
    expect(body.preparedActions.map((a: { id: string }) => a.id)).toEqual([p.action.id]);
  });
});

describe("Work on the board (4B-4A)", () => {
  it("opens a placement's Work item on the placement itself, with its reason", async () => {
    const id = await placed();
    /* The columns every real work_items row has, which the fake engine stub does not write. */
    const full = { policy_period_id: null, insurer_id: null, class_of_business: null, owner_id: null, task_next_check: null, cover_status: null, cover_inception_at: null, money_status: null, reason: null, exception: null, updated_at: iso, completed_at: null };
    for (const w of db.tables["work_items"]!) for (const [k, v] of Object.entries(full)) if (w[k] === undefined) w[k] = v;
    const res = await build().request(`/work?view=needs`, { headers: asUser() });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const row = body.items.find((r: { item: { source_id?: string } }) => r.item.source_id === id);
    expect(row).toBeDefined();
    expect(row.links.work).toBe(`/placements/${id}`);
    expect(row.reason).toMatch(/nothing has been prepared for the insurer yet/);
    expect(row.item.required_action).toMatch(/Prepare the placement request/);
  });
});
