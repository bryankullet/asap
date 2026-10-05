/**
 * The inbound routing evaluation (D-144, §45 rule 11), over docs/evaluation/inbound-routing.json:
 * a fixed world of live runs and 36 Kenyan broker emails, each with its true kind and the run it
 * belongs to.
 *
 * Measured here, with no network:
 *  - routing precision: of the emails ASAP routes by itself at the default threshold, how many
 *    went to the right run — with the classifier's kind taken as given (each email's true kind at
 *    0.95), so this measures the matcher and the decision rule, which are ours;
 *  - coverage: how many of the emails that belong to a run were routed without a person;
 *  - abstention: with no model, nothing is routed at all.
 * Classification accuracy needs a real model: set INBOUND_EVAL_LIVE=1 with the gateway configured
 * (AI_DEFAULT_PROVIDER, AI_MODEL and the key) and it is measured through the gateway, end to end.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { InboundKind } from "@asap/schema";
import { serverEnvSchema } from "@asap/schema/env/server";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { classifyEmail, tieBreak } from "../../src/inbound/classify.js";
import { resolveProvider } from "../../src/ai/gateway.js";
import { decideRoute, matchCandidates, type RunSnapshot } from "../../src/inbound/match.js";
import { AUTO_ROUTE_DEFAULT } from "../../src/inbound/router.js";

type Fixture = { id: string; kind: InboundKind; expectedRun: string | null; from: string; subject: string; body: string };
const world = JSON.parse(readFileSync(new URL("../../../../docs/evaluation/inbound-routing.json", import.meta.url), "utf8")) as { runs: RunSnapshot[]; emails: Fixture[] };
const logger = pino({ level: "silent" });

function score(decide: (f: Fixture) => Promise<string | null> | string | null) {
  return Promise.all(world.emails.map(async (f) => ({ f, routed: await decide(f) }))).then((rows) => {
    const routed = rows.filter((r) => r.routed);
    const correct = routed.filter((r) => r.routed === r.f.expectedRun);
    const belonging = rows.filter((r) => r.f.expectedRun);
    return {
      total: rows.length,
      routed: routed.length,
      correct: correct.length,
      precision: routed.length ? correct.length / routed.length : 1,
      coverage: belonging.length ? correct.length / belonging.length : 0,
      wrong: routed.filter((r) => r.routed !== r.f.expectedRun).map((r) => r.f.id),
      missed: belonging.filter((r) => !r.routed).map((r) => r.f.id),
    };
  });
}

describe("inbound routing evaluation", () => {
  it("has at least 30 fixtures covering every kind", () => {
    expect(world.emails.length).toBeGreaterThanOrEqual(30);
    expect(new Set(world.emails.map((e) => e.kind))).toEqual(new Set(InboundKind.options));
  });

  it(`routes with precision ≥ 0.95 at the default threshold (${AUTO_ROUTE_DEFAULT.threshold})`, async () => {
    const r = await score((f) => {
      const email = { from: f.from, subject: f.subject, body: f.body, threadWorkItemId: null };
      return decideRoute({ source: "model", confidence: 0.95, threshold: AUTO_ROUTE_DEFAULT.threshold, candidates: matchCandidates(email, f.kind, world.runs), tieBreak: null }).route;
    });
    writeFileSync(new URL("../../../../docs/evaluation/inbound-routing-results.json", import.meta.url), JSON.stringify({ mode: "kind given at 0.95; no tie-break model", threshold: AUTO_ROUTE_DEFAULT.threshold, ...r }, null, 1) + "\n");
    expect(r.wrong).toEqual([]);
    expect(r.precision).toBeGreaterThanOrEqual(0.95);
    expect(r.coverage).toBeGreaterThan(0.75);
  });

  it("below the threshold, and with no model, nothing is routed by itself", async () => {
    const below = await score((f) => decideRoute({ source: "model", confidence: 0.89, threshold: AUTO_ROUTE_DEFAULT.threshold, candidates: matchCandidates({ from: f.from, subject: f.subject, body: f.body, threadWorkItemId: null }, f.kind, world.runs), tieBreak: null }).route);
    const none = await score((f) => decideRoute({ source: "none", confidence: null, threshold: AUTO_ROUTE_DEFAULT.threshold, candidates: matchCandidates({ from: f.from, subject: f.subject, body: f.body, threadWorkItemId: null }, null, world.runs), tieBreak: null }).route);
    expect(below.routed).toBe(0);
    expect(none.routed).toBe(0);
  });

  it.runIf(process.env["INBOUND_EVAL_LIVE"] === "1")("live: classification accuracy and end-to-end precision through the configured gateway", async () => {
    const provider = resolveProvider(serverEnvSchema.parse(process.env), logger);
    expect(provider).not.toBeNull();
    let right = 0;
    const r = await score(async (f) => {
      const c = await classifyEmail(provider, logger, f);
      if (c?.kind === f.kind) right++;
      const email = { from: f.from, subject: f.subject, body: f.body, threadWorkItemId: null };
      const candidates = matchCandidates(email, c?.kind ?? null, world.runs);
      const tie = c && candidates.length > 1 ? await tieBreak(provider, logger, f, candidates) : null;
      return decideRoute({ source: c ? "model" : "none", confidence: c?.confidence ?? null, threshold: AUTO_ROUTE_DEFAULT.threshold, candidates, tieBreak: tie }).route;
    });
    writeFileSync(new URL("../../../../docs/evaluation/inbound-routing-results-live.json", import.meta.url), JSON.stringify({ accuracy: right / world.emails.length, ...r }, null, 1) + "\n");
    expect(r.precision).toBeGreaterThanOrEqual(0.95);
  });
});
