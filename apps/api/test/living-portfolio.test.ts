/**
 * The renewal portfolio and its plain-language refinement (D-158). The interpreter changes only the
 * typed query and says each refinement back; what it does not understand it says, and a word that
 * names two insurers asks which. Composition selects, groups and totals records — no value is made.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type LivingComponent } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { defaultQuery, interpret, type Vocabulary } from "../src/living/interpret.js";
import { composePortfolio, select, type PortfolioFacts, type PortfolioRow } from "../src/living/portfolio.js";
import { validateSurface } from "../src/living/validate.js";

const NOW = new Date("2026-10-12T09:00:00Z");
const CIC = "60000000-0000-4000-8000-00000000000b";
const JUB = "60000000-0000-4000-8000-00000000000a";
const JUBLIFE = "60000000-0000-4000-8000-00000000000c";
const vocab: Vocabulary = { insurers: [{ id: CIC, name: "CIC General" }, { id: JUB, name: "Jubilee Allianz" }, { id: "60000000-0000-4000-8000-00000000000d", name: "Madison" }], classes: ["Commercial motor", "Fire", "Medical"] };
const definitions = (Object.keys(LIVING_BLOCK_PROPS) as LivingComponent[]).map((c) => ({
  component_id: c, version: LIVING_REGISTRY[c].version, allowed_spaces: ["living"], required_permissions: [],
  can_contain_action: true, requires_evidence: LIVING_REGISTRY[c].requiresEvidence, props_schema: livingPropsJsonSchema(c), deprecated_at: null,
}));
const ME = "a0000000-0000-4000-8000-000000000001";
const row = (n: number, over: Partial<PortfolioRow> = {}): PortfolioRow => ({
  periodId: `b000000${n}-0000-4000-8000-00000000000${n}`, workItemId: `c000000${n}-0000-4000-8000-00000000000${n}`, client: `Client ${n}`, policy: `P-${n}`, insurerId: CIC, insurer: "CIC General",
  classOfBusiness: "Commercial motor", ends: "2026-11-15", ownerId: ME, owner: "Amina", taskStatus: "with_party",
  expiring: { amount: 100000, currency: "KES" }, renewal: null, renewalBasis: "none", ...over,
});
const facts: PortfolioFacts = {
  viewerId: ME, vocab, unavailable: [], truncated: false,
  rows: [
    row(1, { renewal: { amount: 110000, currency: "KES" }, renewalBasis: "expiring_insurer_quote" }),
    row(2, { insurerId: JUB, insurer: "Jubilee Allianz", renewal: { amount: 90000, currency: "KES" }, renewalBasis: "placed", ends: "2026-11-20" }),
    row(3, { insurerId: JUB, insurer: "Jubilee Allianz", classOfBusiness: "Fire", ownerId: "someone-else", owner: "Brian", ends: "2026-12-02" }),
    row(4, { renewal: { amount: 500, currency: "USD" }, renewalBasis: "expiring_insurer_quote", ends: "2026-11-28" }),
  ],
};

describe("interpreting a request", () => {
  it("reads a month as the next one to come, and says it back", () => {
    const i = interpret("renewals expiring in November", null, NOW, vocab);
    expect(i.query.window).toMatchObject({ from: "2026-11-01", to: "2026-11-30", label: "in November 2026" });
    expect(i.understood).toEqual([{ kind: "window", text: "Ending in November 2026" }]);
    expect(i.unclear).toBeNull();
    expect(interpret("renewals in march", null, NOW, vocab).query.window.from).toBe("2027-03-01");
  });
  it("refines the current view instead of replacing it", () => {
    const nov = interpret("renewals in November", null, NOW, vocab).query;
    const grouped = interpret("group by insurer", nov, NOW, vocab).query;
    expect(grouped.window.from).toBe("2026-11-01");
    expect(grouped.groupBy).toBe("insurer");
    const inc = interpret("only premium increases", grouped, NOW, vocab).query;
    expect(inc).toMatchObject({ groupBy: "insurer", filters: { premiumChange: "increase" }, window: { from: "2026-11-01" } });
  });
  it("compares insurers side by side, by their names in this brokerage", () => {
    const i = interpret("compare CIC and Jubilee", defaultQuery(NOW), NOW, vocab);
    expect(i.query.compare).toEqual([CIC, JUB]);
    expect(i.query.groupBy).toBe("insurer");
    expect(i.understood.map((u) => u.text)).toContain("Comparing CIC General and Jubilee Allianz");
  });
  it("asks which insurer when a word names two, rather than choosing", () => {
    const v = { ...vocab, insurers: [...vocab.insurers, { id: JUBLIFE, name: "Jubilee Health" }] };
    const i = interpret("only jubilee", defaultQuery(NOW), NOW, v);
    expect(i.query.filters.insurers).toEqual([]);
    expect(i.clarify?.options.map((o) => o.label).sort()).toEqual(["Jubilee Allianz", "Jubilee Health"]);
  });
  it("says what it did not understand, and changes nothing for it", () => {
    const i = interpret("renewals for the blue sky project", defaultQuery(NOW), NOW, vocab);
    expect(i.unclear).toMatch(/blue sky project/);
    expect(i.query).toEqual(defaultQuery(NOW));
  });
  it("reads classes, people, status and resets from the brokerage's own words", () => {
    const i = interpret("my fire renewals waiting on insurers by month", defaultQuery(NOW), NOW, vocab);
    expect(i.query).toMatchObject({ groupBy: "month", filters: { classOfBusiness: "Fire", mine: true, status: "with_party" } });
    const r = interpret("clear filters", i.query, NOW, vocab);
    expect(r.query.filters).toEqual(defaultQuery(NOW).filters);
    expect(r.query.groupBy).toBeNull();
  });
});

describe("composing the portfolio", () => {
  it("selects by premium change only where both amounts exist in the same currency", () => {
    const q = { ...defaultQuery(NOW), filters: { ...defaultQuery(NOW).filters, premiumChange: "increase" as const } };
    expect(select(facts, q).map((r) => r.policy)).toEqual(["P-1"]);
    const unknown = { ...q, filters: { ...q.filters, premiumChange: "unknown" as const } };
    expect(select(facts, unknown).map((r) => r.policy)).toEqual(["P-3", "P-4"]);
  });
  it("groups and totals from records, and validates", () => {
    const q = { ...defaultQuery(NOW), groupBy: "insurer" as const };
    const s = composePortfolio(facts, q, { now: NOW, aiAvailable: false });
    const g = s.blocks.find((b) => b.component === "PortfolioGroups")!.props as { groups: { label: string; count: number; expiringTotals: string[]; rows: { change: string | null }[] }[] };
    expect(g.groups.map((x) => [x.label, x.count])).toEqual([["CIC General", 2], ["Jubilee Allianz", 2]]);
    expect(g.groups[0]!.expiringTotals).toEqual(["KES 200,000.00"]);
    expect(g.groups[0]!.rows[0]!.change).toBe("+KES 10,000.00 (+10.0%)");
    expect(g.groups[0]!.rows[1]!.change).toBeNull();
    expect(s.stage).toBeNull();
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });
  it("keeps one identity across refinements, so blocks reconcile in place", () => {
    const a = composePortfolio(facts, defaultQuery(NOW), { now: NOW, aiAvailable: false });
    const b = composePortfolio(facts, { ...defaultQuery(NOW), groupBy: "class" }, { now: NOW, aiAvailable: false });
    expect(a.surfaceId).toBe(b.surfaceId);
    expect(a.blocks.map((x) => x.id)).toEqual(b.blocks.map((x) => x.id));
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
  it("only mine means the viewer's own renewals", () => {
    expect(select(facts, { ...defaultQuery(NOW), filters: { ...defaultQuery(NOW).filters, mine: true } }).map((r) => r.policy)).toEqual(["P-1", "P-2", "P-4"]);
  });
});
