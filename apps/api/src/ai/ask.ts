import {
  AiGatewayError,
  AskComponentId,
  UiIntent,
  type AiMessage,
  type AiProvider,
  type UiIntent as UiIntentT,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Logger } from "pino";
import { MAX_TOOL_ROUNDS } from "./gateway.js";
import { DECLARED_TOOLS, TOOL_DECLARATIONS, toolByName, type ToolContext } from "./tools/index.js";

/**
 * Ask ASAP's answering engine.
 *
 * The shape of an answer, and the reason this file is arranged the way it is:
 *
 *   question → declared tools (our code, caller's RLS) → grounded facts → model composes → checked
 *
 * The model never reaches data and never supplies a value. It decides *which tool to run* and
 * *which component should show the result*; the rows come back from Postgres and the renderer
 * reads them by id (§45 rules 6, 8, 9). Three checks run on every reply before anyone sees it:
 *
 *  1. **Shape.** The reply parses as a `UiIntent`, or the turn abstains. A reply that does not
 *     parse is never patched up.
 *  2. **Grounding.** Every record id the model named must be one a tool returned on this turn.
 *     A model cannot cite a record it was not shown, and cannot invent one that happens to exist.
 *  3. **Authority.** The answer sentence may not assert a status, a percentage or an approval
 *     outcome. Those are derived from steps and columns; a sentence claiming one is rejected
 *     rather than displayed (§45 rules 9, 10).
 *
 * When any check fails, the turn *abstains*. Abstention is a designed state (§36) and says what
 * was missing. It is never a blank answer and never a confident guess.
 */

export type AskOutcome =
  | {
      state: "answered";
      intent: UiIntentT;
      toolsUsed: { name: string; arguments: Record<string, unknown> }[];
      citations: Citation[];
      servedBy: string;
    }
  | {
      state: "abstained";
      reason: string;
      missing: string[];
      toolsUsed: { name: string; arguments: Record<string, unknown> }[];
      servedBy: string | null;
    };

export type Citation = {
  label: string;
  recordId: string | null;
  recordKind: string;
  reference: string | null;
  page: number | null;
};

/** Words that would make the sentence an authority rather than a description. */
const AUTHORITY_CLAIMS = [
  /\b\d{1,3}\s?% (complete|done|ready|progress)/i,
  /\bapproved\b/i,
  /\brejected\b/i,
  /\bi (have )?(approved|authorised|authorized|paid|sent|bound)\b/i,
  /\bcover is (now )?(confirmed|bound|in force)\b/i,
];

const SYSTEM = `You are ASAP, the operating system of an insurance brokerage in Kenya. You are speaking to a broker at their work.

How you answer:
- Use the tools to read the brokerage's own records. You have no other knowledge of this brokerage, and you must not answer a question about it from memory or inference.
- If the tools do not return what a question needs, say so. Abstaining is correct; guessing is a defect.
- Never state a status, a progress figure, a percentage, an approval outcome or a money amount as a fact you have decided. Those are read from the record and shown by the component you choose. Describe what is there and let the component carry the values.
- A finished run means ASAP produced an output. It never means a policy was renewed, cover was confirmed, a claim was accepted or money was received.
- A period of cover is one client, one policy, one year. Never merge two periods into one answer.
- Speak plain brokerage English. No internal state names, no codes, no jargon the broker did not use.

What you return: a single JSON object with
  type        one of answer, open_record, work_list, draft, automation, panel
  target      the id of the record this is about, or null. It must be an id a tool returned.
  panel       the component that should show it, or null.
  view        one of summary, blocker, comparison, policy, money, documents, timeline
  answer      one or two sentences a broker would say. No markup, no code, no lists.
  suggestions up to four short follow-up questions.

You never return HTML, JSX, markdown or code in any field.`;

const replySchema = z.object({
  type: z.enum(["answer", "open_record", "work_list", "draft", "automation", "panel"]),
  target: z.string().nullable().catch(null),
  panel: z.string().nullable().catch(null),
  view: z.enum(["summary", "blocker", "comparison", "policy", "money", "documents", "timeline"]).catch("summary"),
  answer: z.string().min(1).max(1200),
  suggestions: z.array(z.string()).max(4).catch([]),
});

const REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["type", "target", "panel", "view", "answer", "suggestions"],
  properties: {
    type: { type: "string", enum: ["answer", "open_record", "work_list", "draft", "automation", "panel"] },
    target: { type: ["string", "null"] },
    panel: { type: ["string", "null"], enum: [...AskComponentId.options, null] },
    view: {
      type: "string",
      enum: ["summary", "blocker", "comparison", "policy", "money", "documents", "timeline"],
    },
    answer: { type: "string" },
    suggestions: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
};

/** Every uuid a tool result contained, so grounding can be checked without trusting the model. */
function collectIds(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectIds(v, into);
  }
}

/** Citations built from what the tools actually returned — never from the model's sentence. */
function citationsFrom(name: string, result: unknown): Citation[] {
  const out: Citation[] = [];
  if (name === "get_record_evidence" && result && typeof result === "object") {
    const rec = result as {
      id: string;
      steps?: { label: string; recorded?: { reference: string; recordedAt: string }[] }[];
    };
    for (const step of rec.steps ?? []) {
      for (const r of step.recorded ?? []) {
        out.push({
          label: `${step.label}: ${r.reference}`,
          recordId: rec.id,
          recordKind: "work_item",
          reference: r.reference,
          // Page and highlight arrive with extraction (Increment 5). Until then it is null, and
          // the UI says "no page reference on file" rather than offering a citation it cannot open.
          page: null,
        });
      }
    }
  }
  if (name === "find_work" && Array.isArray(result)) {
    for (const item of result as { id: string; title: string; recorded?: { reference: string }[] }[]) {
      for (const r of item.recorded ?? []) {
        out.push({
          label: `${item.title}: ${r.reference}`,
          recordId: item.id,
          recordKind: "work_item",
          reference: r.reference,
          page: null,
        });
      }
    }
  }
  return out;
}

export async function runAsk(opts: {
  provider: AiProvider;
  question: string;
  /** Earlier turns, oldest first, already trimmed by the caller. */
  history: { role: "person" | "asap"; body: string }[];
  scopeHint: string;
  db: SupabaseClient;
  organizationId: string;
  logger: Logger;
}): Promise<AskOutcome> {
  const { provider, db, organizationId, logger } = opts;
  const servedBy = `${provider.id}:${provider.model}`;
  const ctx: ToolContext = { db, organizationId };

  const messages: AiMessage[] = [];
  for (const turn of opts.history) {
    messages.push(
      turn.role === "person"
        ? { role: "user", content: turn.body }
        : { role: "assistant", content: turn.body, toolCalls: [] },
    );
  }
  messages.push({ role: "user", content: `${opts.scopeHint}\n\n${opts.question}` });

  const toolsUsed: { name: string; arguments: Record<string, unknown> }[] = [];
  const seenIds = new Set<string>();
  const citations: Citation[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const last = round === MAX_TOOL_ROUNDS;
    const response = await provider.complete({
      system: SYSTEM,
      messages,
      // On the final round the tools are withdrawn, so the model must answer or abstain with what
      // it has rather than looping until the budget runs out.
      tools: last ? [] : TOOL_DECLARATIONS,
      responseSchema: REPLY_JSON_SCHEMA,
      maxOutputTokens: 1200,
    });

    if (response.stop === "refusal") {
      return { state: "abstained", reason: "ASAP declined to answer this.", missing: [], toolsUsed, servedBy };
    }

    if (response.stop === "tool_use" && response.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        const tool = toolByName(call.name);
        if (!tool) {
          // A name outside the registry is not an error to work around — it is returned to the
          // model as a failed call and nothing runs.
          messages.push({
            role: "tool_result",
            toolCallId: call.id,
            content: JSON.stringify({ error: "no such tool" }),
            isError: true,
          });
          continue;
        }
        try {
          const result = await tool.run(call.arguments, ctx);
          toolsUsed.push({ name: call.name, arguments: call.arguments });
          collectIds(result, seenIds);
          citations.push(...citationsFrom(call.name, result));
          messages.push({
            role: "tool_result",
            toolCallId: call.id,
            content: JSON.stringify(result ?? null),
            isError: false,
          });
        } catch (err) {
          // Arguments that fail validation, and database errors, both come back as a failed call.
          // The message is ours; a database error's detail never reaches the model.
          // A Zod error here is either the model's arguments or a row that does not match the
          // schema. The detail distinguishes them for us; the model is told only that it failed.
          const isZod = err instanceof z.ZodError;
          logger.warn(
            { tool: call.name, kind: isZod ? "validation" : "database", detail: isZod ? err.message : undefined },
            "ask tool call failed",
          );
          messages.push({
            role: "tool_result",
            toolCallId: call.id,
            content: JSON.stringify({ error: isZod ? "that call did not validate" : "could not read" }),
            isError: true,
          });
        }
      }
      continue;
    }

    // A final answer. Now the three checks.
    const raw = safeJson(response.text);
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ servedBy }, "ask reply did not parse as an intent");
      return {
        state: "abstained",
        reason: "ASAP could not produce a usable answer for this.",
        missing: [],
        toolsUsed,
        servedBy,
      };
    }
    const reply = parsed.data;

    if (reply.target && !seenIds.has(reply.target)) {
      // The model named a record no tool returned. Even if the id exists, it was not read on this
      // turn, so it is not grounded — and answering anyway would leak across the RLS boundary.
      logger.warn({ servedBy }, "ask reply cited an ungrounded record");
      return {
        state: "abstained",
        reason: "ASAP could not confirm which record that is about.",
        missing: ["a record matching the question"],
        toolsUsed,
        servedBy,
      };
    }

    const offending = AUTHORITY_CLAIMS.find((re) => re.test(reply.answer));
    if (offending) {
      logger.warn({ servedBy }, "ask reply asserted an authoritative value");
      return {
        state: "abstained",
        reason: "ASAP can describe what is recorded, but cannot decide a status or an outcome.",
        missing: [],
        toolsUsed,
        servedBy,
      };
    }

    const panel = reply.panel && AskComponentId.safeParse(reply.panel).success ? reply.panel : null;
    const intent = UiIntent.parse({
      type: reply.type,
      target: reply.target,
      panel,
      view: reply.view,
      answer: reply.answer.trim(),
      suggestions: reply.suggestions.slice(0, 4),
    });

    if (toolsUsed.length === 0 && intent.target === null && intent.type !== "answer") {
      // Nothing was read and nothing was resolved: there is no grounded answer to give.
      return {
        state: "abstained",
        reason: "ASAP found nothing on file that answers this.",
        missing: [],
        toolsUsed,
        servedBy,
      };
    }

    return { state: "answered", intent, toolsUsed, citations: dedupe(citations), servedBy };
  }

  throw new AiGatewayError("budget_exceeded", "Ask used its tool rounds without reaching an answer.");
}

function safeJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some providers wrap JSON in a fence even when asked not to. Take the first object and parse
    // it properly — never pick values out of the text with a regular expression.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function dedupe(items: Citation[]): Citation[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    const key = `${c.recordId}:${c.reference}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export { DECLARED_TOOLS };
