import {
  AiGatewayError,
  type AiMessage,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from "@asap/schema";

/**
 * The Anthropic adapter — the sibling the gateway was designed for (§45 rule 3).
 *
 * It is the only file in the repository that knows Anthropic's wire format, exactly as
 * `openai.ts` is the only one that knows OpenAI's. Everything above both speaks
 * `AiRequest`/`AiResponse`, so which one serves a question is a configuration value and nothing
 * in the intent router, the declared tools, the conversation model or the renderer moves.
 *
 * Raw HTTP rather than the SDK, matching the sibling adapter and for the same stated reason: the
 * surface used here is a handful of fields wide, and a dependency that can reach the network from
 * inside the API is worth not having.
 *
 * The model is never hardcoded. It comes from `AI_MODEL`, server-side, so it can be changed
 * without a deploy and is never visible to the browser.
 *
 * `thinking` is deliberately not sent. On the current Claude models it is on by default and the
 * right depth is the model's to choose; sending an explicit configuration would also be wrong for
 * whichever model `AI_MODEL` happens to name, and this adapter does not get to assume one.
 */
export function anthropicProvider(config: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Overridable so tests can point at a local stand-in; never set from a request. */
  baseUrl?: string;
}): AiProvider {
  const base = config.baseUrl ?? "https://api.anthropic.com/v1";

  return {
    id: "anthropic",
    model: config.model,

    async complete(request: AiRequest): Promise<AiResponse> {
      const body: Record<string, unknown> = {
        model: config.model,
        // Required by this API, unlike OpenAI's, where it is optional.
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
      };
      if (request.tools.length > 0) {
        // A tool is declared flat here — name, description, schema — with no function wrapper.
        body["tools"] = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      }
      if (request.responseSchema) {
        // We ask for a schema-shaped reply; we validate it ourselves regardless, because a
        // provider's guarantee is not our guarantee.
        body["output_config"] = {
          format: { type: "json_schema", schema: request.responseSchema },
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${base}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        throw new AiGatewayError(
          "unavailable",
          "The model could not be reached.",
          e instanceof Error ? e.name : undefined,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        // The status is enough for the caller to choose a state. The body is not logged: a
        // provider error can echo the prompt, and the prompt carries brokerage data.
        throw new AiGatewayError(
          res.status === 429 || res.status >= 500 ? "unavailable" : "invalid_output",
          "The model returned an error.",
          `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as {
        content?: (
          | { type: "text"; text?: string }
          | { type: "tool_use"; id?: string; name?: string; input?: unknown }
          | { type: string }
        )[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const blocks = json.content;
      if (!Array.isArray(blocks)) {
        throw new AiGatewayError("invalid_output", "The model returned nothing usable.");
      }

      /*
       * A refusal is not something to route around. Ask abstains and says so — the same rule the
       * OpenAI adapter holds, reached by a different signal: here it is a stop reason rather than
       * a field on the message.
       */
      if (json.stop_reason === "refusal") {
        throw new AiGatewayError("refused", "The model declined to answer.");
      }

      // Text arrives as blocks, and a reply may carry several. Joining them is the whole of it;
      // thinking blocks, when a model emits them, are not part of the answer and are skipped.
      const text = blocks
        .filter((b): b is { type: "text"; text?: string } => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");

      const toolCalls = blocks
        .filter(
          (b): b is { type: "tool_use"; id?: string; name?: string; input?: unknown } =>
            b.type === "tool_use",
        )
        .map((b) => ({
          id: b.id ?? "",
          name: b.name ?? "",
          // Already an object on the wire — no JSON string to parse, and so nothing to mis-parse.
          arguments:
            b.input && typeof b.input === "object" && !Array.isArray(b.input)
              ? (b.input as Record<string, unknown>)
              : {},
        }))
        .filter((t) => t.id !== "" && t.name !== "");

      return {
        text,
        toolCalls,
        stop:
          toolCalls.length > 0
            ? "tool_use"
            : json.stop_reason === "max_tokens"
              ? "max_tokens"
              : "end",
        servedBy: { provider: "anthropic", model: config.model },
        usage: json.usage
          ? {
              inputTokens: json.usage.input_tokens ?? 0,
              outputTokens: json.usage.output_tokens ?? 0,
            }
          : null,
      };
    },
  };
}

/**
 * Our neutral messages, in Anthropic's vocabulary.
 *
 * Two things this function exists to get right:
 *
 *  - **A tool result is a `user` message here**, not a role of its own, carrying `tool_result`
 *    content blocks.
 *  - **Consecutive tool results are merged into one message.** When the model asks for several
 *    tools at once, every result must come back in a single user turn. Splitting them across
 *    separate messages teaches the model to stop asking for tools in parallel, which costs a round
 *    trip per tool on every later question.
 */
function toAnthropicMessages(messages: AiMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let pendingResults: Record<string, unknown>[] = [];

  const flush = () => {
    if (pendingResults.length > 0) {
      out.push({ role: "user", content: pendingResults });
      pendingResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === "tool_result") {
      pendingResults.push({
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      });
      continue;
    }
    flush();
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    const content: Record<string, unknown>[] = [];
    if (m.content) content.push({ type: "text", text: m.content });
    for (const t of m.toolCalls) {
      content.push({ type: "tool_use", id: t.id, name: t.name, input: t.arguments });
    }
    // An assistant turn with neither text nor a tool call has nothing to say and is dropped
    // rather than sent as an empty content array, which this API rejects.
    if (content.length > 0) out.push({ role: "assistant", content });
  }
  flush();
  return out;
}
