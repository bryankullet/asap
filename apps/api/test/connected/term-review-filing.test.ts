/**
 * Reviewing a quotation's terms one by one, and filing a document, connected (D-138). Against the
 * real `document_term_proposals` constraints (0064): a term is confirmed against its document before
 * the quotation is linked to any insurer answer, a rejection carries no term, and a read-only member
 * can do neither. Filing sets the kind and the client, with an audit row, and refuses another
 * brokerage's client.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, buildApp, caller, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-term-review')`;
  app = buildApp(API_KEY);
});
afterAll(async () => {
  await sql.end();
});

async function quotation() {
  const [doc] =
    await sql`insert into documents (organization_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, extraction_state, uploaded_by)
    values (${ORG_A}, 'quote_slip', '02_UX_TEST_Quotation_APA.pdf', 'application/pdf', 10, ${`${ORG_A}/${randomUUID()}.pdf`}, ${randomUUID().replace(/-/g, "").padEnd(64, "3")}, 'extracted', ${AMINA.id}) returning id`;
  const id = doc!["id"] as string;
  const terms = [
    ["other", "Geographic scope", "Kenya and Uganda; other territories by written agreement."],
    ["exclusion", "Key exclusions", "Wear and tear; mechanical or electrical breakdown."],
    [
      "other",
      "Status",
      "Indicative terms only - not accepted, bound, or issued. No cover is in force.",
    ],
  ];
  const ids: string[] = [];
  for (const [i, [type, label, value]] of terms.entries()) {
    const [t] =
      await sql`insert into document_term_proposals (organization_id, document_id, ordinal, term_type, label, proposed_value, page_number, condition, method)
      values (${ORG_A}, ${id}, ${i}, ${type!}, ${label!}, ${value!}, 1, 'known', 'labelled_line') returning id`;
    ids.push(t!["id"] as string);
  }
  return { id, ids };
}

describe("term review and filing (D-138)", () => {
  it("confirms, corrects and rejects terms one at a time before any insurer answer is linked", async () => {
    const q = await quotation();
    const accept = await call(AMINA, "POST", `/documents/${q.id}/quotation/actions`, {
      action: "accept_proposal",
      proposalId: q.ids[0],
    });
    expect(accept.status).toBe(200);
    expect(accept.body.outcome).toBe("done");
    const correct = await call(AMINA, "POST", `/documents/${q.id}/quotation/actions`, {
      action: "correct_proposal",
      proposalId: q.ids[1],
      correctedValue: "Wear and tear; mechanical breakdown.",
    });
    expect(correct.body.outcome).toBe("done");
    const reject = await call(AMINA, "POST", `/documents/${q.id}/quotation/actions`, {
      action: "reject_proposal",
      proposalId: q.ids[2],
    });
    expect(reject.body.outcome).toBe("done");
    const rows =
      await sql`select label, state, corrected_value, quote_term_id, reviewed_by from document_term_proposals where document_id = ${q.id} order by ordinal`;
    expect(
      rows.map((r) => [
        r["label"],
        r["state"],
        r["corrected_value"],
        r["quote_term_id"],
        r["reviewed_by"],
      ]),
    ).toEqual([
      ["Geographic scope", "accepted", null, null, AMINA.id],
      ["Key exclusions", "corrected", "Wear and tear; mechanical breakdown.", null, AMINA.id],
      ["Status", "rejected", null, null, AMINA.id],
    ]);
    // The reading the comparison is built from says the same, after a fresh read.
    const reading = await call(AMINA, "GET", `/documents/${q.id}/quotation`);
    expect(reading.body.proposals.map((p: { state: string }) => p.state)).toEqual([
      "accepted",
      "corrected",
      "rejected",
    ]);
    const audits =
      await sql`select action from audit_log where object_id = ${q.id} and action like 'document.term_%' order by occurred_at`;
    expect(audits.map((a) => a["action"])).toEqual([
      "document.term_accepted",
      "document.term_corrected",
      "document.term_rejected",
    ]);
    expect(
      (
        await sql`select count(*)::int as n from quote_terms where evidence_document_id = ${q.id}`
      )[0]!["n"],
    ).toBe(0);
  });

  it("a read-only member cannot decide a term", async () => {
    const q = await quotation();
    const r = await call(READER, "POST", `/documents/${q.id}/quotation/actions`, {
      action: "accept_proposal",
      proposalId: q.ids[0],
    });
    expect(r.body.outcome).toBe("blocked");
    expect(
      (await sql`select state from document_term_proposals where id = ${q.ids[0]!}`)[0]!["state"],
    ).toBe("proposed");
  });

  it("files a document under a client with a kind, audited; another brokerage's client is refused", async () => {
    const q = await quotation();
    const r = await call(AMINA, "POST", `/documents/${q.id}/classify`, {
      kind: "quote_slip",
      clientId: ACME,
    });
    expect(r.status).toBe(200);
    expect(r.body.document).toMatchObject({ kind: "quote_slip", clientId: ACME });
    const [a] =
      await sql`select previous_state, new_state from audit_log where object_id = ${q.id} and action = 'document.filed_to'`;
    expect(a!["new_state"]).toMatchObject({ clientId: ACME, kind: "quote_slip" });
    const other = await call(AMINA, "POST", `/documents/${q.id}/classify`, {
      clientId: "70000000-0000-4000-8000-00000000000c",
    });
    expect(other.status).toBe(404);
    const reader = await call(READER, "POST", `/documents/${q.id}/classify`, { kind: "invoice" });
    expect(reader.status).toBe(403);
    expect((await sql`select kind, client_id from documents where id = ${q.id}`)[0]).toMatchObject({
      kind: "quote_slip",
      client_id: ACME,
    });
  });
});
