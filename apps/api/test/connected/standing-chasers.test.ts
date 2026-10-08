/**
 * Standing approvals for routine insurer chasers (D-147), connected. In the second brokerage, with a
 * fake mailbox that counts sends. Off by default: a due follow-up is a person's. Switched on, with
 * the wording approved once and the insurer's address verified, ASAP sends the chaser rendered from
 * that wording — once — and records it against the version. Withdrawn, it stops at once.
 */
import { randomUUID } from "node:crypto";
import pino from "pino";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { encryptToken } from "../../src/mailbox/crypto.js";
import type { MailboxProvider, OutgoingMessage } from "../../src/mailbox/types.js";
import { advanceAnyRun } from "./_registry-harness.js";
import { BETA, buildApp, caller, newApiKey, ORG_B, OWNER, serviceClient } from "./_harness.js";

const API_KEY = newApiKey();
const KEY = "a-connected-test-encryption-key-32-chars-long";
const TAG = randomUUID().slice(0, 6);
const DAY = 86_400_000;
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
const log = pino({ level: "silent" });

let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const started = new Date().toISOString();
let runId = "";
let opportunityId = "";
let insurerName = "";
let templateId = "";
const autonomy = (insurerChasers: string) => ({ actions: { detect_renewals: "act_within_rules", prepare_renewal: "act_within_rules", external_messages: "act_after_approval", follow_up: "act_within_rules", escalate: "act_within_rules", recommend_quote: "prepare", prepare_quotation: "act_within_rules", prepare_placement: "act_within_rules", prepare_claim: "act_within_rules", prepare_endorsement: "act_within_rules", insurer_chasers: insurerChasers }, approver: "any_approver", assignment: "client_file_owner", alsoNever: [] });
const work = async () => (await sql`select w.task_status, w.task_party, w.task_since, w.required_action from work_items w join opportunities o on o.work_item_id = w.id where o.id = ${opportunityId}`)[0]!;
const advanceAt = (days: number) => advanceAnyRun(serviceClient(), log, runId, new Date(Date.now() + days * DAY));

async function pump() {
  for (let round = 0; round < 6; round++) {
    const evs = await sql`select id from events where organization_id = ${ORG_B} and processed_at is null and occurred_at >= ${started}
      and (entity_id = any(${[opportunityId, runId].filter(Boolean)}::uuid[]) or payload->>'opportunityId' = ${opportunityId}) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      expect((await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } })).status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-standing-chasers')`;
  app = buildApp(API_KEY, [], undefined, { mailbox: { providers: { gmail: fakeMailbox }, limits: { maxThreads: 10, maxMessages: 10, maxAttachments: 0, maxAttachmentBytes: 0 }, encryptionKey: KEY } } as never);
  const [{ id: clientId }] = (await sql`insert into clients (organization_id, name, kind, source) values (${ORG_B}, ${`Chaser Haulage ${TAG} Ltd`}, 'corporate', 'manual') returning id`) as unknown as [{ id: string }];
  insurerName = `Sanlam General ${TAG}`;
  const [{ id: insurerId }] = (await sql`insert into insurers (organization_id, name) values (${ORG_B}, ${insurerName}) returning id`) as unknown as [{ id: string }];
  await sql`insert into mailboxes (organization_id, provider, email_address, connected_by, status, access_token_encrypted, refresh_token_encrypted, token_expires_at)
    values (${ORG_B}, 'gmail', ${`chasers-${TAG}@beta.test`}, ${BETA.id}, 'connected', ${encryptToken("access", KEY)}, ${encryptToken("refresh", KEY)}, ${new Date(Date.now() + 3_600_000).toISOString()})
    on conflict (organization_id, email_address) do nothing`;
  expect((await call(BETA, "POST", `/insurers/${insurerId}/contacts`, { email: `quotes-${TAG}@sanlam.test`, source: "Sanlam's broker portal contact page" })).status).toBe(201);
  // A quotation, approved — its request sent through the mailbox (D-145) — and waiting on the insurer.
  const created = await call(BETA, "POST", "/opportunities", { clientId, title: `Chaser fleet ${TAG}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
  opportunityId = created.body.opportunityId;
  await pump();
  await call(BETA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
  await pump();
  runId = (await sql`select id from workflow_runs where workflow = 'quotation' and subject_id = ${opportunityId}`)[0]!["id"] as string;
  const [a] = await sql`select id, bundle_sha256 from workflow_approvals where run_id = ${runId}`;
  await call(BETA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] });
  await pump();
  expect(sent).toHaveLength(1);
  expect((await sql`select current_step from workflow_runs where id = ${runId}`)[0]!["current_step"]).toBe("await_terms");
});
afterAll(async () => {
  await sql`delete from company_rules where organization_id = ${ORG_B} and key = 'workflow.autonomy'`;
  await sql`update mailboxes set status = 'disconnected', access_token_encrypted = null, refresh_token_encrypted = null where organization_id = ${ORG_B} and email_address = ${`chasers-${TAG}@beta.test`}`;
  await sql.end();
});

describe("standing approvals for insurer chasers", () => {
  it("off by default: a due follow-up is a person's, and nothing is sent", async () => {
    await advanceAt(4);
    expect(sent).toHaveLength(1);
    expect(String((await work())["required_action"])).toMatch(new RegExp(`^Chase ${insurerName} \\(follow-up 1\\) for terms`));
  });

  it("switched on, with the wording approved once: ASAP sends the next chaser itself, rendered exactly, once", async () => {
    expect((await call(BETA, "PUT", "/rules", { key: "workflow.autonomy", value: autonomy("act_within_rules"), source: "Principal officer, 5 Oct 2026", verifiedAt: "2026-10-05" })).status).toBeLessThan(300);
    const t = await call(BETA, "POST", "/chaser-templates", { purpose: "quote_chase", subject: "Follow-up {{follow_up}}: {{subject}}", body: "Dear {{insurer}},\n\nWe sent our quotation request for {{client}} on {{sent_on}} and have not yet received your terms. Kindly let us have them.\n\nKind regards", minDaysBetween: 2 });
    expect(t.status).toBe(201);
    templateId = t.body.templateId;
    await advanceAt(7);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ to: [`quotes-${TAG}@sanlam.test`], subject: expect.stringMatching(/^Follow-up 2: /) });
    expect(sent[1]!.bodyText).toMatch(new RegExp(`^Dear ${insurerName},\\n\\nWe sent our quotation request for Chaser Haulage ${TAG} Ltd on `));
    expect(sent[1]!.bodyText).not.toMatch(/\{\{/);
    const [cs] = await sql`select template_id, follow_up, send_attempt_id from chaser_sends where run_id = ${runId}`;
    expect(cs).toMatchObject({ template_id: templateId, follow_up: 2 });
    const [att] = await sql`select approved_by from email_send_attempts where id = ${cs!["send_attempt_id"]}`;
    expect(att!["approved_by"]).toBe(BETA.id);
    expect((await sql`select count(*)::int as n from audit_log where action = 'email.chaser_sent' and new_state->>'templateId' = ${templateId}`)[0]!["n"]).toBe(1);
    const w = await work();
    expect(w).toMatchObject({ task_status: "with_party", task_party: insurerName });
    expect(w["task_since"]).not.toBeNull();
    expect(String(w["required_action"])).toMatch(/with the approved wording$/);
    // Advanced again at the same moment: nothing more is due, nothing more is sent.
    await advanceAt(7);
    expect(sent).toHaveLength(2);
  });

  it("withdrawn, the standing approval stops at once: the next chaser is a person's", async () => {
    expect((await call(BETA, "POST", `/chaser-templates/${templateId}/withdraw`)).body.outcome).toBe("withdrawn");
    await sql`update workflow_steps set output = output || '{"escalated": true}'::jsonb where run_id = ${runId} and step_key = 'await_terms'`;
    await advanceAt(9.5);
    expect(sent).toHaveLength(2);
    expect(String((await work())["required_action"])).toMatch(new RegExp(`^Chase ${insurerName} \\(follow-up 3\\) for terms`));
  });
});
