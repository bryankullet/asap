import type { AiProvider } from "@asap/schema";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * Reading an intention (D-172). Deterministic first: the ordinary requests — add a client, show
 * expiring policies, renew a client's cover — are recognised by rules, with no model call. Only when
 * no rule matches is the model asked, through the gateway, for a schema-checked reading that may
 * name an intention and repeat words the person used; it never names a record, a value or an action.
 * Records are then resolved from those words under the viewer's session, exactly as for the rules.
 */

export type TopIntent =
  | { kind: "create_client"; name: string | null; understood: string; by: "rules" | "model" }
  | { kind: "explore_policies"; text: string; understood: string; by: "rules" | "model" }
  | { kind: "renew_policy"; clientWords: string; coverWords: string | null; understood: string; by: "rules" | "model" }
  | { kind: "unsupported"; understood: string; reason: string; by: "rules" | "model" };

const COVER_WORDS = ["motor", "fleet", "vehicle", "vehicles", "car", "cars", "medical", "health", "fire", "property", "marine", "cargo", "liability", "life", "travel", "engineering", "wiba", "domestic", "burglary", "theft", "indemnity", "professional", "gpa", "accident", "contractors", "equipment", "money", "goods", "transit", "home", "commercial", "private"];
const FILLER = new Set(["help", "me", "us", "please", "renew", "renewal", "renewals", "renewing", "the", "a", "an", "policy", "policies", "cover", "covers", "start", "prepare", "work", "on", "for", "of", "with", "to", "can", "you", "i", "want", "need", "would", "like", "lets", "let's", "our", "their", "its", "it", "insurance", "do", "get", "going", "now", "today", "client", "clients"]);

const REFUSE: [RegExp, string][] = [
  [/\b(is|are|was|will)\b[^?]*\b(covered|payable|liable)\b|\bwill (they|the insurer) pay\b/i, "ASAP does not decide cover or liability — the insurer does. ASAP can show the policy, its documents and what is recorded."],
  [/\b(which|what) (insurer|quote|one)\b.*\b(pick|choose|go with|recommend|best|should)\b|\b(recommend|best) (insurer|quote)\b/i, "ASAP does not choose for the client. It can put the insurers' answers side by side; the client decides."],
  [/^\s*(please\s+)?(approve|send|email|accept|reject|decline|delete|pay|bind|cancel)\b/i, "Asking does not act. Open the work and use its control for that step — it shows exactly what will happen first."],
];

export function refusal(text: string): string | null {
  for (const [re, why] of REFUSE) if (re.test(text)) return why;
  return null;
}

const words = (s: string) => s.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9& -]+/g, " ").split(/\s+/).filter(Boolean);

/** Splits "Acme's motor fleet" into the client's words and the cover's words. */
export function splitRenewal(text: string): { clientWords: string; coverWords: string | null } {
  const ws = words(text);
  const cover = ws.filter((w) => COVER_WORDS.includes(w));
  const client = ws.filter((w) => !COVER_WORDS.includes(w) && !FILLER.has(w) && w.length >= 2);
  return { clientWords: client.join(" "), coverWords: cover.length ? cover.join(" ") : null };
}

const CREATE = /\b(add|create|new|onboard|register|set\s+up|open)\b[\w\s'’-]{0,40}\bclients?\b|^\s*new\s+client\b/i;
const CREATE_NAMED = /\b(?:add|create|onboard|register)\s+(.{2,120}?)\s+as\s+(?:a\s+)?(?:new\s+)?client\b/i;
const EXPLORE_VERB = /\b(show|list|which|what|find|see|all|display|give me|any|how many)\b/i;
const EXPLORE_NOUN = /\b(policies|renewals|covers|book)\b/i;
const WHEN = /\b(expir\w*|ending|end|ends|due|lapsing|lapse|up for renewal|this month|next month|next \d+ days|coming \d+ days|quarter|overdue|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const RENEW = /\brenew(al|ing)?\b/i;

export function interpretRules(text: string): TopIntent | null {
  const t = text.trim();
  const refused = refusal(t);
  if (refused) return { kind: "unsupported", understood: "A request ASAP does not act on from words", reason: refused, by: "rules" };
  if (CREATE.test(t) && !RENEW.test(t)) {
    const m = t.match(CREATE_NAMED);
    const name = m?.[1]?.replace(/^["“']|["”']$/g, "").trim() ?? null;
    return { kind: "create_client", name: name && name.length >= 2 ? name.slice(0, 200) : null, understood: name ? `Add ${name} as a new client` : "Add a new client", by: "rules" };
  }
  if ((EXPLORE_VERB.test(t) && EXPLORE_NOUN.test(t) && WHEN.test(t)) || /\bexpiring\b/i.test(t)) {
    return { kind: "explore_policies", text: t, understood: "Policies by when they expire", by: "rules" };
  }
  if (RENEW.test(t)) {
    const s = splitRenewal(t);
    if (s.clientWords) return { kind: "renew_policy", ...s, understood: `Renew ${s.clientWords}${s.coverWords ? ` (${s.coverWords})` : ""}`, by: "rules" };
    return { kind: "renew_policy", clientWords: "", coverWords: s.coverWords, understood: "Renew a client's cover", by: "rules" };
  }
  return null;
}

const modelReply = z.strictObject({
  intent: z.enum(["create_client", "explore_policies", "renew_policy", "none"]),
  client: z.string().max(120).nullable(),
  cover: z.string().max(80).nullable(),
  window: z.string().max(60).nullable(),
});

const SYSTEM = [
  "You read one request from a person working at an insurance brokerage and say which of these they want:",
  "create_client (add a new client), explore_policies (see policies or renewals by when they expire),",
  "renew_policy (work on renewing one client's cover), or none.",
  "Repeat only words the person used: the client's name in `client`, the kind of cover in `cover`, the time in `window`.",
  "Never invent a name, a value or a record. Answer only with the JSON object.",
].join(" ");

/** Words the model returned must be words the person typed; anything else is dropped. */
function own(text: string, value: string | null): string | null {
  if (!value) return null;
  const hay = text.toLowerCase();
  const kept = words(value).filter((w) => hay.includes(w));
  return kept.length ? kept.join(" ") : null;
}

export async function interpretModel(provider: AiProvider, logger: Logger, text: string): Promise<TopIntent | null> {
  try {
    const reply = await provider.complete({
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 500) }],
      tools: [],
      responseSchema: {
        type: "object",
        properties: { intent: { type: "string", enum: ["create_client", "explore_policies", "renew_policy", "none"] }, client: { type: ["string", "null"] }, cover: { type: ["string", "null"] }, window: { type: ["string", "null"] } },
        required: ["intent", "client", "cover", "window"],
        additionalProperties: false,
      },
      maxOutputTokens: 160,
    });
    const s = reply.text.indexOf("{");
    const e = reply.text.lastIndexOf("}");
    const parsed = modelReply.safeParse(s >= 0 && e > s ? JSON.parse(reply.text.slice(s, e + 1)) : null);
    if (!parsed.success || parsed.data.intent === "none") return null;
    const client = own(text, parsed.data.client);
    const cover = own(text, parsed.data.cover);
    const win = own(text, parsed.data.window);
    if (parsed.data.intent === "create_client") return { kind: "create_client", name: client, understood: client ? `Add ${client} as a new client` : "Add a new client", by: "model" };
    if (parsed.data.intent === "explore_policies") return { kind: "explore_policies", text: [cover, "policies expiring", win].filter(Boolean).join(" "), understood: "Policies by when they expire", by: "model" };
    if (!client) return null;
    return { kind: "renew_policy", clientWords: client, coverWords: cover, understood: `Renew ${client}${cover ? ` (${cover})` : ""}`, by: "model" };
  } catch (err) {
    logger.warn({ err }, "intent reading by the model failed; deterministic reading only");
    return null;
  }
}

/** Rules, then the model when no rule matched — never the model over a refusal. */
export async function interpretIntent(text: string, provider: AiProvider | null, logger: Logger): Promise<TopIntent> {
  const rules = interpretRules(text);
  if (rules) return rules;
  const model = provider ? await interpretModel(provider, logger, text) : null;
  return (
    model ?? {
      kind: "unsupported",
      understood: "Not something ASAP can set up from words yet",
      reason: provider
        ? "ASAP could not tell what to set up from that. Try adding a client, finding policies by when they expire, or renewing a client's cover."
        : "ASAP reads a few requests by rule — adding a client, finding policies by when they expire, renewing a client's cover. The model that reads other requests is not available right now.",
      by: "rules",
    }
  );
}
