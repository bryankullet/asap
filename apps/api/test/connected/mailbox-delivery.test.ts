/**
 * Approved messages leave through the mailbox boundary (D-145), connected: real API, real database,
 * a fake mailbox adapter that counts what it is asked to send. In the second brokerage, so no other
 * test sees a connected mailbox.
 *
 *  - no verified address → a person delivers it, as before; nothing is sent;
 *  - a verified address recorded by a person → the approved message is sent once, the provider's id
 *    is the evidence, and the quotation moves on;
 *  - approving twice, or asking to send again → still sent once;
 *  - a body changed after approval → refused, nothing sent.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { encryptToken } from "../../src/mailbox/crypto.js";
import type { MailboxProvider, OutgoingMessage } from "../../src/mailbox/types.js";
import { BETA, buildApp, caller, newApiKey, ORG_B, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
const KEY = "a-connected-test-encryption-key-32-chars-long";
const TAG = randomUUID().slice(0, 6);
const sent: OutgoingMessage[] = [];
const fakeMailbox = {
  id: "gmail",
  list: async () => ({ messages: [], cursor: null, moreWaiting: false, checkpointExpired: false }),
  fetchAttachment: async () => null,
  send: async ({ message }: { message: OutgoingMessage }) => {
    sent.push(message);
    return { outcome: "sent" as const, providerMessageId: `gm-${sent.length}-${TAG}`, providerThreadId: null, acceptedAt: new Date().toISOString() };
  },
  refresh: async () => ({ accessToken: "fresh", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
  revoke: async () => {},
} as unknown as MailboxProvider;

let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const started = new Date().toISOString();
let clientId = "";
let insurerId = "";

async function pump(...ids: string[]) {
  for (let round = 0; round < 6; round++) {
    const runIds = (await sql`select id from workflow_runs where subject_id = any(${ids}::uuid[])`).map((r) => r["id"] as string);
    const evs = await sql`select id from events where organization_id = ${ORG_B} and processed_at is null and occurred_at >= ${started}
      and (entity_id = any(${[...ids, ...runIds]}::uuid[]) or payload->>'opportunityId' = any(${ids}::text[])) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      expect((await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } })).status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}

/** A quotation with one insurer, at its approval: the bundle and its one prepared message. */
async function quotationAtApproval(title: string) {
  const created = await call(BETA, "POST", "/opportunities", { clientId, title: `${title} ${TAG}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
  expect(created.status).toBe(201);
  const opportunityId = created.body.opportunityId as string;
  await pump(opportunityId);
  await call(BETA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
  await pump(opportunityId);
  const run = (await sql`select id from workflow_runs where workflow = 'quotation' and subject_id = ${opportunityId}`)[0]!["id"] as string;
  const [a] = await sql`select id, bundle_sha256 from workflow_approvals where run_id = ${run}`;
  const [m] = await sql`select id from prepared_communications where run_id = ${run}`;
  return { opportunityId, run, approvalId: a!["id"] as string, sha: a!["bundle_sha256"] as string, messageId: m!["id"] as string };
}
const attempts = async () => (await sql`select count(*)::int as n from email_send_attempts where organization_id = ${ORG_B}`)[0]!["n"] as number;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-mailbox-delivery')`;
  app = buildApp(API_KEY, [], undefined, { mailbox: { providers: { gmail: fakeMailbox }, limits: { maxThreads: 10, maxMessages: 10, maxAttachments: 0, maxAttachmentBytes: 0 }, encryptionKey: KEY } } as never);
  [{ id: clientId }] = (await sql`insert into clients (organization_id, name, kind, source) values (${ORG_B}, ${`Mailbox Traders ${TAG} Ltd`}, 'corporate', 'manual') returning id`) as unknown as [{ id: string }];
  [{ id: insurerId }] = (await sql`insert into insurers (organization_id, name) values (${ORG_B}, ${`Madison General ${TAG}`}) returning id`) as unknown as [{ id: string }];
  await sql`insert into mailboxes (organization_id, provider, email_address, connected_by, status, access_token_encrypted, refresh_token_encrypted, token_expires_at)
    values (${ORG_B}, 'gmail', ${`broker-${TAG}@beta.test`}, ${BETA.id}, 'connected', ${encryptToken("access", KEY)}, ${encryptToken("refresh", KEY)}, ${new Date(Date.now() + 3_600_000).toISOString()})`;
});
afterAll(async () => {
  await sql`update mailboxes set status = 'disconnected', access_token_encrypted = null, refresh_token_encrypted = null where organization_id = ${ORG_B} and provider = 'gmail'`;
  await sql.end();
});

describe("approved messages through the mailbox boundary", () => {
  let q: Awaited<ReturnType<typeof quotationAtApproval>>;

  it("with no verified address, approval leaves it for a person to deliver; nothing is sent", async () => {
    q = await quotationAtApproval("Mailbox fleet");
    expect((await call(BETA, "POST", `/workflow-approvals/${q.approvalId}/decide`, { decision: "approve", bundleSha256: q.sha })).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(await attempts()).toBe(0);
    expect((await sql`select state from prepared_communications where id = ${q.messageId}`)[0]!["state"]).toBe("approved");
  });

  it("a person records the insurer's address with its source; the approved message is sent once and the quotation moves on", async () => {
    const rec = await call(BETA, "POST", `/insurers/${insurerId}/contacts`, { email: "Quotes@Madison.test", source: "Madison's broker circular, 2 Oct 2026" });
    expect(rec.status).toBe(201);
    const res = await call(BETA, "POST", `/prepared-communications/${q.messageId}/send`);
    expect(res.body.delivery).toMatchObject({ outcome: "sent", why: "Sent to quotes@madison.test." });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["quotes@madison.test"], idempotencyKey: expect.stringMatching(new RegExp(`^${q.messageId}:[0-9a-f]{64}$`)) });
    const [m] = await sql`select state, provider_message_id, send_attempt_id, to_address from prepared_communications where id = ${q.messageId}`;
    expect(m).toMatchObject({ state: "sent", provider_message_id: `gm-1-${TAG}`, to_address: "quotes@madison.test" });
    const [att] = await sql`select approved_by, outcome from email_send_attempts where id = ${m!["send_attempt_id"]}`;
    expect(att).toMatchObject({ approved_by: BETA.id, outcome: "sent" });
    const [d] = await sql`select method, reference from quote_request_deliveries d join quote_requests r on r.id = d.quote_request_id where r.opportunity_id = ${q.opportunityId}`;
    expect(d).toMatchObject({ method: "own_email" });
    expect(String(d!["reference"])).toMatch(/through the connected mailbox/);
    await pump(q.opportunityId);
    expect((await sql`select current_step from workflow_runs where id = ${q.run}`)[0]!["current_step"]).toBe("await_terms");
  });

  it("approving twice, or asking to send again, sends once", async () => {
    expect((await call(BETA, "POST", `/workflow-approvals/${q.approvalId}/decide`, { decision: "approve", bundleSha256: q.sha })).body.outcome).toBe("already");
    expect((await call(BETA, "POST", `/prepared-communications/${q.messageId}/send`)).body.delivery.outcome).toBe("already_sent");
    expect(sent).toHaveLength(1);
    expect(await attempts()).toBe(1);
  });

  it("with the address on file, approval itself sends", async () => {
    const r = await quotationAtApproval("Mailbox vans");
    expect((await call(BETA, "POST", `/workflow-approvals/${r.approvalId}/decide`, { decision: "approve", bundleSha256: r.sha })).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect((await sql`select state from prepared_communications where id = ${r.messageId}`)[0]!["state"]).toBe("sent");
  });

  it("a message changed after it was prepared is refused; nothing is sent", async () => {
    const r = await quotationAtApproval("Mailbox lorries");
    await sql`update prepared_communications set body_text = body_text || ' Also cover the trailer.' where id = ${r.messageId}`;
    expect((await call(BETA, "POST", `/workflow-approvals/${r.approvalId}/decide`, { decision: "approve", bundleSha256: r.sha })).status).toBe(200);
    expect(sent).toHaveLength(2);
    expect((await sql`select state from prepared_communications where id = ${r.messageId}`)[0]!["state"]).toBe("approved");
    expect((await sql`select count(*)::int as n from audit_log where action = 'email.send_refused' and object_id = ${r.messageId}`)[0]!["n"]).toBe(1);
  });
});
