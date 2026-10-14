import { describe, expect, it } from "vitest";
import pino from "pino";
import { fakeProvider } from "../src/ai/providers/fake.js";
import { defaultExplore, refineExplore } from "../src/experience/compose-explore.js";
import { interpretIntent, interpretRules, splitRenewal } from "../src/experience/intent.js";

const log = pino({ level: "silent" });

describe("intent rules (no model call)", () => {
  it.each([
    ["Add a new client", "create_client"],
    ["new client", "create_client"],
    ["Onboard a client", "create_client"],
    ["Show me motor policies expiring this month", "explore_policies"],
    ["Show all motor policies expiring this month", "explore_policies"],
    ["which renewals are due next month", "explore_policies"],
    ["policies expiring", "explore_policies"],
    ["Help me renew Acme's motor fleet", "renew_policy"],
    ["Renew Kamau Holdings medical", "renew_policy"],
  ])("%s → %s", (text, kind) => {
    expect(interpretRules(text)?.kind).toBe(kind);
  });

  it("does not read a question about one renewal as a list of policies", () => {
    expect(interpretRules("What is blocking this renewal?")?.kind).not.toBe("explore_policies");
  });

  it("keeps the person's own name for a new client as a draft", () => {
    const r = interpretRules("Add Wanjiru Holdings as a new client");
    expect(r).toMatchObject({ kind: "create_client", name: "Wanjiru Holdings" });
  });

  it("splits a renewal request into the client's words and the cover's", () => {
    expect(splitRenewal("Help me renew Acme's motor fleet")).toEqual({ clientWords: "acme", coverWords: "motor fleet" });
    expect(splitRenewal("renew the policy for Kamau Holdings")).toEqual({ clientWords: "kamau holdings", coverWords: null });
  });

  it("refuses to decide cover, choose for the client, or act from words", () => {
    expect(interpretRules("Is the Acme fleet covered for flood?")?.kind).toBe("unsupported");
    expect(interpretRules("Which insurer should we pick?")?.kind).toBe("unsupported");
    expect(interpretRules("approve the renewal bundle")?.kind).toBe("unsupported");
  });
});

describe("the model, only when no rule matches", () => {
  it("is not called for an ordinary request", async () => {
    const provider = fakeProvider([{ match: /./, reply: { text: '{"intent":"renew_policy","client":"x","cover":null,"window":null}', toolCalls: [], stop: "end" } }]);
    const spy = { ...provider, complete: async (...a: Parameters<typeof provider.complete>) => { throw new Error(`model called for ${JSON.stringify(a[0].messages)}`); } };
    expect((await interpretIntent("Add a new client", spy, log)).kind).toBe("create_client");
  });

  it("keeps only words the person typed, and abstains when it says none", async () => {
    const provider = fakeProvider([
      { match: /signed the ngugi family/i, reply: { text: '{"intent":"create_client","client":"Ngugi family","cover":null,"window":null}', toolCalls: [], stop: "end" } },
      { match: /look after otieno/i, reply: { text: '{"intent":"renew_policy","client":"Wairimu Estates","cover":null,"window":null}', toolCalls: [], stop: "end" } },
      { match: /sandwich/i, reply: { text: '{"intent":"none","client":null,"cover":null,"window":null}', toolCalls: [], stop: "end" } },
    ]);
    expect(await interpretIntent("We just signed the Ngugi family", provider, log)).toMatchObject({ kind: "create_client", name: "ngugi family", by: "model" });
    // A client name the person never said is dropped; with no client, a renewal is not read.
    expect((await interpretIntent("please look after otieno", provider, log)).kind).toBe("unsupported");
    expect((await interpretIntent("make me a sandwich", provider, log)).kind).toBe("unsupported");
  });

  it("works without the model at all", async () => {
    expect((await interpretIntent("Add a new client", null, log)).kind).toBe("create_client");
    const r = await interpretIntent("something unusual", null, log);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toMatch(/not available right now/);
  });

  it("abstains when the model's reply is not the schema", async () => {
    const provider = fakeProvider([{ match: /./, reply: { text: "I think they want to renew Acme!", toolCalls: [], stop: "end" } }]);
    expect((await interpretIntent("hmm acme thing", provider, log)).kind).toBe("unsupported");
  });
});

describe("refining an exploration", () => {
  const vocab = { insurers: [{ id: "60000000-0000-4000-8000-00000000000a", name: "Jubilee" }], classes: ["Commercial motor", "Private motor", "Medical"] };
  const now = new Date("2026-10-13T09:00:00Z");
  it("reads 'motor' as every motor class of the brokerage's own", () => {
    const r = refineExplore(defaultExplore(now), "Show me motor policies expiring this month", now, vocab);
    expect(r.params.classWord).toBe("motor");
    expect(r.params.from).toBe("2026-10-01");
    expect(r.params.to).toBe("2026-10-31");
    expect(r.unclear).toBeNull();
  });
  it("adds 'only overdue' without losing the window or the class", () => {
    const base = refineExplore(defaultExplore(now), "motor policies next month", now, vocab).params;
    const r = refineExplore(base, "only show overdue renewals", now, vocab);
    expect(r.params).toMatchObject({ overdueOnly: true, classWord: "motor", from: "2026-11-01" });
  });
  it("removes filters by plain words", () => {
    const base = { ...defaultExplore(now), classWord: "motor", overdueOnly: true };
    expect(refineExplore(base, "all classes", now, vocab).params.classWord).toBeNull();
    expect(refineExplore(base, "include not overdue", now, vocab).params.overdueOnly).toBe(false);
  });
});
