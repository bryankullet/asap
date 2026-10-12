/**
 * Ask ASAP inside a workspace (D-165, §45 rule 11), over docs/evaluation/workspace-requests.json.
 *
 * Offline, every run: the rules' accuracy on the requests they should read (intent and target), and
 * that every request to act, to decide cover or to choose an insurer is refused — never read.
 * The model path (used only where the rules find nothing) needs a real model: set
 * WORKSPACE_EVAL_LIVE=1 with the gateway configured, and the same fixture is measured end to end.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { serverEnvSchema } from "@asap/schema/env/server";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../src/ai/gateway.js";
import { interpretWorkspace, interpretWorkspaceRules, type WorkspaceKind, type WorkspaceVocabulary } from "../../src/living/ask-workspace.js";

type Case = { id: string; kind: WorkspaceKind; text: string; intent?: string; target?: string | null; abstain?: boolean };
const fixture = JSON.parse(readFileSync(new URL("../../../../docs/evaluation/workspace-requests.json", import.meta.url), "utf8")) as { vocab: { insurers: string[]; terms: string[]; documents: string[] }; cases: Case[] };
const vocab: WorkspaceVocabulary = { insurers: fixture.vocab.insurers.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, name })), terms: fixture.vocab.terms, documents: fixture.vocab.documents };

function grade(c: Case, got: { focus: { intent: string; target: string | null } | null }) {
  if (c.abstain) return got.focus === null;
  return got.focus?.intent === c.intent && (got.focus?.target ?? null) === (c.target ?? null);
}

describe("workspace requests — rules (offline)", () => {
  const rows = fixture.cases.map((c) => ({ c, got: interpretWorkspaceRules(c.text, c.kind, vocab) }));
  const readable = rows.filter((r) => !r.c.abstain);
  const correct = readable.filter((r) => grade(r.c, r.got));
  const refused = rows.filter((r) => r.c.abstain);
  it("reads at least 95% of the requests it should, intent and target both right", () => {
    const wrong = readable.filter((r) => !grade(r.c, r.got)).map((r) => `${r.c.id} "${r.c.text}" → ${JSON.stringify(r.got.focus)}`);
    writeFileSync(new URL("../../../../docs/evaluation/workspace-requests.last-run.json", import.meta.url), `${JSON.stringify({ accuracy: correct.length / readable.length, readable: readable.length, wrong }, null, 1)}\n`);
    expect(correct.length / readable.length, wrong.join("\n")).toBeGreaterThanOrEqual(0.95);
  });
  it("refuses every request to act, to decide cover or to choose an insurer, saying why", () => {
    for (const r of refused) {
      expect(r.got.focus, `${r.c.id} "${r.c.text}"`).toBeNull();
      expect(r.got.unclear, r.c.id).toBeTruthy();
    }
  });
  it("only ever targets a name from the record", () => {
    const names = new Set([...fixture.vocab.insurers, ...fixture.vocab.terms, ...fixture.vocab.documents]);
    for (const r of rows) if (r.got.focus?.target) expect(names.has(r.got.focus.target), r.c.id).toBe(true);
  });
});

describe.skipIf(!process.env["WORKSPACE_EVAL_LIVE"])("workspace requests — through the gateway (live)", () => {
  it("rules, then the model, still reads ≥ 95% and refuses every action, cover or choice request", async () => {
    const env = serverEnvSchema.parse(process.env);
    const provider = resolveProvider(env, pino({ level: "silent" }));
    expect(provider).not.toBeNull();
    const rows = await Promise.all(fixture.cases.map(async (c) => ({ c, got: await interpretWorkspace(c.text, c.kind, vocab, provider, pino({ level: "silent" })) })));
    const readable = rows.filter((r) => !r.c.abstain);
    expect(readable.filter((r) => grade(r.c, r.got)).length / readable.length).toBeGreaterThanOrEqual(0.95);
    for (const r of rows.filter((x) => x.c.abstain)) expect(r.got.focus, r.c.id).toBeNull();
  });
});
