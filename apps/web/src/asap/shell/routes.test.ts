import { describe, expect, it } from "vitest";
import { parse, sameRef, surfaceForRef, toPath, type Surface } from "./routes.js";

const round = (s: Surface) => {
  const p = toPath(s);
  const [path, q] = p.split("?");
  return parse(path!, q ? `?${q}` : "");
};

describe("the address is the open surface (D-155)", () => {
  it("round-trips every surface", () => {
    const surfaces: Surface[] = [
      { mode: "home" },
      { mode: "work", view: "waiting" },
      { mode: "automations" },
      { mode: "activity", filter: { who: "asap" } },
      { mode: "conversation", conversationId: null, space: null },
      { mode: "conversation", conversationId: "c1", space: { ws: "client", clientId: "x" } },
      { mode: "space", ref: { ws: "quotecompare", documentIds: ["a", "b"], clientId: "x" }, drawer: "new" },
      { mode: "space", ref: { ws: "automation", automationId: "a1" }, drawer: null },
    ];
    for (const s of surfaces) expect(round(s)).toEqual(s);
  });
  it("Home, Work and Activity are surfaces, not Spaces", () => {
    expect(surfaceForRef({ ws: "today" })).toEqual({ mode: "home" });
    expect(surfaceForRef({ ws: "work", filter: { state: "x" } }).mode).toBe("work");
    expect(surfaceForRef({ ws: "client", clientId: "c" }).mode).toBe("space");
  });
  it("an old address opens Home, never a dead page", () => {
    expect(parse("/clients/123", "")).toEqual({ mode: "home" });
  });
  it("the same record is the same context, whatever was typed into it", () => {
    expect(sameRef({ ws: "client", clientId: "c", query: "x" }, { clientId: "c", ws: "client" })).toBe(true);
    expect(sameRef({ ws: "client", clientId: "c" }, { ws: "client", clientId: "d" })).toBe(false);
  });
});
