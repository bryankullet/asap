/**
 * Working out what an unfamiliar column heading means (D-071).
 *
 * The boundary this file exists to hold: **the model maps headings and never touches a value.**
 * It is given the column names alone, its answer is checked against the enum before it is used,
 * and what it chose is shown on the preview for a person to correct. A heading it gets wrong is
 * visible and reversible; a value it invented would not be (§45 rules 8 and 9).
 */
import type { AiProvider, AiRequest } from "@asap/schema";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { mapColumnsIntelligently } from "../src/imports/map-columns.js";

const logger = pino({ level: "silent" });

/** A provider that answers with whatever is given, and records what it was asked. */
function provider(answer: unknown, seen: AiRequest[] = []): AiProvider {
  return {
    id: "fake",
    model: "test",
    complete: async (request) => {
      seen.push(request);
      return {
        text: JSON.stringify(answer),
        toolCalls: [],
        stop: "end",
        servedBy: { provider: "fake", model: "test" },
        usage: null,
      };
    },
  };
}

describe("what reaches the model", () => {
  it("is the headings, and only the ones the synonyms could not place", async () => {
    const seen: AiRequest[] = [];
    await mapColumnsIntelligently(
      ["Client Name", "Sum Ins.", "U/W"],
      provider({ "Sum Ins.": null, "U/W": "insurer_name" }, seen),
      logger,
    );
    const sent = JSON.parse(seen[0]!.messages[0]!.content as string);
    // "Client Name" is a heading the synonym table already knows, so it is not asked about.
    expect(sent.headings).toEqual(["Sum Ins.", "U/W"]);
    // Nothing but headings: no row, no cell, no value of any kind.
    expect(JSON.stringify(sent)).not.toMatch(/\d{4}-\d{2}-\d{2}|KES|[0-9]{4,}/);
  });

  it("is not asked at all when the synonyms placed everything", async () => {
    const seen: AiRequest[] = [];
    const out = await mapColumnsIntelligently(
      ["Client Name", "Policy No", "Insurer"],
      provider({}, seen),
      logger,
    );
    expect(seen).toHaveLength(0);
    expect(out["Policy No"]).toBe("policy_number");
  });
});

describe("what it is allowed to decide", () => {
  it("takes a mapping the enum recognises", async () => {
    const out = await mapColumnsIntelligently(
      ["Client Name", "U/W"],
      provider({ "U/W": "insurer_name" }),
      logger,
    );
    expect(out["U/W"]).toBe("insurer_name");
  });

  it("ignores a meaning that is not on the list", async () => {
    const out = await mapColumnsIntelligently(
      ["Client Name", "Branch"],
      provider({ Branch: "branch_code" }),
      logger,
    );
    expect(out["Branch"]).toBeNull();
  });

  it("ignores a heading it was never asked about", async () => {
    // A model that answered about a column the synonyms had already settled must not override it.
    const out = await mapColumnsIntelligently(
      ["Client Name", "Branch"],
      provider({ "Client Name": "policy_number", Branch: null }),
      logger,
    );
    expect(out["Client Name"]).toBe("client_name");
  });

  it("never maps two headings onto the same meaning", async () => {
    const out = await mapColumnsIntelligently(
      ["Cover From", "Effective"],
      provider({ "Cover From": "period_start", Effective: "period_start" }),
      logger,
    );
    const starts = Object.values(out).filter((m) => m === "period_start");
    expect(starts).toHaveLength(1);
  });

  it("cannot claim a meaning the synonyms already took", async () => {
    const out = await mapColumnsIntelligently(
      ["Client Name", "Account"],
      provider({ Account: "client_name" }),
      logger,
    );
    expect(out["Client Name"]).toBe("client_name");
    expect(out["Account"]).toBeNull();
  });
});

describe("when the model is absent or unhelpful", () => {
  it("falls back to the synonyms rather than failing the import", async () => {
    const out = await mapColumnsIntelligently(["Client Name", "Sum Ins."], null, logger);
    expect(out["Client Name"]).toBe("client_name");
    expect(out["Sum Ins."]).toBeNull();
  });

  it("survives a provider that throws", async () => {
    const angry: AiProvider = {
      id: "fake",
      model: "test",
      complete: () => Promise.reject(new Error("unavailable")),
    };
    const out = await mapColumnsIntelligently(["Client Name", "Sum Ins."], angry, logger);
    expect(out["Client Name"]).toBe("client_name");
  });

  it("survives a reply that is not JSON", async () => {
    const chatty: AiProvider = {
      id: "fake",
      model: "test",
      complete: async () => ({
        text: "I think Sum Ins. is the sum insured!",
        toolCalls: [],
        stop: "end" as const,
        servedBy: { provider: "fake" as const, model: "test" },
        usage: null,
      }),
    };
    const out = await mapColumnsIntelligently(["Client Name", "Sum Ins."], chatty, logger);
    expect(out["Sum Ins."]).toBeNull();
  });

  it("reads a reply wrapped in prose or a code fence", async () => {
    const fenced: AiProvider = {
      id: "fake",
      model: "test",
      complete: async () => ({
        text: 'Here you go:\n```json\n{"U/W": "insurer_name"}\n```',
        toolCalls: [],
        stop: "end" as const,
        servedBy: { provider: "fake" as const, model: "test" },
        usage: null,
      }),
    };
    const out = await mapColumnsIntelligently(["Client Name", "U/W"], fenced, logger);
    expect(out["U/W"]).toBe("insurer_name");
  });
});
