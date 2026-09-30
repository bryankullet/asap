import { afterEach, describe, expect, it, vi } from "vitest";
import { REPLY_JSON_SCHEMA } from "../src/ai/ask.js";
import { anthropicProvider } from "../src/ai/providers/anthropic.js";
import { TOOL_DECLARATIONS } from "../src/ai/tools/index.js";

/*
 * The exact body the production adapter sends for /ask, checked against Anthropic's documented
 * request rules. A live 400 (output_config.format.schema with `maxItems`) is what this locks out:
 * structured outputs accept neither numeric nor string nor array-size constraints, and every
 * object must close with additionalProperties: false.
 */
const UNSUPPORTED = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems", "uniqueItems"];

function violations(schema: unknown, path: string, out: string[] = []): string[] {
  if (!schema || typeof schema !== "object") return out;
  const o = schema as Record<string, unknown>;
  for (const k of UNSUPPORTED) if (k in o) out.push(`${path}.${k}`);
  if ("minItems" in o && o["minItems"] !== 0 && o["minItems"] !== 1) out.push(`${path}.minItems`);
  if (o["type"] === "object" && o["additionalProperties"] !== false) out.push(`${path}.additionalProperties`);
  if (Array.isArray(o["required"])) for (const r of o["required"] as string[]) if (!o["properties"] || !(r in (o["properties"] as object))) out.push(`${path}.required.${r}`);
  for (const [k, v] of Object.entries(o)) if (v && typeof v === "object") violations(v, `${path}.${k}`, out);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the captured wire body
let sent: any = null;
const provider = anthropicProvider({ apiKey: "test-key-never-real", model: "claude-opus-5", timeoutMs: 1000, baseUrl: "https://stub.invalid/v1" });
function capture() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
    sent = JSON.parse(String((init as RequestInit).body));
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }), { status: 200 });
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  sent = null;
});

describe("the Anthropic request /ask sends", () => {
  it("a minimal request is only model, max_tokens and one user message", async () => {
    capture();
    await provider.complete({ system: "", messages: [{ role: "user", content: "Say ok." }], tools: [], responseSchema: null, maxOutputTokens: 16 });
    expect(Object.keys(sent).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
    expect(sent.model).toBe("claude-opus-5");
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].role).toBe("user");
  });

  it("the full Ask request uses only supported fields, roles and schema keywords", async () => {
    capture();
    await provider.complete({ system: "You are ASAP.", messages: [{ role: "user", content: "q" }], tools: TOOL_DECLARATIONS, responseSchema: REPLY_JSON_SCHEMA, maxOutputTokens: 1200 });
    expect(Object.keys(sent).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system", "tools"]);
    expect(typeof sent.system).toBe("string");
    for (const m of sent.messages) expect(["user", "assistant"]).toContain(m.role);
    // No OpenAI-only fields.
    for (const k of ["response_format", "functions", "tool_choice", "temperature", "parallel_tool_calls"]) expect(sent).not.toHaveProperty(k);
    expect(violations(sent.output_config.format.schema, "output_config.format.schema")).toEqual([]);
    // Plain JSON only: nothing undefined, no functions.
    expect(JSON.parse(JSON.stringify(sent))).toEqual(sent);
  });

  it("every declared tool is Anthropic-compatible", () => {
    expect(TOOL_DECLARATIONS.length).toBeGreaterThan(0);
    for (const t of TOOL_DECLARATIONS) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.description.trim().length).toBeGreaterThan(0);
      expect((t.inputSchema as { type: string }).type).toBe("object");
      expect(violations(t.inputSchema, t.name).filter((v) => v.includes(".required."))).toEqual([]);
    }
  });
});
