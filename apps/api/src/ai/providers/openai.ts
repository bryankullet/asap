import {
  AiGatewayError,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from "@asap/schema";

/**
 * The OpenAI adapter — the first production provider.
 *
 * It is deliberately the only file in the repository that knows OpenAI's wire format. Everything
 * above it speaks `AiRequest`/`AiResponse` (§45 rule 3), so adding Anthropic is a sibling file and
 * one config value, and nothing in the intent router, the tools, the conversation model, the
 * evaluation set or the renderer moves.
 *
 * Raw HTTP rather than the SDK, for two reasons: the surface we use is four fields wide, and a
 * dependency that can reach the network from inside the API is worth not having.
 *
 * The model is never hardcoded. It comes from `AI_MODEL`, server-side, so it can be changed
 * without a deploy and is never visible to the browser.
 */
export function openAiProvider(config: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Overridable so tests can point at a local stand-in; never set from a request. */
  baseUrl?: string;
}): AiProvider {
  const base = config.baseUrl ?? "https://api.openai.com/v1";

  return {
    id: "openai",
    model: config.model,

    async complete(request: AiRequest): Promise<AiResponse> {
      // Our neutral message shape, in OpenAI's chat vocabulary. Tool traffic stays explicit.
      const messages: Record<string, unknown>[] = [{ role: "system", content: request.system }];
      for (const m of request.messages) {
        if (m.role === "user") messages.push({ role: "user", content: m.content });
        else if (m.role === "assistant") {
          messages.push({
            role: "assistant",
            content: m.content || null,
            ...(m.toolCalls.length > 0
              ? {
                  tool_calls: m.toolCalls.map((t) => ({
                    id: t.id,
                    type: "function",
                    function: { name: t.name, arguments: JSON.stringify(t.arguments) },
                  })),
                }
              : {}),
          });
        } else {
          messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
        }
      }

      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        max_completion_tokens: request.maxOutputTokens,
      };
      if (request.tools.length > 0) {
        body["tools"] = request.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }));
      }
      if (request.responseSchema) {
        // We ask for a schema-shaped reply; we validate it ourselves regardless, because a
        // provider's guarantee is not our guarantee.
        body["response_format"] = {
          type: "json_schema",
          json_schema: { name: "ui_plan", strict: true, schema: request.responseSchema },
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
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
        choices?: {
          message?: {
            content?: string | null;
            refusal?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
          finish_reason?: string;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      if (!choice?.message) {
        throw new AiGatewayError("invalid_output", "The model returned nothing usable.");
      }
      if (choice.message.refusal) {
        // A refusal is not something to route around. Ask abstains and says so.
        throw new AiGatewayError("refused", "The model declined to answer.");
      }

      const toolCalls = (choice.message.tool_calls ?? []).map((t) => {
        let args: Record<string, unknown> = {};
        try {
          // Never string-match a tool argument: escaping varies between models.
          const parsed: unknown = JSON.parse(t.function.arguments || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          // Unparseable arguments are dropped rather than guessed at; the tool's own schema
          // validation would reject them anyway, and an empty object fails it honestly.
        }
        return { id: t.id, name: t.function.name, arguments: args };
      });

      const finish = choice.finish_reason ?? "stop";
      return {
        text: choice.message.content ?? "",
        toolCalls,
        stop:
          toolCalls.length > 0
            ? "tool_use"
            : finish === "length"
              ? "max_tokens"
              : finish === "content_filter"
                ? "refusal"
                : "end",
        servedBy: { provider: "openai", model: config.model },
        usage: json.usage
          ? {
              inputTokens: json.usage.prompt_tokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
            }
          : null,
      };
    },
  };
}
