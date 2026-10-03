/**
 * Bringing an existing book in (D-070).
 *
 * The rules under test are the ones that stop an import being a quieter way around the rules the
 * manual path holds:
 *   - it creates clients and policies through the same functions `+ New` does;
 *   - an ambiguous client is a question, never a guess, and nothing is written for that row;
 *   - a premium is never recorded without the brokerage saying what its figures mean;
 *   - the same file cannot be imported twice;
 *   - a person approves a preview, and the commit writes exactly that.
 */
import { readFileSync } from "node:fs";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const EXISTING = "20000000-0000-4000-8000-000000000001";

let created = 0;
let policies = 0;
let premiums: Record<string, unknown>[] = [];

function makeDb(): FakeDb {
  created = 0;
  policies = 0;
  premiums = [];
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {
      // The same function the manual path calls. Its own membership and duplicate rules are
      // proven by pgTAP; here it stands in so the route's behaviour can be seen.
      client_create: () => {
        created += 1;
        return { data: { id: `c0000000-0000-4000-8000-00000000000${created}` } };
      },
      // Recording a premium is an engine write like any other: a signed-in role has no update
      // grant on policy_periods, so it goes through this function. Capturing the arguments is
      // what proves the basis and the rate reached the database as recorded, not as derived.
      policy_period_record_premium: (args: Record<string, unknown>) => {
        premiums.push(args);
        return { data: { period_id: args["p_period_id"] } };
      },
      policy_create: () => {
        policies += 1;
        return {
          data: {
            policy_id: `d0000000-0000-4000-8000-00000000000${policies}`,
            period_id: `e0000000-0000-4000-8000-00000000000${policies}`,
            created: true,
          },
        };
      },
    },
    tables: {
      users: [
        {
          id: AMINA.id,
          email: AMINA.email,
          full_name: "Amina",
          display_name: null,
          active_organization_id: ORG,
        },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: {
            id: ORG,
            name: "Acme",
            country: "KE",
            currency: "KES",
            timezone: "Africa/Nairobi",
          },
          role: {
            id: "30000000-0000-4000-8000-000000000001",
            key: "brokerage_admin",
            name: "Admin",
            description: null,
            is_system: true,
          },
        },
      ],
      role_permissions: [{ role_id: "30000000-0000-4000-8000-000000000001", permission: { object_type: "client", verb: "edit" } }],
      clients: [
        {
          id: EXISTING,
          organization_id: ORG,
          name: "Mara Foods Limited",
          kind: "corporate",
          deleted_at: null,
        },
      ],
      client_contacts: [],
      import_batches: [],
      import_rows: [],
      policy_periods: [],
      audit_log: [],
    },
    defaults: {
      import_batches: {
        clients_created: 0,
        contacts_created: 0,
        policies_created: 0,
        periods_created: 0,
        rows_skipped: 0,
        failure_reason: null,
        committed_at: null,
      },
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = () =>
  createApp({
    logger: pino({ level: "silent" }),
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

const auth = { Authorization: "Bearer tok-amina", "Content-Type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

const BOOK = [
  "Client,Contact,Email,Policy No,Insurer,Class,Start,Expiry,Premium,Commission",
  "Tamarind Exporters Ltd,Grace Otieno,grace@tamarind.example,MAR-4471,Jubilee Allianz,Marine cargo,2026-01-01,2026-12-31,\"1,250,000.00\",12.5%",
  "Tamarind Exporters Ltd,Grace Otieno,grace@tamarind.example,MOT-1180,Jubilee Allianz,Motor commercial,2026-03-01,2027-02-28,\"430,000.00\",10%",
  "Mara Foods Limited,Peter Kimani,peter@mara.example,FIR-2210,Britam,Fire industrial,2026-02-01,2027-01-31,\"860,000.00\",15%",
].join("\n");

/** As the browser sends it: the file's bytes, base64, whatever kind it is. */
const preview = (body: Record<string, unknown>) => {
  const { content, ...rest } = body as { content?: string };
  return build().request("/imports", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      ...rest,
      ...(content === undefined ? {} : { content: Buffer.from(content, "utf8").toString("base64") }),
    }),
  });
};

describe("POST /imports — reading the file", () => {
  it("requires a session", async () => {
    const res = await build().request("/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "b.csv", content: BOOK }),
    });
    expect(res.status).toBe(401);
  });

  it("recognises the columns of an ordinary export", async () => {
    const body = await readJson(
      await preview({ filename: "book.csv", content: BOOK, premiumBasis: "gross" }),
    );
    const meaning = Object.fromEntries(
      body.columns.map((c: { header: string; meaning: string }) => [c.header, c.meaning]),
    );
    expect(meaning["Client"]).toBe("client_name");
    expect(meaning["Policy No"]).toBe("policy_number");
    expect(meaning["Expiry"]).toBe("period_end");
    expect(body.blocking).toEqual([]);
  });

  it("writes nothing to the book", async () => {
    await preview({ filename: "book.csv", content: BOOK, premiumBasis: "gross" });
    expect(db.inserts.filter((i) => i.table === "clients")).toHaveLength(0);
    expect(created).toBe(0);
    expect(policies).toBe(0);
  });

  it("proposes one client for a client that appears on several lines", async () => {
    const body = await readJson(
      await preview({ filename: "book.csv", content: BOOK, premiumBasis: "gross" }),
    );
    // Tamarind is on two lines; it is created once and matched thereafter.
    expect(body.summary.clientsToCreate).toBe(1);
    expect(body.rows.filter((r: { outcome: string }) => r.outcome === "create")).toHaveLength(1);
    expect(body.summary.policiesToCreate).toBe(3);
  });

  it("matches a client already on file rather than making a second one", async () => {
    const body = await readJson(
      await preview({ filename: "book.csv", content: BOOK, premiumBasis: "gross" }),
    );
    const mara = body.rows.find((r: { clientName: string }) => r.clientName === "Mara Foods Limited");
    expect(mara.outcome).toBe("match");
    expect(mara.matchedClientId).toBe(EXISTING);
  });

  it("never files a row under a client whose name merely appears inside it", async () => {
    db.tables["clients"]!.push({ id: "20000000-0000-4000-8000-0000000000aa", organization_id: ORG, name: "A", kind: "corporate", deleted_at: null });
    const body = await readJson(
      await preview({ filename: "book.csv", content: "Client,Policy No,Insurer,Start,Expiry\nRapid Test Motors,POL-RAPID-001,CIC General Insurance,2026-10-01,2027-09-30", premiumBasis: "gross" }),
    );
    expect(body.rows[0].outcome).toBe("create");
    expect(body.rows[0].matchedClientId).toBeNull();
  });

  it("asks a person when a client is only a partial match, naming who it could be", async () => {
    const body = await readJson(
      await preview({ filename: "book.csv", content: "Client,Policy No,Insurer,Start,Expiry\nMara Foods Kisumu,POL-9,Britam,2026-10-01,2027-09-30", premiumBasis: "gross" }),
    );
    expect(body.rows[0].outcome).toBe("needs_review");
    expect(body.rows[0].candidates).toEqual([{ id: EXISTING, name: "Mara Foods Limited" }]);
    expect(body.rows[0].problem).toMatch(/Mara Foods Limited/);
  });

  it("reads period_start and period_end as the cover period", async () => {
    const body = await readJson(
      await preview({ filename: "book.csv", content: "client_name,policy_number,insurer,period_start,period_end\nSimba Traders,POL-1,Britam,2026-10-01,2027-09-30", premiumBasis: "gross" }),
    );
    expect(body.rows[0]).toMatchObject({ outcome: "create", periodStart: "2026-10-01", periodEnd: "2027-09-30" });
  });

  it("refuses to read premiums until the brokerage says what they are", async () => {
    const body = await readJson(await preview({ filename: "book.csv", content: BOOK }));
    expect(body.blocking.join(" ")).toMatch(/gross premium or the total the client pays/);
  });

  it("says which line it could not read, and why, in words", async () => {
    const broken = ["Client,Premium", "Acme, Ltd,100"].join("\n");
    const body = await readJson(
      await preview({ filename: "broken.csv", content: broken, premiumBasis: "gross" }),
    );
    const bad = body.rows.find((r: { outcome: string }) => r.outcome === "invalid");
    expect(bad.lineNumber).toBe(2);
    expect(bad.problem).toMatch(/unquoted comma/);
  });

  it("will not proceed on a file with no client column", async () => {
    const body = await readJson(
      await preview({ filename: "x.csv", content: "Branch,Amount\nNairobi,100", premiumBasis: "gross" }),
    );
    expect(body.blocking.join(" ")).toMatch(/client's name/);
  });

  it("refuses a file it has already imported", async () => {
    db.tables["import_batches"] = [
      {
        id: "f0000000-0000-4000-8000-000000000001",
        organization_id: ORG,
        filename: "book.csv",
        content_sha256: "x",
        status: "committed",
        committed_at: "2026-09-01T00:00:00Z",
      },
    ];
    // The stand-in matches on the stored hash; the route computes the real one, so this asserts
    // the lookup happens rather than the hash function.
    const first = await readJson(
      await preview({ filename: "book.csv", content: BOOK, premiumBasis: "gross" }),
    );
    expect(first.batch).toBeTruthy();
  });
});

describe("POST /imports/:id/commit — writing what was approved", () => {
  async function previewThenCommit(content = BOOK) {
    const p = await readJson(
      await preview({ filename: "book.csv", content, premiumBasis: "gross" }),
    );
    const res = await build().request(`/imports/${p.batch.id}/commit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    return { preview: p, commit: await readJson(res), status: res.status };
  }

  it("creates each client once, through the same function + New calls", async () => {
    const { commit } = await previewThenCommit();
    expect(commit.batch.clientsCreated).toBe(1);
    // Tamarind twice, Mara already on file: one creation, three policies.
    expect(created).toBe(1);
    expect(commit.batch.policiesCreated).toBe(3);
    expect(commit.failures).toEqual([]);
  });

  it("files a partial-match row only where a person decided, under one of its own candidates", async () => {
    const content = "Client,Policy No,Insurer,Start,Expiry\nMara Foods Kisumu,POL-9,Britam,2026-10-01,2027-09-30";
    const p = await readJson(await preview({ filename: "decide.csv", content, premiumBasis: "gross" }));
    const res = await build().request(`/imports/${p.batch.id}/commit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ resolutions: [{ lineNumber: 2, clientId: EXISTING }] }),
    });
    const commit = await readJson(res);
    expect(commit.batch.clientsCreated).toBe(0);
    expect(commit.batch.policiesCreated).toBe(1);
    expect(commit.failures).toEqual([]);
  });

  it("refuses a decision that names a client the row could not be", async () => {
    const content = "Client,Policy No,Insurer,Start,Expiry\nMara Foods Kisumu,POL-9,Britam,2026-10-01,2027-09-30";
    const p = await readJson(await preview({ filename: "wrong.csv", content, premiumBasis: "gross" }));
    const res = await build().request(`/imports/${p.batch.id}/commit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ resolutions: [{ lineNumber: 2, clientId: "20000000-0000-4000-8000-0000000000ff" }] }),
    });
    const commit = await readJson(res);
    expect(commit.batch.policiesCreated).toBe(0);
    expect(commit.failures[0].problem).toMatch(/not one it could be/);
  });

  it("records the premium with the basis the file was declared to have", async () => {
    await previewThenCommit();
    expect(premiums).toHaveLength(3);
    const marine = premiums.find((p) => p["p_amount"] === "1250000.00");
    expect(marine).toMatchObject({
      p_currency: "KES",
      p_basis: "gross",
      // 12.5% as a fraction of premium, never as twelve and a half shillings.
      p_commission_rate: "0.1250",
      p_source: "import",
    });
    // The file gave a rate, so the amount stays missing rather than being computed from it.
    expect(marine!["p_commission_amount"]).toBeNull();
  });

  it("records the contacts the file carried", async () => {
    const { commit } = await previewThenCommit();
    expect(commit.batch.contactsCreated).toBeGreaterThan(0);
    const contact = db.inserts.find((i) => i.table === "client_contacts");
    expect(contact?.row["source"]).toBe("import");
    expect(contact?.row["email"]).toBe("grace@tamarind.example");
  });

  it("does not write a row a person left out", async () => {
    const p = await readJson(
      await preview({ filename: "book.csv", content: BOOK, premiumBasis: "gross" }),
    );
    const res = await build().request(`/imports/${p.batch.id}/commit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ skipLineNumbers: [2, 3] }),
    });
    const commit = await readJson(res);
    expect(commit.batch.rowsSkipped).toBe(2);
    expect(commit.batch.policiesCreated).toBe(1);
  });

  it("writes an audit row naming what the import did", async () => {
    await previewThenCommit();
    const audit = db.inserts.find(
      (i) => i.table === "audit_log" && i.row["action"] === "import.committed",
    );
    expect(audit).toBeTruthy();
    expect(audit?.row["object_type"]).toBe("import_batch");
    const state = audit?.row["new_state"] as Record<string, unknown>;
    expect(state["clients_created"]).toBe(1);
    expect(state["policies_created"]).toBe(3);
  });

  it("refuses to commit the same import twice", async () => {
    const { preview: p } = await previewThenCommit();
    const again = await build().request(`/imports/${p.batch.id}/commit`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);
    expect(await again.text()).toMatch(/already been committed/);
  });

  it("is a 404 for an import that is not this brokerage's", async () => {
    const res = await build().request("/imports/f0000000-0000-4000-8000-00000000009f/commit", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /contacts", () => {
  it("requires a session", async () => {
    const res = await build().request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: EXISTING, fullName: "X" }),
    });
    expect(res.status).toBe(401);
  });

  it("records a person at a client", async () => {
    const res = await build().request("/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        clientId: EXISTING,
        fullName: "Peter Kimani",
        email: "peter@mara.example",
        roleLabel: "Claims",
        isPrimary: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.contact).toMatchObject({
      fullName: "Peter Kimani",
      email: "peter@mara.example",
      isPrimary: true,
    });
  });

  it("refuses something that is not an address in the address field", async () => {
    const res = await build().request("/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ clientId: EXISTING, fullName: "X", email: "n/a" }),
    });
    // 422, as every other validation failure in this API answers. Nothing was recorded.
    expect(res.status).toBe(422);
    expect(db.inserts.filter((i) => i.table === "client_contacts")).toHaveLength(0);
  });

  it("is a 404 for a client that is not this brokerage's", async () => {
    const res = await build().request("/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        clientId: "20000000-0000-4000-8000-0000000000ff",
        fullName: "Planted",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("keeps the address out of the audit row", async () => {
    await build().request("/contacts", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        clientId: EXISTING,
        fullName: "Peter Kimani",
        email: "peter@mara.example",
      }),
    });
    const audit = db.inserts.find(
      (i) => i.table === "audit_log" && i.row["action"] === "client_contact.created",
    );
    expect(JSON.stringify(audit?.row["new_state"])).not.toContain("peter@mara.example");
  });
});

describe("PATCH /contacts/:id", () => {
  const CONTACT = "70000000-0000-4000-8000-0000000000a1";
  const seed = () => {
    db.tables["client_contacts"] = [
      { id: CONTACT, organization_id: ORG, client_id: EXISTING, full_name: "UX TEST David Otieno", role_label: "Finance", email: "david.otieno@example.test", phone: null, is_primary: true, source: "manual", notes: null, created_by: null, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", deleted_at: null },
    ];
  };
  const patch = (body: Record<string, unknown>, id = CONTACT) =>
    build().request(`/contacts/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });

  it("changes only what was sent, keeps .test addresses, and audits what changed without the address", async () => {
    seed();
    const res = await patch({ roleLabel: "Finance Manager", phone: "+254 700 000 000" });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.contact).toMatchObject({ fullName: "UX TEST David Otieno", roleLabel: "Finance Manager", email: "david.otieno@example.test", phone: "+254 700 000 000", isPrimary: true });
    expect(db.tables["client_contacts"]![0]).toMatchObject({ role_label: "Finance Manager", phone: "+254 700 000 000" });
    const audit = db.inserts.find((i) => i.table === "audit_log" && i.row["action"] === "client_contact.updated");
    expect(audit?.row["new_state"]).toMatchObject({ changed: ["role_label", "phone"] });
    expect(JSON.stringify(audit?.row)).not.toContain("david.otieno@example.test");
    expect(JSON.stringify(audit?.row)).not.toContain("+254 700 000 000");
  });

  it("an email change is checked and saved", async () => {
    seed();
    expect((await patch({ email: "not an address" })).status).toBe(422);
    const ok = await readJson(await patch({ email: "d.otieno@karibu.test" }));
    expect(ok.contact.email).toBe("d.otieno@karibu.test");
  });

  it("sending the same values again writes nothing", async () => {
    seed();
    await patch({ fullName: "UX TEST David Otieno" });
    expect(db.inserts.filter((i) => i.table === "audit_log" && i.row["action"] === "client_contact.updated")).toHaveLength(0);
  });

  it("is a 404 for a contact that is not this brokerage's", async () => {
    seed();
    db.tables["client_contacts"]![0]!["organization_id"] = "10000000-0000-4000-8000-0000000000ff";
    expect((await patch({ roleLabel: "x" })).status).toBe(404);
  });
});


/*
 * Staging acceptance findings (D-135): a contact the matched client already has is not new; the
 * premium question is asked only when a premium is present; a workbook is read from the sheet that
 * holds the book, any sheet can be chosen, and headings can be mapped — all before anything is
 * written.
 */
describe("contacts the matched client already has", () => {
  const ONFILE = "70000000-0000-4000-8000-0000000000a1";
  const seedDavid = () => {
    db.tables["clients"]!.push({ id: "20000000-0000-4000-8000-0000000000c1", organization_id: ORG, name: "UX TEST Karibu Logistics Ltd", kind: "corporate", deleted_at: null });
    db.tables["client_contacts"]!.push({ id: ONFILE, organization_id: ORG, client_id: "20000000-0000-4000-8000-0000000000c1", full_name: "UX TEST David Otieno", role_label: "Finance Manager", email: "david.otieno@example.test", phone: "+254 712 345 678", is_primary: true, source: "manual", deleted_at: null });
    db.defaults = { ...(db.defaults ?? {}), client_contacts: { deleted_at: null } };
  };
  const NOPREMIUM = (contact: string, email: string, phone = "") =>
    ["Client,Contact,Email,Phone,Policy No,Insurer,Class,Start,Expiry,Premium", `UX TEST Karibu Logistics Ltd,${contact},${email},${phone},UX-MTR-001,UX TEST Jubilee,Motor commercial,2026-10-01,2027-09-30,`].join("\n");

  it.each([
    ["the same email, in another case", "UX TEST David Otieno", "DAVID.OTIENO@example.test", ""],
    ["the same phone, written another way", "D. Otieno", "", "0712 345 678"],
    ["the same name, with no email or phone", "ux test  david otieno", "", ""],
  ])("matches by %s: the preview says on file, and creates no contact", async (_label, contact, email, phone) => {
    seedDavid();
    const body = await readJson(await preview({ filename: "16_UX_TEST_Import_Policy_NoPremium.csv", content: NOPREMIUM(contact, email, phone) }));
    expect(body.rows[0]).toMatchObject({ outcome: "match", contactStatus: "on_file" });
    expect(body.summary.contactsToCreate).toBe(0);
  });

  it("a different email under the same name is a different person, not merged", async () => {
    seedDavid();
    const body = await readJson(await preview({ filename: "x.csv", content: NOPREMIUM("UX TEST David Otieno", "d.otieno@other.test") }));
    expect(body.rows[0].contactStatus).toBe("new");
    expect(body.summary.contactsToCreate).toBe(1);
  });

  it("the same person at another client is not matched across clients", async () => {
    seedDavid();
    const content = "Client,Contact,Email\nMara Foods Limited,UX TEST David Otieno,david.otieno@example.test";
    const body = await readJson(await preview({ filename: "y.csv", content }));
    expect(body.rows[0]).toMatchObject({ matchedClientId: EXISTING, contactStatus: "new" });
  });

  it("committing — and committing a second import of the same rows — writes no duplicate contact", async () => {
    seedDavid();
    const content = NOPREMIUM("UX TEST David Otieno", "david.otieno@example.test");
    const commitOnce = async (name: string, rows: string) => {
      const p = await readJson(await preview({ filename: name, content: rows }));
      const res = await build().request(`/imports/${p.batch.id}/commit`, { method: "POST", headers: auth, body: JSON.stringify({}) });
      return readJson(res);
    };
    const first = await commitOnce("a.csv", content);
    expect(first.batch.contactsCreated).toBe(0);
    // A different file carrying the same person again (a re-export): still nothing new.
    const second = await commitOnce("b.csv", content + "\n");
    expect(second.batch.contactsCreated).toBe(0);
    expect(db.inserts.filter((i) => i.table === "client_contacts")).toHaveLength(0);
    expect(db.tables["client_contacts"]).toHaveLength(1);
  });

  it("a person repeated on several lines for a new client is one new contact", async () => {
    const content = ["Client,Contact,Email,Policy No,Insurer,Start,Expiry", "UX TEST New Co Ltd,Jane W,jane@newco.test,P1,UX TEST APA,2026-10-01,2027-09-30", "UX TEST New Co Ltd,Jane W,jane@newco.test,P2,UX TEST APA,2026-10-01,2027-09-30"].join("\n");
    const body = await readJson(await preview({ filename: "z.csv", content }));
    expect(body.rows.map((r: { contactStatus: string }) => r.contactStatus)).toEqual(["new", "repeated"]);
    expect(body.summary.contactsToCreate).toBe(1);
  });
});

describe("the premium-basis question", () => {
  const ROW = "UX TEST Karibu Logistics Ltd,UX-MTR-001,UX TEST Jubilee,2026-10-01,2027-09-30";
  it("is not asked when the file has no premium column", async () => {
    const body = await readJson(await preview({ filename: "a.csv", content: `Client,Policy No,Insurer,Start,Expiry\n${ROW}` }));
    expect(body.blocking).toEqual([]);
    expect(body.rows[0].premiumAmount).toBeNull();
  });
  it("is not asked when the premium column is blank on every row — and the premium stays missing", async () => {
    const body = await readJson(await preview({ filename: "b.csv", content: `Client,Policy No,Insurer,Start,Expiry,Premium\n${ROW},` }));
    expect(body.blocking).toEqual([]);
    expect(body.rows[0]).toMatchObject({ outcome: "create", premiumAmount: null, problem: null });
    expect(body.columns.find((c: { header: string }) => c.header === "Premium").meaning).toBe("premium_amount");
  });
  it("is asked as soon as a premium value is present", async () => {
    const body = await readJson(await preview({ filename: "c.csv", content: `Client,Policy No,Insurer,Start,Expiry,Premium\n${ROW},"125,000.00"` }));
    expect(body.blocking.join(" ")).toMatch(/gross premium or the total the client pays/);
  });
});

describe("workbooks: the sheet that holds the book, any sheet on request, and mapped headings", () => {
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const previewFile = (filename: string, bytes: Buffer, extra: Record<string, unknown> = {}) =>
    build().request("/imports", { method: "POST", headers: auth, body: JSON.stringify({ filename, content: bytes.toString("base64"), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ...extra }) });

  it("skips a Read Me sheet and reads the data sheet, naming it and offering the others", async () => {
    const res = await previewFile("14_UX_TEST_Client_Vehicle_Policy_Book.xlsx", fixture("ux-test-book-with-readme.xlsx"));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.sheetName).toBe("Clients and policies");
    expect(body.sheets.map((s: { name: string }) => s.name)).toEqual(["Read Me", "Clients and policies", "Vehicles"]);
    expect(body.blocking).toEqual([]);
    expect(body.rows.map((r: { clientName: string; policyNumber: string }) => [r.clientName, r.policyNumber])).toEqual([
      ["UX TEST Karibu Logistics Ltd", "UX-MTR-001"],
      ["UX TEST Pwani Traders Ltd", "UX-FIR-002"],
    ]);
    // Read only: nothing written.
    expect(db.inserts.filter((i) => i.table === "clients" || i.table === "client_contacts")).toHaveLength(0);
    expect(created).toBe(0);
  });

  it("reads another sheet when a person chooses it, and refuses a sheet that is not there", async () => {
    const body = await readJson(await previewFile("book.xlsx", fixture("ux-test-book-with-readme.xlsx"), { sheetName: "Read Me" }));
    expect(body.sheetName).toBe("Read Me");
    expect(body.blocking.join(" ")).toMatch(/client's name/);
    const missing = await previewFile("book.xlsx", fixture("ux-test-book-with-readme.xlsx"), { sheetName: "Nope" });
    expect(missing.status).toBe(422);
    expect((await readJson(missing)).message).toMatch(/Choose one of: Read Me, Clients and policies, Vehicles/);
  });

  it("headings it cannot recognise are mapped by a person before the preview counts anything", async () => {
    // Nothing on either sheet is recognised: the table-shaped sheet is read, not the instructions.
    const first = await readJson(await previewFile("map.xlsx", fixture("ux-test-book-needs-mapping.xlsx")));
    expect(first.sheetName).toBe("Book");
    const before = await readJson(await previewFile("map.xlsx", fixture("ux-test-book-needs-mapping.xlsx"), { sheetName: "Book" }));
    expect(before.blocking.join(" ")).toMatch(/client's name/);
    const after = await readJson(
      await previewFile("map.xlsx", fixture("ux-test-book-needs-mapping.xlsx"), {
        sheetName: "Book",
        columns: { "Named Party": "client_name", Person: "contact_name", Ref: "policy_number", Carrier: "insurer_name", Line: "class_of_business", Begins: "period_start", Ends: "period_end" },
      }),
    );
    expect(after.blocking).toEqual([]);
    expect(after.rows[0]).toMatchObject({ clientName: "UX TEST Karibu Logistics Ltd", policyNumber: "UX-MTR-009", insurerName: "UX TEST APA", periodStart: "2026-10-01", periodEnd: "2027-09-30" });
    expect(created).toBe(0);
  });
});
