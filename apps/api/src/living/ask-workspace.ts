import { WorkspaceIntent, type AiProvider, type WorkspaceInterpretation } from "@asap/schema";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * Ask ASAP inside a Living workspace (D-165). A request in the person's words becomes a typed focus
 * — an intent and, where the request names one, a target taken from the record's own names — and the
 * workspace recomposes around it. Nothing here produces a value, a status or an action:
 *
 *  - Rules first. Most requests a broker types are recognisable, and a rule is exact and free.
 *  - The model only when the rules find nothing and the gateway is configured. It is given the
 *    intent list and the record's names, never the records; its reply must match the schema, its
 *    target must be one of the names given, and anything else is no answer (§45 rule 8).
 *  - Requests to act ("approve it", "send the letter"), to decide cover, or to choose an insurer are
 *    refused here with the reason: acting happens through the workspace's own controls, cover is the
 *    insurer's decision (§45 rule 12), and ASAP does not pick for the client.
 *
 * Measured by docs/evaluation/workspace-requests.json (rules offline; the model with
 * WORKSPACE_EVAL_LIVE=1) — §45 rule 11.
 */

export type WorkspaceKind = "renewal" | "claim" | "endorsement";
export type WorkspaceVocabulary = { insurers: { id: string | null; name: string }[]; terms: string[]; documents: string[] };

const REFUSE: [RegExp, string][] = [
  [/\b(is|are|was|will)\b[^?]*\b(covered|cover(ed)? for|payable|liable)\b|\bcovered\?|\bwill (they|the insurer) pay\b/i, "ASAP does not decide cover or liability — the insurer does. Ask what is blocking the claim, or bring up the policy wording."],
  [/\b(which|what) (insurer|quote|one)\b.*\b(pick|choose|go with|recommend|best|should)\b|\b(recommend|best) (insurer|quote)\b/i, "ASAP does not choose for the client. Compare the quotes, or explore a choice, and the client decides."],
  [/^\s*(please\s+)?(approve|send|email|accept|reject|decline|record|set|change|update|delete|pay|register|apply|bind|cancel)\b/i, "Asking does not act. Use the control on the workspace for that step — it shows exactly what will happen, and nothing happens without it."],
];

const norm = (s: string) => s.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** The record's own name a request mentions: an insurer by any of its words, a term or document by its words. */
function findName(text: string, names: string[]): string | null {
  const t = ` ${norm(text)} `;
  // Longest first, so "windscreen limit" wins over "limit".
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const n = norm(name).replace(/\b(pdf|docx?)\b/g, "").trim();
    if (!n) continue;
    if (t.includes(` ${n} `)) return name;
    const words = n.split(" ").filter((w) => w.length >= 3 && !["general", "insurance", "limited", "company", "quote", "policy"].includes(w));
    // A singular or plural of a distinctive word: "exclusion" ↔ "Exclusions".
    for (const w of words) {
      const stem = w.replace(/(es|s)$/, "");
      if (new RegExp(`\\b${stem}(es|s)?\\b`).test(t)) return name;
    }
  }
  return null;
}

type Rule = { intent: WorkspaceInterpretation["focus"] extends infer F ? F extends { intent: infer I } ? I : never : never; re: RegExp; words: string; target?: "insurer" | "evidence"; kinds?: WorkspaceKind[] };
const RULES: Rule[] = [
  { intent: "reset", re: /\b(show everything|everything again|clear (the )?focus|back to (the )?(whole|full)|reset)\b/i, words: "The whole workspace again" },
  { intent: "explore", re: /\bwhat if\b.*\b(chose|choose|picks?|go(es)? with|went with|takes?)\b/i, words: "Exploring a choice", target: "insurer", kinds: ["renewal"] },
  { intent: "compare_revisions", re: /\b(revis(ed|ion|ions)|what changed|changes? (in|to) (the )?(terms|quote))\b/i, words: "The revised terms beside the earlier ones", target: "insurer", kinds: ["renewal"] },
  { intent: "compare_quotes", re: /\b(compare|side by side|versus|vs)\b.*\b(quotes?|terms|insurers?|premiums?|answers?)\b|\b(cic|jubilee|madison)\b.*\bside by side\b|\bcompare the quotes?\b/i, words: "The insurers' answers side by side", kinds: ["renewal"] },
  { intent: "evidence", re: /\b(document|evidence|source|proof|behind|come from|comes from|bring up|show (me )?the|where is|where's|pdf|schedule|wording)\b/i, words: "The evidence", target: "evidence" },
  { intent: "blockers", re: /\b(block(ing|ed|er|ers)?|stuck|holding( up)?|stopping|missing|outstanding|still need|hold(s)? (this|it) up)\b/i, words: "What is blocking this" },
  { intent: "obligations", re: /\b(who\b.*\b(has|holds?|owns?|waiting|ball|next step|responsible)|waiting (on|for) (who|whom)|whose (turn|move)|ball)\b/i, words: "Who holds the next step" },
  { intent: "consequences", re: /\b(what does (this|it)( change)? mean|mean for|consequen|impact|risk|what happens if|so what)\b/i, words: "What this means" },
  { intent: "messages", re: /\b(messages?|emails?|letters?|gone out|been sent|communicat)\b/i, words: "The messages for this work" },
  { intent: "history", re: /\b(last year|previous years?|before|earlier years?|history|call notes?|notes|past)\b/i, words: "What happened before" },
  { intent: "next_steps", re: /\b(what('s| is)? next|do next|what now|what should (i|we)|to do\b)/i, words: "What moves this forward" },
];

const KIND_WORDS: Record<WorkspaceKind, string> = { renewal: "renewal", claim: "claim", endorsement: "policy change" };

export function interpretWorkspaceRules(text: string, kind: WorkspaceKind, vocab: WorkspaceVocabulary): WorkspaceInterpretation {
  for (const [re, why] of REFUSE) if (re.test(text)) return { focus: null, explore: null, understood: null, unclear: why, source: "none" };
  for (const r of RULES) {
    if (r.kinds && !r.kinds.includes(kind)) continue;
    if (!r.re.test(text)) continue;
    // "show me the messages" is messages, not evidence: evidence needs a thing to show, or the word itself.
    if (r.intent === "evidence") {
      const named = findName(text, [...vocab.terms, ...vocab.documents]);
      if (!named && !/\b(evidence|source|proof|document|behind|come from|comes from)\b/i.test(text)) continue;
      return { focus: { intent: "evidence", target: named }, explore: null, understood: named ? `The evidence behind “${named}”` : "The evidence", unclear: null, source: "rules" };
    }
    if (r.target === "insurer") {
      const ins = findName(text, vocab.insurers.map((i) => i.name));
      if (r.intent === "explore") {
        const id = vocab.insurers.find((i) => i.name === ins)?.id ?? null;
        if (!ins || !id) return { focus: null, explore: null, understood: null, unclear: "Which insurer's answer should be explored? Name one that has answered.", source: "none" };
        return { focus: { intent: "explore", target: ins }, explore: [id], understood: `If the client chose ${ins}`, unclear: null, source: "rules" };
      }
      return { focus: { intent: r.intent, target: ins }, explore: null, understood: ins ? `${r.words}: ${ins}` : r.words, unclear: null, source: "rules" };
    }
    return { focus: { intent: r.intent, target: null }, explore: null, understood: r.words, unclear: null, source: "rules" };
  }
  return { focus: null, explore: null, understood: null, unclear: `That is not something this ${KIND_WORDS[kind]} workspace can bring forward yet.`, source: "none" };
}

const modelReply = z.object({ intent: z.union([WorkspaceIntent, z.literal("none")]), target: z.string().max(120).nullable() });
export const WORKSPACE_SYSTEM = (kind: WorkspaceKind, vocab: WorkspaceVocabulary) =>
  [
    `A broker typed a request inside an insurance ${KIND_WORDS[kind]} workspace. Choose what the workspace should bring forward.`,
    'Reply with JSON only: {"intent": <one intent or "none">, "target": <one of the names below, or null>}.',
    "Intents: compare_revisions (revised insurer terms against earlier ones), compare_quotes (insurers side by side), blockers (what stops progress), evidence (a document or source behind a fact), obligations (who holds the next step), consequences (what something means), messages (prepared letters and emails), history (earlier years, notes), next_steps, explore (what if the client chose an insurer), reset.",
    'Answer "none" for any request to act (approve, send, record, change), to decide cover or liability, to choose or recommend an insurer, or anything else.',
    `Names you may use as target, exactly as written: ${[...vocab.insurers.map((i) => i.name), ...vocab.terms, ...vocab.documents].join(" | ") || "(none)"}.`,
  ].join("\n");

/** The model's reading, schema-checked; its target must be a name it was given. */
export async function interpretWorkspaceModel(provider: AiProvider, logger: Logger, text: string, kind: WorkspaceKind, vocab: WorkspaceVocabulary): Promise<WorkspaceInterpretation | null> {
  try {
    const reply = await provider.complete({
      system: WORKSPACE_SYSTEM(kind, vocab),
      messages: [{ role: "user", content: text.slice(0, 500) }],
      tools: [],
      responseSchema: { type: "object", properties: { intent: { type: "string", enum: [...WorkspaceIntent.options, "none"] }, target: { type: ["string", "null"] } }, required: ["intent", "target"], additionalProperties: false },
      maxOutputTokens: 120,
    });
    const s = reply.text.indexOf("{");
    const e = reply.text.lastIndexOf("}");
    const parsed = modelReply.safeParse(s >= 0 && e > s ? JSON.parse(reply.text.slice(s, e + 1)) : null);
    if (!parsed.success || parsed.data.intent === "none") return null;
    const names = [...vocab.insurers.map((i) => i.name), ...vocab.terms, ...vocab.documents];
    const target = parsed.data.target && names.includes(parsed.data.target) ? parsed.data.target : null;
    if (parsed.data.intent === "explore") {
      const id = vocab.insurers.find((i) => i.name === target)?.id ?? null;
      if (!id || kind !== "renewal") return null;
      return { focus: { intent: "explore", target }, explore: [id], understood: `If the client chose ${target}`, unclear: null, source: "model" };
    }
    if ((parsed.data.intent === "compare_revisions" || parsed.data.intent === "compare_quotes") && kind !== "renewal") return null;
    return { focus: { intent: parsed.data.intent, target }, explore: null, understood: target ? `${parsed.data.intent.replace(/_/g, " ")}: ${target}` : parsed.data.intent.replace(/_/g, " "), unclear: null, source: "model" };
  } catch (err) {
    logger.warn({ err }, "workspace interpretation by the model failed; abstaining");
    return null;
  }
}

/** Rules, then the model when the rules found nothing — never the model over a refusal. */
export async function interpretWorkspace(text: string, kind: WorkspaceKind, vocab: WorkspaceVocabulary, provider: AiProvider | null, logger: Logger): Promise<WorkspaceInterpretation> {
  const rules = interpretWorkspaceRules(text, kind, vocab);
  if (rules.focus || rules.source === "none" && REFUSE.some(([re]) => re.test(text))) return rules;
  if (!provider) return rules;
  return (await interpretWorkspaceModel(provider, logger, text, kind, vocab)) ?? rules;
}
