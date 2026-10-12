/**
 * The model-assisted path of Ask ASAP inside a workspace (D-165, D-169, §45 rules 8 and 11), over
 * docs/evaluation/workspace-model-fallback.json.
 *
 * Offline, every run: each "model" case really bypasses the deterministic rules (so a live run
 * measures the model, not the rules), and the grading itself is checked against a stand-in provider.
 * Live, only with WORKSPACE_MODEL_EVAL_LIVE=1 and the gateway configured (AI_DEFAULT_PROVIDER,
 * AI_MODEL and that provider's key): every case goes through interpretWorkspace — rules first, then
 * the real model — and intent and target accuracy, safe abstention, latency and provider failures
 * are measured and written to docs/evaluation/workspace-model-fallback.live-run.json. Nothing here
 * claims the model path passed unless real calls were made and counted.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { serverEnvSchema } from "@asap/schema/env/server";
import type { AiProvider } from "@asap/schema";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../src/ai/gateway.js";
import { interpretWorkspace, interpretWorkspaceRules, type WorkspaceKind, type WorkspaceVocabulary } from "../../src/living/ask-workspace.js";

type Case = {
  id: string; category: "model" | "ambiguous" | "guard"; kind: WorkspaceKind; text: string;
  intent?: string; target?: string | null; abstain?: boolean;
  acceptIntents?: string[]; acceptTargets?: (string | null)[]; acceptAbstain?: boolean;
};
type Got = { focus: { intent: string; target: string | null } | null };
const FILE = new URL("../../../../docs/evaluation/workspace-model-fallback.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FILE, "utf8")) as { vocab: { insurers: string[]; terms: string[]; documents: string[] }; cases: Case[] };
const vocab: WorkspaceVocabulary = { insurers: fixture.vocab.insurers.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, name })), terms: fixture.vocab.terms, documents: fixture.vocab.documents };
const names = new Set([...fixture.vocab.insurers, ...fixture.vocab.terms, ...fixture.vocab.documents]);
const log = pino({ level: "silent" });

/** One case's verdict: was the reading right, and was it safe? */
export function grade(c: Case, got: Got): { intentOk: boolean; targetOk: boolean; safe: boolean; abstained: boolean } {
  const abstained = got.focus === null;
  const targetInVocab = !got.focus?.target || names.has(got.focus.target);
  if (c.category === "guard" || c.abstain) return { intentOk: abstained, targetOk: abstained, safe: abstained && targetInVocab, abstained };
  if (c.category === "ambiguous") {
    const ok = abstained ? Boolean(c.acceptAbstain) : (c.acceptIntents ?? []).includes(got.focus!.intent);
    return { intentOk: ok, targetOk: ok, safe: targetInVocab, abstained };
  }
  const intents = c.acceptIntents ?? [c.intent!];
  const targets = c.acceptTargets ?? [c.target ?? null];
  const intentOk = !abstained && intents.includes(got.focus!.intent);
  return { intentOk, targetOk: intentOk && targets.includes(got.focus!.target ?? null), safe: targetInVocab, abstained };
}

describe("model fallback set — offline", () => {
  it("every 'model' case bypasses the rules and reaches the model", () => {
    const caught = fixture.cases.filter((c) => c.category === "model").map((c) => ({ c, r: interpretWorkspaceRules(c.text, c.kind, vocab) })).filter(({ r }) => r.focus !== null || r.source !== "none" || /does not|Asking does not|does not choose/.test(r.unclear ?? ""));
    expect(caught.map(({ c, r }) => `${c.id} "${c.text}" → ${JSON.stringify(r)}`)).toEqual([]);
  });
  it("covers each category a live run must measure", () => {
    const by = (k: string) => fixture.cases.filter((c) => c.category === k).length;
    expect(by("model")).toBeGreaterThanOrEqual(20);
    expect(by("ambiguous")).toBeGreaterThanOrEqual(4);
    expect(by("guard")).toBeGreaterThanOrEqual(8);
    for (const c of fixture.cases) if (c.target) expect(names.has(c.target), c.id).toBe(true);
  });
  it("grades a stand-in reading correctly, and never counts an out-of-record target as safe", async () => {
    const stand = (text: string): AiProvider => ({ id: "fake", model: "stand-in", complete: async () => ({ text, servedBy: { provider: "fake", model: "stand-in" } }) as never });
    const m1 = fixture.cases.find((c) => c.id === "m1")!;
    const right = await interpretWorkspace(m1.text, m1.kind, vocab, stand('{"intent":"compare_revisions","target":"Jubilee Allianz"}'), log);
    expect(grade(m1, right)).toMatchObject({ intentOk: true, targetOk: true, safe: true });
    const g2 = fixture.cases.find((c) => c.id === "g2")!;
    const injected = await interpretWorkspace(g2.text, g2.kind, vocab, stand(`{"intent":"explore","target":"'; DROP TABLE policies;--"}`), log);
    // The target is not a record name, so the interpreter drops it; explore without an insurer is no answer.
    expect(injected.focus).toBeNull();
    expect(grade(g2, injected).safe).toBe(true);
  });
});

describe.skipIf(!process.env["WORKSPACE_MODEL_EVAL_LIVE"])("model fallback set — live, through the AI gateway", () => {
  it("measures intent and target accuracy, safe abstention, latency and failures on real model calls", async () => {
    const env = serverEnvSchema.parse(process.env);
    const real = resolveProvider(env, log);
    expect(real, "the AI gateway is not configured: set AI_DEFAULT_PROVIDER, AI_MODEL and the provider's key").not.toBeNull();
    expect(real!.id, "a live evaluation must not use the deterministic stand-in").not.toBe("fake");
    // Count every real call, its latency and every failure (a thrown call or an unreadable reply).
    const calls: { ms: number; ok: boolean; error: string | null }[] = [];
    const counted: AiProvider = {
      ...real!,
      complete: async (req) => {
        const t = performance.now();
        try {
          const r = await real!.complete(req);
          const s = r.text.indexOf("{");
          let ok = s >= 0;
          try { if (ok) JSON.parse(r.text.slice(s, r.text.lastIndexOf("}") + 1)); } catch { ok = false; }
          calls.push({ ms: performance.now() - t, ok, error: ok ? null : "unreadable reply" });
          return r;
        } catch (e) {
          calls.push({ ms: performance.now() - t, ok: false, error: String((e as Error).message ?? e).slice(0, 200) });
          throw e;
        }
      },
    };
    const rows: { c: Case; got: Got; ms: number; v: ReturnType<typeof grade> }[] = [];
    for (const c of fixture.cases) {
      const t = performance.now();
      const got = await interpretWorkspace(c.text, c.kind, vocab, counted, log);
      rows.push({ c, got, ms: performance.now() - t, v: grade(c, got) });
    }
    const model = rows.filter((r) => r.c.category === "model");
    const guard = rows.filter((r) => r.c.category === "guard");
    const ambiguous = rows.filter((r) => r.c.category === "ambiguous");
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
    const lat = calls.map((x) => x.ms).sort((a, b) => a - b);
    const q = (p: number) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]!) : null);
    const report = {
      ranAt: new Date().toISOString(),
      provider: real!.id,
      model: env.AI_MODEL ?? null,
      cases: rows.length,
      modelCalls: calls.length,
      providerFailures: calls.filter((x) => !x.ok).length,
      failureSamples: calls.filter((x) => !x.ok).slice(0, 5).map((x) => x.error),
      latencyMs: { p50: q(0.5), p95: q(0.95), max: lat.length ? Math.round(lat[lat.length - 1]!) : null },
      model_path: { cases: model.length, intentAccuracy: pct(model.filter((r) => r.v.intentOk).length, model.length), targetAccuracy: pct(model.filter((r) => r.v.targetOk).length, model.length), abstained: model.filter((r) => r.v.abstained).length },
      ambiguous: { cases: ambiguous.length, acceptable: pct(ambiguous.filter((r) => r.v.intentOk).length, ambiguous.length) },
      guard: { cases: guard.length, safeAbstention: pct(guard.filter((r) => r.v.safe).length, guard.length), unsafe: guard.filter((r) => !r.v.safe).map((r) => ({ id: r.c.id, got: r.got.focus })) },
      outOfRecordTargets: rows.filter((r) => r.got.focus?.target && !names.has(r.got.focus.target)).length,
      wrong: model.filter((r) => !r.v.targetOk).map((r) => ({ id: r.c.id, text: r.c.text, expected: { intent: r.c.intent, target: r.c.target ?? null }, got: r.got.focus })),
    };
    writeFileSync(new URL("../../../../docs/evaluation/workspace-model-fallback.live-run.json", import.meta.url), `${JSON.stringify(report, null, 1)}\n`);
    // Real calls were made for the cases the rules do not read.
    expect(calls.length).toBeGreaterThanOrEqual(model.length);
    // Acceptance: every guard case abstains, no target outside the record, and the model path reads well.
    expect(report.guard.unsafe).toEqual([]);
    expect(report.outOfRecordTargets).toBe(0);
    expect(report.model_path.intentAccuracy!).toBeGreaterThanOrEqual(85);
    expect(report.model_path.targetAccuracy!).toBeGreaterThanOrEqual(80);
  }, 600_000);
});
