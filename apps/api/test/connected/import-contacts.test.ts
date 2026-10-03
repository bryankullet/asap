/**
 * Importing a book whose rows name a contact the client already has, connected (D-135): the preview
 * says "already on file", and neither a commit nor a second import of the same person writes a
 * second contact. Premium left blank: no basis question, no premium recorded.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, buildApp, caller, newApiKey, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-import-contacts')`;
  app = buildApp(API_KEY);
});
afterAll(async () => {
  await sql.end();
});

describe("an import naming a contact the client already has", () => {
  it("is matched, not duplicated — on preview, on commit and on a second import", async () => {
    const tag = randomUUID().slice(0, 6);
    const [acme] = await sql`select name from clients where id = ${ACME}`;
    const email = `ux.david.${tag}@example.test`;
    const made = await call(AMINA, "POST", "/contacts", {
      clientId: ACME,
      fullName: `UX TEST David Otieno ${tag}`,
      email,
      isPrimary: false,
    });
    expect(made.status).toBe(201);
    const before =
      await sql`select count(*)::int as n from client_contacts where client_id = ${ACME} and deleted_at is null`;
    const csv = (policy: string) =>
      Buffer.from(
        `Client,Contact,Email,Policy No,Insurer,Class,Start,Expiry,Premium\n${acme!["name"]},UX TEST David Otieno ${tag},${email.toUpperCase()},${policy},UX TEST Jubilee,Motor commercial,2026-10-01,2027-09-30,\n`,
      ).toString("base64");

    for (const [name, policy] of [
      [`16_UX_TEST_Import_Policy_NoPremium_${tag}.csv`, `UX-${tag}-1`],
      [`16b_${tag}.csv`, `UX-${tag}-2`],
    ] as const) {
      const p = await call(AMINA, "POST", "/imports", {
        filename: name,
        content: csv(policy),
        mimeType: "text/csv",
      });
      expect(p.status).toBe(201);
      expect(p.body.blocking).toEqual([]);
      expect(p.body.rows[0]).toMatchObject({
        outcome: "match",
        matchedClientId: ACME,
        contactStatus: "on_file",
        premiumAmount: null,
      });
      expect(p.body.summary.contactsToCreate).toBe(0);
      const c = await call(AMINA, "POST", `/imports/${p.body.batch.id}/commit`, {});
      expect(c.status).toBe(200);
      expect(c.body.batch.contactsCreated).toBe(0);
      expect(c.body.failures).toEqual([]);
    }
    const after =
      await sql`select count(*)::int as n from client_contacts where client_id = ${ACME} and deleted_at is null`;
    expect(after[0]!["n"]).toBe(before[0]!["n"]);
    const [premium] =
      await sql`select pp.premium_amount from policy_periods pp join policies p on p.id = pp.policy_id where p.policy_number = ${`UX-${tag}-1`}`;
    expect(premium!["premium_amount"]).toBeNull();

    // D-137: the same policy imported again is previewed as already on file — not "1 new policy" —
    // and the commit writes nothing more. (Different bytes: the same file again is refused outright.)
    const again = await call(AMINA, "POST", "/imports", {
      filename: `16c_${tag}.csv`,
      content: Buffer.from(Buffer.from(csv(`UX-${tag}-1`), "base64").toString() + "\n").toString(
        "base64",
      ),
      mimeType: "text/csv",
    });
    expect(again.status).toBe(201);
    expect(again.body.rows[0].policyStatus).toBe("on_file");
    expect(again.body.summary.policiesToCreate).toBe(0);
    const policiesBefore =
      await sql`select count(*)::int as n from policies where policy_number = ${`UX-${tag}-1`}`;
    const done = await call(AMINA, "POST", `/imports/${again.body.batch.id}/commit`, {});
    expect(done.body.batch.policiesCreated).toBe(0);
    expect(
      (
        await sql`select count(*)::int as n from policies where policy_number = ${`UX-${tag}-1`}`
      )[0]!["n"],
    ).toBe(policiesBefore[0]!["n"]);
  });
});
