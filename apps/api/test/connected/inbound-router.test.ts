/**
 * The inbound router (D-144), connected: real API, real database, the gateway's deterministic
 * provider scripted per email. A pasted email and an uploaded .eml are recorded exactly like a
 * synced message; each insurer's reply is filed to the one quotation waiting for it; the run asks a
 * person to record what arrived before chasing; anything unsure is one Unsorted Work item that a
 * person settles. Routing records no fact and sends nothing.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeScript } from "../../src/ai/providers/fake.js";
import type { createApp } from "../../src/app.js";
import { AMINA, buildApp, caller, CIC, JUBILEE, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
const TAG = randomUUID().slice(0, 6).toUpperCase();
const JUB_UW = `uw-${TAG.toLowerCase()}@jubilee.test`;
const sure = (kind: string, confidence: number) => ({ text: JSON.stringify({ kind, confidence, reason: "The sender answers a quotation request." }), toolCalls: [], stop: "end" as const });
const script: FakeScript = [
  { match: new RegExp(`JUBQ-${TAG}`), reply: sure("insurer_quote", 0.96) },
  { match: new RegExp(`CICQ-${TAG}`), reply: sure("insurer_quote", 0.95) },
  { match: new RegExp(`UNSURE-${TAG}`), reply: sure("insurer_quote", 0.6) },
  { match: new RegExp(`STRANGER-${TAG}`), reply: sure("claim_notice", 0.97) },
];
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const started = new Date().toISOString();
let opportunityId = "";
let runId = "";
let subject = "";

async function pump(...ids: string[]) {
  for (let round = 0; round < 6; round++) {
    const watch = [...ids, opportunityId, runId].filter(Boolean);
    const evs = await sql`select id from events where organization_id = ${ORG_A} and processed_at is null and occurred_at >= ${started}
      and (entity_id = any(${watch}::uuid[]) or payload->>'opportunityId' = ${opportunityId}) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      const res = await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
      expect(res.status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}
const work = async () => (await sql`select w.task_status, w.task_party, w.required_action, w.reason from work_items w join opportunities o on o.work_item_id = w.id where o.id = ${opportunityId}`)[0]!;
const classification = async (messageId: string) => (await sql`select kind, confidence, source, state, routed_run_id, routed_by, work_item_id, candidates from inbound_classifications where email_message_id = ${messageId}`)[0];
const paste = async (body: Record<string, unknown>) => {
  const r = await call(AMINA, "POST", "/inbound/messages", body);
  expect(r.status).toBeLessThan(300);
  await pump(r.body.emailMessageId);
  return r.body as { emailMessageId: string; attachments: { filename: string; outcome: string; documentId: string | null }[] };
};

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-inbound')`;
  app = buildApp(API_KEY, script);
});
afterAll(async () => {
  await sql.end();
});

describe("the inbound router", () => {
  it("a quotation reaches its insurers: requests approved and delivered by a person", async () => {
    // A client of its own, so this quotation's request subject is the only one like it.
    const [c] = await sql`insert into clients (organization_id, name, kind, source) values (${ORG_A}, ${`Inbound Hauliers ${TAG} Ltd`}, 'corporate', 'manual') returning id`;
    const created = await call(AMINA, "POST", "/opportunities", { clientId: c!["id"], title: `Inbound fleet ${TAG}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
    opportunityId = created.body.opportunityId;
    await pump();
    for (const insurerId of [JUBILEE, CIC]) await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
    await pump();
    runId = (await sql`select id from workflow_runs where workflow = 'quotation' and subject_id = ${opportunityId}`)[0]!["id"] as string;
    const [a] = await sql`select id, bundle_sha256 from workflow_approvals where run_id = ${runId}`;
    await call(AMINA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] });
    const o = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    for (const i of o.insurers) {
      const address = i.insurerId === JUBILEE ? JUB_UW : "quotes@cic.test";
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_delivery", quoteRequestId: i.request.id, method: "own_email", reference: `Emailed ${address}` })).body.outcome).toBe("done");
    }
    subject = o.insurers[0].request.subject;
    await pump();
    expect((await sql`select current_step from workflow_runs where id = ${runId}`)[0]!["current_step"]).toBe("await_terms");
  });

  it("Jubilee's reply, pasted, is filed to the quotation by itself; the run asks a person to record it", async () => {
    const body = { from: JUB_UW, subject: `RE: ${subject}`, body: `Dear broker,\n\nPlease find our quotation JUBQ-${TAG}: premium KES 5,310,000.\n\nRegards, Jubilee underwriting` };
    const { emailMessageId: id } = await paste(body);
    expect(await classification(id)).toMatchObject({ kind: "insurer_quote", source: "model", state: "routed", routed_run_id: runId, routed_by: "auto" });
    const w = await work();
    expect(w["task_status"]).toBe("needs_you");
    expect(String(w["required_action"])).toMatch(/^Confirm Jubilee.*'s reply as ASAP read it — KES 5,310,000 — or correct it$/);
    expect(String(w["reason"])).toMatch(/Read from the email's own words: “.*premium KES 5,310,000.*”\. Nothing counts until you confirm it\./);
    expect((await sql`select count(*)::int as n from insurer_responses r join opportunity_insurers oi on oi.id = r.opportunity_insurer_id where oi.opportunity_id = ${opportunityId}`)[0]!["n"]).toBe(0);
    // The same email pasted again is the same email: one message, one proposal.
    const again = await call(AMINA, "POST", "/inbound/messages", body);
    expect(again.body).toMatchObject({ outcome: "already", emailMessageId: id });
    expect((await sql`select count(*)::int as n from inbound_classifications where email_message_id = ${id}`)[0]!["n"]).toBe(1);
  });

  it("CIC's reply, uploaded as an .eml with an attachment, is filed too; recording Jubilee's brings CIC's forward", async () => {
    const q = (s: string) => Buffer.from(s, "utf8").toString("base64");
    const eml = [
      "From: CIC Underwriting <quotes@cic.test>",
      "To: broker@acme-brokers.test",
      `Subject: =?UTF-8?B?${q(`RE: ${subject}`)}?=`,
      "Date: Mon, 05 Oct 2026 09:12:00 +0300",
      `Message-ID: <cic-${TAG}@cic.test>`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      `Our quotation CICQ-${TAG} is attached: premium KES 5,620,000 =`,
      "for twelve months.",
      "--b1",
      'Content-Type: application/pdf; name="CIC-quote.pdf"',
      'Content-Disposition: attachment; filename="CIC-quote.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      q(`%PDF-1.4 quote ${TAG}`),
      "--b1--",
      "",
    ].join("\r\n");
    const r = await paste({ eml });
    const [m] = await sql`select from_address, subject, body_text, provider_message_id from email_messages where id = ${r.emailMessageId}`;
    expect(m).toMatchObject({ from_address: "quotes@cic.test", provider_message_id: `cic-${TAG}@cic.test`, subject: `RE: ${subject}` });
    expect(String(m!["body_text"])).toMatch(/premium KES 5,620,000 for twelve months/);
    // Kept as a document, through the upload path (D-153).
    expect(r.attachments).toMatchObject([{ filename: "CIC-quote.pdf", outcome: "filed" }]);
    const [doc] = await sql`select extraction_state, mime_type, byte_size from documents where id = ${r.attachments[0]!.documentId}`;
    expect(doc).toMatchObject({ extraction_state: "queued", mime_type: "application/pdf" });
    expect((await sql`select count(*)::int as n from events where event_type = 'document.received' and entity_id = ${r.attachments[0]!.documentId}`)[0]!["n"]).toBe(1);
    expect(await classification(r.emailMessageId)).toMatchObject({ state: "routed", routed_run_id: runId, routed_by: "auto" });
    expect(String((await work())["required_action"])).toMatch(/Jubilee/);

    const o = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const jub = o.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE);
    await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_response", opportunityInsurerId: jub.id, outcome: "quoted", premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "Jubilee's quotation, filed by ASAP." });
    await pump();
    expect(String((await work())["required_action"])).toMatch(/^Confirm CIC.*'s reply as ASAP read it — KES 5,620,000 — or correct it$/);
  });

  it("an email ASAP cannot place is one Unsorted Work item; a person files it, and the item is done", async () => {
    const { emailMessageId: id } = await paste({ from: "someone@unknown-agency.test", subject: "Fleet question", body: "Hello, can we talk about our vans next week?" });
    const c = await classification(id);
    expect(c).toMatchObject({ source: "none", state: "unsorted" });
    const [w] = await sql`select kind, task_status, required_action, reason from work_items where id = ${c!["work_item_id"]}`;
    expect(w).toMatchObject({ kind: "inbound", task_status: "needs_you", required_action: "Sort the email from someone@unknown-agency.test" });
    expect(String(w!["reason"])).toMatch(/ASAP could not tell what this email is/);
    // It is on Work like any other item a person owns, and Work still reads.
    const listed = await call(AMINA, "GET", "/work?view=needs&limit=200");
    expect(listed.status).toBe(200);
    expect((listed.body.items as { item: { id: string } }[]).some((i) => i.item.id === c!["work_item_id"])).toBe(true);
    const decided = await call(AMINA, "POST", `/inbound/messages/${id}/decision`, { decision: "route", runId });
    expect(decided.body).toMatchObject({ outcome: "done", state: "routed" });
    expect(await classification(id)).toMatchObject({ state: "routed", routed_by: "person", routed_run_id: runId });
    expect((await sql`select task_status from work_items where id = ${c!["work_item_id"]}`)[0]!["task_status"]).toBe("done");
    expect((await call(AMINA, "POST", `/inbound/messages/${id}/decision`, { decision: "dismiss", reason: "Changed my mind" })).body).toMatchObject({ outcome: "already" });
  });

  it("an email the model is unsure of is never routed by itself, even with one candidate", async () => {
    const { emailMessageId: id } = await paste({ from: JUB_UW, subject: `RE: ${subject}`, body: `About UNSURE-${TAG}: we may revert next week.` });
    const c = await classification(id);
    expect(c).toMatchObject({ state: "unsorted", source: "model" });
    expect(Number(c!["confidence"])).toBeCloseTo(0.6);
    expect((c!["candidates"] as { runId: string }[]).map((x) => x.runId)).toEqual([runId]);
    const [w] = await sql`select reason from work_items where id = ${c!["work_item_id"]}`;
    expect(String(w!["reason"])).toMatch(/60% sure what this email is — below the 90% this brokerage requires/);
  });

  it("the rule moves the bar: at 0.5, the same kind of email routes by itself", async () => {
    expect((await call(AMINA, "PUT", "/rules", { key: "inbound.auto_route_confidence", value: { threshold: 0.5 }, source: "Routing evaluation, Oct 2026", verifiedAt: "2026-10-05" })).status).toBeLessThan(300);
    const { emailMessageId: id } = await paste({ from: JUB_UW, subject: `RE: ${subject}`, body: `Second note UNSURE-${TAG}: revised wording to follow.` });
    expect(await classification(id)).toMatchObject({ state: "routed", routed_by: "auto", routed_run_id: runId });
    expect((await call(AMINA, "PUT", "/rules", { key: "inbound.auto_route_confidence", value: { threshold: 0.9 }, source: "ASAP default restored", verifiedAt: "2026-10-05" })).status).toBeLessThan(300);
  });

  it("a claim notice ASAP cannot open by itself stays Unsorted, and says why (D-151)", async () => {
    const { emailMessageId: id } = await paste({ from: `driver-${TAG.toLowerCase()}@gmail.com`, subject: "Accident", body: `My car was hit yesterday at Kenol. STRANGER-${TAG}` });
    const c = await classification(id);
    expect(c).toMatchObject({ kind: "claim_notice", state: "unsorted" });
    const [w] = await sql`select required_action, reason from work_items where id = ${c!["work_item_id"]}`;
    expect(w!["required_action"]).toBe("Open the claim if it is one");
    expect(String(w!["reason"])).toMatch(/ASAP did not open it: the sender is not a recorded client contact\./);
    expect((await sql`select count(*)::int as n from claims where incident_summary like ${`%STRANGER-${TAG}%`}`)[0]!["n"]).toBe(0);
  });
});
