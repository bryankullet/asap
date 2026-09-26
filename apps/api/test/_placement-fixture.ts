/**
 * The placement fixture: one brokerage, three insurers' quotes, a comparison the client was
 * shown, and the database's triggers and Work functions stood in for. Shared by the placement
 * API tests and the Ask evaluation, so both meet the same records.
 */
import type { FakeDb } from "./_fake-supabase.js";

export const ORG = "10000000-0000-4000-8000-00000000000a";
export const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
export const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
export const OTIENO = { id: "a0000000-0000-4000-8000-000000000003", email: "placement@acme-brokers.test" };
export const BAHATI = { id: "a0000000-0000-4000-8000-000000000002", email: "readonly@acme-brokers.test" };
export const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
export const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";
export const PLACEMENT_ROLE = "30000000-0000-4000-8000-000000000003";
export const MANAGER_ROLE = "30000000-0000-4000-8000-000000000004";

export const CLIENT = "20000000-0000-4000-8000-00000000000a";
export const WORK = "26000000-0000-4000-8000-00000000000a";
export const OPP = "30000000-0000-4000-8000-00000000000a";
export const OPP2 = "30000000-0000-4000-8000-00000000000c";
export const INS_A = "21000000-0000-4000-8000-00000000000a";
export const INS_B = "21000000-0000-4000-8000-00000000000b";
export const INS_C = "21000000-0000-4000-8000-00000000000c";
export const APPROACH_A = "31000000-0000-4000-8000-00000000000a";
export const APPROACH_B = "31000000-0000-4000-8000-00000000000b";
export const APPROACH_C = "31000000-0000-4000-8000-00000000000c";
export const RESP_A = "34000000-0000-4000-8000-00000000000a";
export const RESP_B = "34000000-0000-4000-8000-00000000000b";
export const RESP_C = "34000000-0000-4000-8000-00000000000c";
export const REV_A = "37000000-0000-4000-8000-00000000000a";
export const REV_B = "37000000-0000-4000-8000-00000000000b";
export const REV_C = "37000000-0000-4000-8000-00000000000c";
export const TERM_A = "35000000-0000-4000-8000-00000000000a";
export const TERM_REV_A = "38000000-0000-4000-8000-00000000000a";
export const CMP = "36000000-0000-4000-8000-00000000000a";
export const EMAIL = "3d000000-0000-4000-8000-00000000000a";
export const DOC = "3a000000-0000-4000-8000-00000000000a";
export const iso = "2026-09-05T09:00:00.000Z";
export const LATER = "2027-06-30";

export const PERMS: Record<string, [string, string][]> = {
  [ADMIN_ROLE]: [["placement", "create"], ["placement", "edit"], ["placement", "approve"], ["placement", "send_external"], ["space", "create"]],
  [MANAGER_ROLE]: [["placement", "approve"]],
  [PLACEMENT_ROLE]: [["placement", "create"], ["placement", "edit"], ["placement", "send_external"], ["space", "create"]],
  [READONLY_ROLE]: [["placement", "view"]],
};

export function membership(userId: string, roleId: string, org = ORG) {
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

export function response(id: string, approachId: string, premium: string, validUntil = LATER) {
  return {
    id, organization_id: ORG, opportunity_id: OPP, opportunity_insurer_id: approachId,
    outcome: "quoted", received_at: iso, source_note: "Quotation letter.", source_document_id: null,
    source_email_message_id: null, premium_amount: premium, premium_currency: "KES",
    valid_until: validUntil, decline_reason: null, recorded_by: AMINA.id, recorded_at: iso,
  };
}

export function revisionOf(id: string, r: Record<string, unknown>, revision = 1) {
  return {
    id, organization_id: ORG, insurer_response_id: r["id"], opportunity_id: OPP, revision,
    outcome: r["outcome"], received_at: r["received_at"], premium_amount: r["premium_amount"],
    premium_currency: r["premium_currency"], valid_until: r["valid_until"], decline_reason: null,
    source_document_id: null, source_email_message_id: null, source_note: r["source_note"],
    sha256: "0".repeat(64), created_at: iso,
  };
}

export function makeDb(): FakeDb {
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
      placement_client_conditions: [],
      client_condition_resolutions: [],
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
      client_condition_resolutions: { placement_insurer_response_id: null, reason: null, evidence_email_message_id: null, evidence_document_id: null, evidence_note: null, new_client_instruction_id: null, recorded_at: iso },
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
      placement_client_conditions: [["placement_id", "position"]],
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

