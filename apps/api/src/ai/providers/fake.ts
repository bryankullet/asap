import type { AiProvider, AiRequest, AiResponse } from "@asap/schema";

/**
 * The deterministic provider. Same input, same output, every time, with no network.
 *
 * This is what the tests and the evaluation set run against, and it is not a toy: it exercises
 * exactly the same path as a real provider — the same tool loop, the same schema validation, the
 * same plan validator, the same citation rules. A test that passes here proves the *harness* is
 * right, which is the part we own. Whether a particular model chooses well is what the evaluation
 * fixtures measure, and they run against whichever provider is configured.
 *
 * It is scripted by matching the last question, not by understanding it. That is the point: a
 * fake that reasoned would hide harness bugs behind its own cleverness.
 */
export type FakeScript = {
  /** Matched against the most recent user message, case-insensitively. */
  match: RegExp;
  /** Returned when nothing has been run yet. A tool call makes the caller loop. */
  reply: Omit<AiResponse, "servedBy" | "usage">;
  /** Returned after the tool results come back, if the first reply asked for a tool. */
  then?: Omit<AiResponse, "servedBy" | "usage">;
}[];

export function fakeProvider(script: FakeScript = [], model = "fake-deterministic"): AiProvider {
  return {
    id: "fake",
    model,
    async complete(request: AiRequest): Promise<AiResponse> {
      const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
      const question = lastUser && lastUser.role === "user" ? lastUser.content : "";
      const hasToolResults = request.messages.some((m) => m.role === "tool_result");
      const entry = script.find((s) => s.match.test(question));

      const base = { servedBy: { provider: "fake" as const, model }, usage: null };
      if (!entry) {
        // No script matched. Saying so is the honest default; inventing an answer is not.
        return {
          ...base,
          text: "",
          toolCalls: [],
          stop: "end",
        };
      }
      const chosen = hasToolResults && entry.then ? entry.then : entry.reply;
      return { ...base, ...chosen };
    },
  };
}
