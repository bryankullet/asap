import type { PolicyEvidence } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { nairobiDay, overlaps, periodCover, policyCover, type PeriodEvidence } from "../src/policy/cover.js";

/**
 * Cover state (4C-1): evidence makes cover, dates never do.
 */
const EV: PolicyEvidence = { kind: "cover_confirmation", label: "Insurer confirmed cover", documentId: null, page: null, region: null, path: "/placements/x", recordedByName: "Amina", recordedAt: "2026-09-09T14:10:00Z" };
const P = (id: string, start: string, end: string, over: Partial<PeriodEvidence> = {}): PeriodEvidence => ({ id, start, end, evidence: [EV], verified: true, cancellation: null, ...over });
const legacy = (id: string, start: string, end: string) => P(id, start, end, { evidence: [], verified: false });

describe("the Nairobi calendar", () => {
  it("changes day at 21:00 UTC, which is midnight in Nairobi", () => {
    expect(nairobiDay(new Date("2027-09-30T20:59:59Z"))).toBe("2027-09-30");
    expect(nairobiDay(new Date("2027-09-30T21:00:00Z"))).toBe("2027-10-01");
  });

  it("a period is active through its last day, and expired from the next Nairobi midnight", () => {
    const p = P("a", "2026-10-01", "2027-09-30");
    expect(periodCover(p, nairobiDay(new Date("2027-09-30T20:59:59Z"))).state).toBe("active");
    expect(periodCover(p, nairobiDay(new Date("2027-09-30T21:00:00Z"))).state).toBe("expired");
    expect(periodCover(p, nairobiDay(new Date("2026-09-30T20:59:59Z"))).state).toBe("confirmed");
    expect(periodCover(p, nairobiDay(new Date("2026-09-30T21:00:00Z"))).state).toBe("active");
  });
});

describe("one period", () => {
  it("with evidence and today inside it: Active cover, with the evidence", () => {
    const c = periodCover(P("a", "2026-01-01", "2026-12-31"), "2026-06-01");
    expect(c).toMatchObject({ state: "active", label: "Active cover", verified: true });
    expect(c.evidence).toHaveLength(1);
  });
  it("a future inception is not active cover", () => {
    expect(periodCover(P("a", "2027-01-01", "2027-12-31"), "2026-06-01")).toMatchObject({ state: "confirmed", label: "Confirmed" });
  });
  it("dates with no evidence are not cover, even today", () => {
    const c = periodCover(legacy("a", "2026-01-01", "2026-12-31"), "2026-06-01");
    expect(c).toMatchObject({ state: null, label: "Cover not verified", verified: false });
    expect(c.reason).toMatch(/Dates alone are not cover/);
  });
  it("an ended verified period is expired; an ended unverified one is still not verified", () => {
    expect(periodCover(P("a", "2025-01-01", "2025-12-31"), "2026-06-01").state).toBe("expired");
    expect(periodCover(legacy("a", "2025-01-01", "2025-12-31"), "2026-06-01").state).toBeNull();
  });
  it("cancelled only with an explicit cancellation in effect", () => {
    const cancellation = { at: "2026-05-01T09:00:00Z", evidence: { ...EV, kind: "cancellation" as const, label: "Cancelled" } };
    expect(periodCover(P("a", "2026-01-01", "2026-12-31", { cancellation }), "2026-06-01").state).toBe("cancelled");
    expect(periodCover(P("a", "2026-01-01", "2026-12-31", { cancellation: { ...cancellation, at: "2026-07-01T09:00:00Z" } }), "2026-06-01").state).toBe("active");
    expect(periodCover(P("a", "2026-01-01", "2026-12-31"), "2026-06-01").state).not.toBe("cancelled");
  });
});

describe("the policy as a whole", () => {
  it("keeps every historical period and reads the current one", () => {
    const r = policyCover([P("old", "2024-01-01", "2024-12-31"), P("prior", "2025-01-01", "2025-12-31"), P("now", "2026-01-01", "2026-12-31")], "2026-06-01", null);
    expect(r).toMatchObject({ selectedPeriodId: "now", selection: "current", conflicts: [] });
    expect(r.cover.state).toBe("active");
  });
  it("a named historical period can be read without changing the policy's cover", () => {
    const r = policyCover([P("prior", "2025-01-01", "2025-12-31"), P("now", "2026-01-01", "2026-12-31")], "2026-06-01", "prior");
    expect(r).toMatchObject({ selectedPeriodId: "prior", selection: "requested" });
    expect(r.cover.state).toBe("active");
  });
  it("with only a future period: Confirmed, not active", () => {
    const r = policyCover([P("next", "2027-01-01", "2027-12-31")], "2026-06-01", null);
    expect(r).toMatchObject({ selection: "upcoming", cover: { state: "confirmed" } });
  });
  it("between an expired period and a future one, the upcoming verified period decides", () => {
    const r = policyCover([P("prior", "2025-01-01", "2025-12-31"), P("next", "2026-07-01", "2027-06-30")], "2026-06-01", null);
    expect(r.cover.state).toBe("confirmed");
  });
  it("an expired final period is expired", () => {
    expect(policyCover([P("a", "2024-01-01", "2024-12-31"), P("b", "2025-01-01", "2025-12-31")], "2026-06-01", null).cover.state).toBe("expired");
  });
  it("a legacy policy is never called active", () => {
    const r = policyCover([legacy("a", "2026-01-01", "2026-12-31")], "2026-06-01", null);
    expect(r.cover).toMatchObject({ state: null, label: "Cover not verified" });
  });
  it("overlapping current periods are a conflict, and neither is chosen", () => {
    const r = policyCover([P("a", "2026-01-01", "2026-12-31"), P("b", "2026-03-01", "2027-02-28")], "2026-06-01", null);
    expect(r.selectedPeriodId).toBeNull();
    expect(r.selection).toBe("none");
    expect(r.cover).toMatchObject({ state: null, label: "Two periods both cover today" });
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: "overlapping_periods", periodIds: ["a", "b"] })]);
  });
  it("a person may still read one of the conflicting periods by naming it", () => {
    const r = policyCover([P("a", "2026-01-01", "2026-12-31"), P("b", "2026-03-01", "2027-02-28")], "2026-06-01", "b");
    expect(r).toMatchObject({ selectedPeriodId: "b", selection: "requested", cover: { state: null } });
  });
  it("overlap is found between any two periods, current or not", () => {
    expect(overlaps([{ id: "a", start: "2024-01-01", end: "2024-12-31" }, { id: "b", start: "2024-12-31", end: "2025-12-30" }, { id: "c", start: "2026-01-01", end: "2026-12-31" }]).get("a")).toEqual(["b"]);
  });
  it("no period at all says so", () => {
    expect(policyCover([], "2026-06-01", null).cover.label).toBe("No period on file");
  });
});
