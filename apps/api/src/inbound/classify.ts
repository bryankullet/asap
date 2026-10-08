import { INBOUND_KIND_LABELS, InboundKind, type AiProvider, type InboundCandidate } from "@asap/schema";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * What an inbound email is, proposed by the model through the gateway (D-144). The model proposes;
 * code decides. Its reply is validated against the kind list and a 0–1 confidence; anything else
 * is treated as no answer. With no model configured this returns null and ASAP abstains — the
 * email goes to a person as Unsorted.
 *
 * The model is given the sender, subject and the first part of the body. It never sees the
 * brokerage's records, and nothing it says is stored as a fact.
 */
export type Classification = { kind: InboundKind; confidence: number; reason: string; model: string };
const BODY_LIMIT = 4000;

const classificationReply = z.object({ kind: InboundKind, confidence: z.number().min(0).max(1), reason: z.string().max(500) });
const tieBreakReply = z.object({ choice: z.number().int().min(0), confidence: z.number().min(0).max(1) });

export const emailPrompt = (e: { from: string; subject: string; body: string }) =>
  `From: ${e.from}\nSubject: ${e.subject}\n\n${e.body.slice(0, BODY_LIMIT)}`;

export const CLASSIFY_SYSTEM = [
  "You sort the email arriving at a Kenyan insurance brokerage into exactly one kind.",
  "Reply with JSON only: {\"kind\": <one kind>, \"confidence\": <0 to 1>, \"reason\": <one short sentence>}.",
  "Confidence is how sure you are of the kind. Be honest: an email that could be two kinds is not above 0.7.",
  "You never decide or suggest whether a loss is covered, and never judge a claim.",
  "The kinds:",
  ...Object.entries(INBOUND_KIND_LABELS).map(([k, v]) => `- ${k}: ${v}`),
].join("\n");

function firstJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function classifyEmail(provider: AiProvider | null, logger: Logger, e: { from: string; subject: string; body: string }): Promise<Classification | null> {
  if (!provider) return null;
  try {
    const reply = await provider.complete({
      system: CLASSIFY_SYSTEM,
      messages: [{ role: "user", content: emailPrompt(e) }],
      tools: [],
      responseSchema: { type: "object", properties: { kind: { type: "string", enum: [...InboundKind.options] }, confidence: { type: "number" }, reason: { type: "string" } }, required: ["kind", "confidence", "reason"], additionalProperties: false },
      maxOutputTokens: 300,
    });
    const parsed = classificationReply.safeParse(firstJson(reply.text));
    if (!parsed.success) return null;
    return { kind: parsed.data.kind, confidence: parsed.data.confidence, reason: parsed.data.reason, model: `${reply.servedBy.provider}:${reply.servedBy.model}` };
  } catch (err) {
    logger.warn({ err }, "inbound classification failed; abstaining");
    return null;
  }
}

/**
 * Only among the deterministic candidates: the model is shown each one as a numbered line of what
 * the matcher found, and may only answer with one of those numbers.
 */
export async function tieBreak(provider: AiProvider | null, logger: Logger, e: { from: string; subject: string; body: string }, candidates: InboundCandidate[]): Promise<{ runId: string; confidence: number } | null> {
  if (!provider || candidates.length < 2) return null;
  try {
    const lines = candidates.map((c, i) => `${i}: ${c.workflow} work with ${c.party ?? "an outside party"} — ${c.why.join("; ")}`);
    const reply = await provider.complete({
      system: [
        "An email arrived at an insurance brokerage. More than one piece of work in progress could be waiting for it.",
        "Choose the one it belongs to, only from the numbered list. Reply with JSON only: {\"choice\": <number>, \"confidence\": <0 to 1>}.",
        "If you cannot tell, give a low confidence; a person will choose.",
      ].join("\n"),
      messages: [{ role: "user", content: `${emailPrompt(e)}\n\nThe work that could fit:\n${lines.join("\n")}` }],
      tools: [],
      responseSchema: { type: "object", properties: { choice: { type: "integer" }, confidence: { type: "number" } }, required: ["choice", "confidence"], additionalProperties: false },
      maxOutputTokens: 100,
    });
    const parsed = tieBreakReply.safeParse(firstJson(reply.text));
    if (!parsed.success || !candidates[parsed.data.choice]) return null;
    return { runId: candidates[parsed.data.choice]!.runId, confidence: parsed.data.confidence };
  } catch (err) {
    logger.warn({ err }, "inbound tie-break failed; a person chooses");
    return null;
  }
}
