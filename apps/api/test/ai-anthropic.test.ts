/**
 * The Anthropic adapter's half of the gateway contract (§45 rule 3).
 *
 * Every case runs against a stubbed `fetch`. Nothing here reaches a model: a test that called a
 * provider would be uncontrolled external communication (§45 rule 13), would cost money, and would
 * fail for reasons that are not this code's.
 *
 * What these lock:
 *   - the wire shape this API actually expects, which differs from the sibling adapter's;
 *   - that parallel tool results come back in **one** user turn;
 *   - that a refusal abstains rather than being routed around;
 *   - that a key never reaches an error, a message or a log.
 */
import { AiGatewayError } from "@asap/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "../src/ai/providers/anthropic.js";

const KEY = "test-key-never-real";
const provider = anthropicProvider({
  apiKey: KEY,
  model: "claude-opus-5",
  timeoutMs: 1000,
  baseUrl: "https://stub.invalid/v1",
});

/** The last request body the adapter sent, parsed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sent: any = null;

function stubFetch(response: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    sent = JSON.parse(String((init as RequestInit).body));
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const textReply = {
  content: [{ type: "text", text: "Two policies expire this month." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 120, output_tokens: 9 },
};

afterEach(() => {
  vi.restoreAllMocks();
  sent = null;
});

describe("the request it builds", () => {
  it("sends the key as x-api-key with a pinned api version", async () => {
    const spy = stubFetch(textReply);
    await provider.complete({
      system: "You are ASAP.",
      messages: [{ role: "user", content: "What expires this month?" }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 2048,
    });
    const headers = (spy.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // Not the sibling adapter's scheme: an Authorization header here would simply not authenticate.
    expect(headers["Authorization"]).toBeUndefined();
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://stub.invalid/v1/messages");
  });

  it("puts the system prompt at the top level and requires a token ceiling", async () => {
    stubFetch(textReply);
    await provider.complete({
      system: "You are ASAP.",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 2048,
    });
    expect(sent.system).toBe("You are ASAP.");
    expect(sent.max_tokens).toBe(2048);
    // Thinking is the model's to choose; sending a configuration would be wrong for some models.
    expect(sent.thinking).toBeUndefined();
  });

  it("declares a tool flat — a name, a description and its schema", async () => {
    stubFetch(textReply);
    await provider.complete({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [
        {
          name: "find_clients",
          description: "Find clients by name.",
          inputSchema: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(sent.tools).toEqual([
      {
        name: "find_clients",
        description: "Find clients by name.",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    // No function wrapper: that is the other provider's shape and is rejected here.
    expect(sent.tools[0].function).toBeUndefined();
  });

  it("asks for a schema-shaped reply through output_config", async () => {
    stubFetch(textReply);
    await provider.complete({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      responseSchema: { type: "object", properties: {} },
      maxOutputTokens: 1024,
    });
    expect(sent.output_config).toEqual({
      format: { type: "json_schema", schema: { type: "object", properties: {} } },
    });
  });
});

describe("how it carries a tool round trip", () => {
  it("returns every parallel tool result in one user turn", async () => {
    stubFetch(textReply);
    await provider.complete({
      system: "s",
      messages: [
        { role: "user", content: "What needs me?" },
        {
          role: "assistant",
          content: "Looking.",
          toolCalls: [
            { id: "toolu_1", name: "find_work", arguments: { view: "needs" } },
            { id: "toolu_2", name: "get_runs", arguments: {} },
          ],
        },
        { role: "tool_result", toolCallId: "toolu_1", content: '{"items":[]}', isError: false },
        { role: "tool_result", toolCallId: "toolu_2", content: '{"runs":[]}', isError: false },
      ],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });

    // user question, assistant turn, then ONE user turn holding both results — not two.
    expect(sent.messages).toHaveLength(3);
    const results = sent.messages[2];
    expect(results.role).toBe("user");
    expect(results.content).toHaveLength(2);
    expect(results.content.map((c: { tool_use_id: string }) => c.tool_use_id)).toEqual([
      "toolu_1",
      "toolu_2",
    ]);
    expect(results.content[0].type).toBe("tool_result");
  });

  it("sends an assistant turn's text and tool calls as content blocks", async () => {
    stubFetch(textReply);
    await provider.complete({
      system: "s",
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "Checking.",
          toolCalls: [{ id: "toolu_1", name: "find_clients", arguments: { q: "Acme" } }],
        },
        { role: "tool_result", toolCallId: "toolu_1", content: "{}", isError: false },
      ],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(sent.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "toolu_1", name: "find_clients", input: { q: "Acme" } },
      ],
    });
  });

  it("marks a failed tool result as an error rather than dropping it", async () => {
    stubFetch(textReply);
    await provider.complete({
      system: "s",
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "toolu_1", name: "find_clients", arguments: {} }],
        },
        { role: "tool_result", toolCallId: "toolu_1", content: "not permitted", isError: true },
      ],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(sent.messages[2].content[0].is_error).toBe(true);
  });
});

describe("what it makes of the reply", () => {
  it("joins text blocks and reports what served it", async () => {
    stubFetch({
      content: [
        { type: "text", text: "Two policies expire" },
        { type: "text", text: " this month." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 4 },
    });
    const res = await provider.complete({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(res.text).toBe("Two policies expire this month.");
    expect(res.stop).toBe("end");
    expect(res.servedBy).toEqual({ provider: "anthropic", model: "claude-opus-5" });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("reads tool calls, whose arguments arrive as an object rather than a string", async () => {
    stubFetch({
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "toolu_9", name: "find_clients", input: { q: "Tamarind" } },
      ],
      stop_reason: "tool_use",
    });
    const res = await provider.complete({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(res.stop).toBe("tool_use");
    expect(res.toolCalls).toEqual([
      { id: "toolu_9", name: "find_clients", arguments: { q: "Tamarind" } },
    ]);
  });

  it("skips block types that are not the answer", async () => {
    stubFetch({
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "The answer." },
      ],
      stop_reason: "end_turn",
    });
    const res = await provider.complete({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(res.text).toBe("The answer.");
  });

  it("abstains on a refusal rather than routing around it", async () => {
    stubFetch({ content: [], stop_reason: "refusal" });
    await expect(
      provider.complete({
        system: "s",
        messages: [{ role: "user", content: "q" }],
        tools: [],
        responseSchema: null,
        maxOutputTokens: 1024,
      }),
    ).rejects.toMatchObject({ failure: "refused" });
  });

  it("says a truncated answer was truncated", async () => {
    stubFetch({ content: [{ type: "text", text: "part" }], stop_reason: "max_tokens" });
    const res = await provider.complete({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      responseSchema: null,
      maxOutputTokens: 1024,
    });
    expect(res.stop).toBe("max_tokens");
  });
});

describe("when it goes wrong", () => {
  it("treats rate limits and server errors as unavailable, and says nothing about the body", async () => {
    stubFetch({ error: { message: `the prompt echoed back, with the key ${KEY}` } }, 500);
    const err = await provider
      .complete({
        system: "s",
        messages: [{ role: "user", content: "q" }],
        tools: [],
        responseSchema: null,
        maxOutputTokens: 1024,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiGatewayError);
    expect((err as AiGatewayError).failure).toBe("unavailable");
    // A provider error can echo the prompt, and the prompt carries brokerage data.
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(`${(err as Error).message} ${(err as AiGatewayError).detail}`).not.toContain(KEY);
  });

  it("treats a rejected request as a request defect, not as unusable output or an outage", async () => {
    stubFetch({ error: { message: "bad request" } }, 400);
    await expect(
      provider.complete({
        system: "s",
        messages: [{ role: "user", content: "q" }],
        tools: [],
        responseSchema: null,
        maxOutputTokens: 1024,
      }),
    ).rejects.toMatchObject({ failure: "invalid_request" });
  });

  it("keeps Anthropic's validation message structurally, with quoted content removed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: `output_config.format.schema: For 'array' type, property 'maxItems' is not supported; saw "Tausi Hauliers owes 1,200,000" ${KEY}` } }), { status: 400, headers: { "request-id": "req_x" } }),
    );
    const err = (await provider.complete({ system: "s", messages: [{ role: "user", content: "q" }], tools: [], responseSchema: null, maxOutputTokens: 64 }).catch((e: unknown) => e)) as AiGatewayError;
    expect(err.failure).toBe("invalid_request");
    expect(err.detail).toContain("output_config.format.schema: For … type, property … is not supported");
    expect(err.detail).toContain("request req_x");
    expect(err.detail).not.toContain("Tausi");
    expect(err.detail).not.toContain(KEY);
  });

  it("keeps invalid_output for an HTTP 200 reply ASAP cannot use", async () => {
    stubFetch({ stop_reason: "end_turn" });
    await expect(provider.complete({ system: "s", messages: [{ role: "user", content: "q" }], tools: [], responseSchema: null, maxOutputTokens: 64 })).rejects.toMatchObject({ failure: "invalid_output" });
  });

  it("reports an unreachable model as unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(
      provider.complete({
        system: "s",
        messages: [{ role: "user", content: "q" }],
        tools: [],
        responseSchema: null,
        maxOutputTokens: 1024,
      }),
    ).rejects.toMatchObject({ failure: "unavailable" });
  });
});

describe("each failure keeps its own name", () => {
  const ask = () =>
    provider.complete({ system: "s", messages: [{ role: "user", content: "q" }], tools: [], responseSchema: null, maxOutputTokens: 64 });
  const reply = (status: number, error: { type: string; message: string }, requestId = "req_test_1") =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ type: "error", error }), { status, headers: { "Content-Type": "application/json", "request-id": requestId } }),
    );

  it("a rejected key is an authentication failure, never 'not configured'", async () => {
    reply(401, { type: "authentication_error", message: `invalid x-api-key ${KEY}` });
    const err = (await ask().catch((e: unknown) => e)) as AiGatewayError;
    expect(err.failure).toBe("auth_rejected");
    expect(err.detail).toBe("HTTP 401 authentication_error request req_test_1");
    expect(`${err.message} ${err.detail} ${JSON.stringify(err)}`).not.toContain(KEY);
  });

  it("an unknown or forbidden model is a model failure", async () => {
    reply(404, { type: "not_found_error", message: "model: claude-nonexistent" });
    await expect(ask()).rejects.toMatchObject({ failure: "model_unavailable" });
  });

  it("an account without credit is a billing failure", async () => {
    reply(400, { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." });
    await expect(ask()).rejects.toMatchObject({ failure: "billing" });
  });

  it("rate limits, overload and timeouts stay distinct", async () => {
    reply(429, { type: "rate_limit_error", message: "slow down" });
    await expect(ask()).rejects.toMatchObject({ failure: "rate_limited" });
    vi.restoreAllMocks();
    reply(529, { type: "overloaded_error", message: "busy" });
    await expect(ask()).rejects.toMatchObject({ failure: "unavailable" });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(ask()).rejects.toMatchObject({ failure: "timeout" });
  });
});
