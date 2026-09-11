import { z } from "zod";

/**
 * The AI gateway contract — provider-neutral by construction (§45 rule 3: never tie retrieval or
 * routing to a single model vendor).
 *
 * Nothing above this file knows which provider is configured. The intent router, the declared
 * tools, the conversation model, the plan validator and the renderer all speak these types, so
 * adding a provider is one adapter and a config value, and removing one changes nothing else.
 *
 * What the gateway is **not** allowed to become: a way for a model to reach the database. It
 * takes messages and tool *declarations*, and it returns text and tool *requests*. Every tool is
 * executed by our own code, under the caller's RLS, with the arguments validated first.
 */

/**
 * Which provider serves a request. Chosen by server-side configuration, never by the browser.
 *
 * `openai` is the first production adapter. `anthropic` is listed because the whole point of this
 * file is that adding it is one adapter and one config value — nothing above the gateway changes.
 * `fake` is deterministic and is what the tests and the evaluation set run against.
 */
export const AiProviderId = z.enum(["openai", "anthropic", "fake"]);
export type AiProviderId = z.infer<typeof AiProviderId>;

/** A message in a provider-neutral shape. Tool traffic is explicit, not smuggled in text. */
export const aiMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    /** Tools the model asked for on this turn. */
    toolCalls: z
      .array(z.object({ id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
      .default([]),
  }),
  z.object({
    role: z.literal("tool_result"),
    toolCallId: z.string(),
    /** What our code returned. Always JSON we produced, never model text. */
    content: z.string(),
    isError: z.boolean().default(false),
  }),
]);
export type AiMessage = z.infer<typeof aiMessageSchema>;

/** A tool as *declared* to the model: a name, a description and a JSON Schema. Never a function. */
export const aiToolDeclarationSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type AiToolDeclaration = z.infer<typeof aiToolDeclarationSchema>;

export const aiRequestSchema = z.object({
  system: z.string(),
  messages: z.array(aiMessageSchema).min(1),
  tools: z.array(aiToolDeclarationSchema).default([]),
  /**
   * A JSON Schema the reply must satisfy. The gateway asks the provider to honour it where the
   * provider can; the caller validates the result regardless, because a provider's guarantee is
   * not our guarantee.
   */
  responseSchema: z.record(z.string(), z.unknown()).nullable().default(null),
  maxOutputTokens: z.number().int().min(1).max(64_000).default(4096),
});
export type AiRequest = z.infer<typeof aiRequestSchema>;

export const aiResponseSchema = z.object({
  /** What the model said, as text. Never rendered as markup and never executed. */
  text: z.string(),
  toolCalls: z
    .array(z.object({ id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }))
    .default([]),
  /** `tool_use` means it wants a tool run and the caller should loop; `end` means it is done. */
  stop: z.enum(["end", "tool_use", "max_tokens", "refusal"]),
  /** Which provider and model actually served it, for the audit row and the evaluation set. */
  servedBy: z.object({ provider: AiProviderId, model: z.string() }),
  usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }).nullable(),
});
export type AiResponse = z.infer<typeof aiResponseSchema>;

/**
 * Why the gateway could not answer. Each maps to a state a person sees; none is ever rendered as
 * a confident empty answer, and none is retried silently against a different provider.
 */
export const AiFailure = z.enum([
  "not_configured", //   no provider credential on the server. The UI says so, honestly.
  "unavailable", //      the provider could not be reached or errored.
  "refused", //          the provider declined. Ask abstains; it does not try another way round.
  "invalid_output", //   the reply did not satisfy the schema after the allowed retries.
  "budget_exceeded", //  too many tool rounds for one question.
]);
export type AiFailure = z.infer<typeof AiFailure>;

export class AiGatewayError extends Error {
  constructor(
    readonly failure: AiFailure,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

/** Every provider adapter implements exactly this. Nothing else in the system may talk to a model. */
export type AiProvider = {
  readonly id: AiProviderId;
  /** The model this adapter is configured with. Server-side configuration, never hardcoded. */
  readonly model: string;
  complete(request: AiRequest): Promise<AiResponse>;
};
