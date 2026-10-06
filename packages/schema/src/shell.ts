import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * The adaptive shell's server-backed contracts (D-155): named conversations, Recent and Pins.
 *
 * A conversation is a named work session. Its title is derived here, deterministically, from what
 * was asked and the records it is about — a model never names a person's conversation, and there is
 * no model in the path, so the fallback is the only path. Its operational status is derived from
 * the work it is linked to, never stored and never authored (§45 rule 10).
 */

/** A surface's address inside the application: `{ ws: "client", clientId: "…" }`. */
export const surfaceRefSchema = z
  .record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.string().max(200)).max(20)]))
  .refine((r) => typeof r["ws"] === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(r["ws"] as string), "A Space reference names its workspace.");
export type SurfaceRef = z.infer<typeof surfaceRefSchema>;

/** Keys that never identify a surface: a filter value typed into it, a date range. */
const TRANSIENT_KEYS = new Set(["query", "date", "view"]);

/** The stable key for a surface: the same record opened twice is one entry. */
export function refKey(ref: SurfaceRef): string {
  const parts = Object.keys(ref)
    .filter((k) => !TRANSIENT_KEYS.has(k) && ref[k] != null && ref[k] !== "")
    .sort()
    .map((k) => `${k}=${Array.isArray(ref[k]) ? (ref[k] as string[]).join(",") : String(ref[k])}`);
  return parts.join("&").slice(0, 300);
}

export const recentKindSchema = z.enum(["conversation", "workflow", "client", "policy", "claim", "quotation", "document", "comparison", "automation", "record"]);
export type RecentKind = z.infer<typeof recentKindSchema>;

/** What kind of thing a Space reference opens — the icon in Recent, never a navigation section. */
export function kindOfRef(ref: SurfaceRef): RecentKind {
  switch (ref["ws"]) {
    case "client":
      return "client";
    case "policy":
      return "policy";
    case "claim":
      return "claim";
    case "quote":
    case "opportunity":
      return "quotation";
    case "document":
      return "document";
    case "quotecompare":
      return "comparison";
    case "automation":
      return "automation";
    case "renewal":
    case "workitem":
    case "endorsement":
      return "workflow";
    default:
      return "record";
  }
}

export const recentItemSchema = z.object({
  key: z.string(),
  kind: recentKindSchema,
  ref: surfaceRefSchema.nullable(),
  conversationId: uuidSchema.nullable(),
  title: z.string(),
  openedAt: z.string(),
  pinned: z.boolean(),
});
export type RecentItem = z.infer<typeof recentItemSchema>;

export const recordOpenRequestSchema = z.union([
  z.object({ conversationId: uuidSchema }),
  z.object({ ref: surfaceRefSchema, title: z.string().trim().min(1).max(160) }),
]);
export type RecordOpenRequest = z.infer<typeof recordOpenRequestSchema>;

export const pinRequestSchema = recordOpenRequestSchema;

/** Operational status, in the words a person reads. Derived from linked work; never stored. */
export const conversationStatusSchema = z.enum(["draft", "working", "needs_information", "needs_approval", "waiting", "blocked", "completed"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  draft: "Draft",
  working: "ASAP working",
  needs_information: "Needs information",
  needs_approval: "Needs approval",
  waiting: "Waiting on someone else",
  blocked: "Blocked",
  completed: "Completed",
};

/**
 * The status, from the facts the server already holds: the linked work item's task status and
 * exception, and its live workflow run's state. A conversation with no linked work is a draft
 * until it has an answer, then complete — it was a question.
 */
export function deriveConversationStatus(f: {
  turns: number;
  workItem: { taskStatus: string; exception: boolean; completed: boolean } | null;
  runState: string | null;
}): ConversationStatus {
  if (!f.workItem) return f.turns > 1 ? "completed" : "draft";
  if (f.workItem.completed || f.workItem.taskStatus === "done") return "completed";
  if (f.workItem.exception || f.runState === "exception") return "blocked";
  if (f.runState === "waiting_approval") return "needs_approval";
  if (f.workItem.taskStatus === "with_party") return "waiting";
  if (f.workItem.taskStatus === "needs_you" || f.workItem.taskStatus === "for_review") return "needs_information";
  // "ASAP working" only while a run of ASAP's is live on it; otherwise it is a person's draft.
  return f.runState && !["done", "cancelled"].includes(f.runState) ? "working" : "draft";
}

export const conversationPurposeSchema = z.enum(["renewal", "quotation", "comparison", "claim", "import", "add_client", "upload", "investigate", "question"]);
export type ConversationPurpose = z.infer<typeof conversationPurposeSchema>;

export const conversationSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  titleSource: z.enum(["question", "derived", "person"]),
  purpose: conversationPurposeSchema,
  status: conversationStatusSchema,
  statusLabel: z.string(),
  client: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  workItem: z.object({ id: uuidSchema, title: z.string(), kind: z.string() }).nullable(),
  runId: uuidSchema.nullable(),
  spaceRef: surfaceRefSchema.nullable(),
  scope: z.object({ kind: z.string(), id: uuidSchema.nullable() }),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** `POST /conversations`: start (or reopen) a named session from Home, + New or "Ask about this". */
export const startConversationRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  purpose: conversationPurposeSchema.optional(),
  scope: z.object({ kind: z.enum(["brokerage", "client", "record", "opportunity", "placement", "policy"]), id: uuidSchema.nullable() }).default({ kind: "brokerage", id: null }),
  workItemId: uuidSchema.nullable().default(null),
  spaceRef: surfaceRefSchema.nullable().default(null),
});
export type StartConversationRequest = z.infer<typeof startConversationRequestSchema>;

export const updateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    workItemId: uuidSchema.nullable().optional(),
    spaceRef: surfaceRefSchema.nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.workItemId !== undefined || v.spaceRef !== undefined, "Nothing to change.");

/** Titles that say nothing: never shown as a conversation's name. */
const EMPTY_TITLES = /^(new chat|conversation \d+|what can i help with\??|client question|ask asap|untitled|question)$/i;

const CLASSES: [RegExp, string][] = [
  [/\bmotor|vehicle|car|fleet|truck|lorry|matatu\b/i, "motor"],
  [/\bmedical|health|inpatient|outpatient\b/i, "medical"],
  [/\bfire|property|buildings?\b/i, "property"],
  [/\bmarine|cargo|goods in transit|git\b/i, "marine"],
  [/\bwiba|work injury|employers? liability\b/i, "WIBA"],
  [/\blife|group life\b/i, "life"],
  [/\btravel\b/i, "travel"],
  [/\bliability|public liability|professional indemnity\b/i, "liability"],
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LEGAL = /\s+(limited|ltd\.?|plc|llc|inc\.?|company|co\.)$/i;

const shortName = (name: string) => name.replace(LEGAL, "").trim();
const classIn = (t: string) => CLASSES.find(([re]) => re.test(t))?.[1] ?? null;
const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const clip = (s: string, n = 72) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n) > 20 ? s.lastIndexOf(" ", n) : n).trim());

/** What the request is for, from its words alone. */
export function conversationPurpose(text: string): ConversationPurpose {
  const t = text.toLowerCase();
  if (/\bcompare\b|\bcomparison\b|\bside by side\b/.test(t) && /\bquot|terms|offers?\b/.test(t)) return "comparison";
  if (/\brenew(al|als|ing)?\b/.test(t)) return "renewal";
  if (/\bclaim\b|\baccident\b|\bstolen\b|\btheft\b|\bburgl|\bdamaged?\b|\bcollision\b|\bloss of\b/.test(t)) return "claim";
  if (/\bquot(e|es|ation|ations)\b|\bplace (cover|the risk)\b|\bapproach\b/.test(t)) return "quotation";
  if (/\bimport\b|\bspreadsheet\b|\bschedules?\b.*\b(upload|import)|\bcsv\b|\bexcel\b/.test(t)) return "import";
  if (/\b(add|create|new|onboard)\b.{0,12}\bclient\b|^add\s+[A-Z]/i.test(text)) return "add_client";
  if (/\bupload\b|\bdocuments?\b.*\b(add|file)\b/.test(t)) return "upload";
  if (/\binvestigate\b|\bwhy (is|are|was|were|has|have)\b|\bdelayed?\b/.test(t)) return "investigate";
  return "question";
}

/**
 * The conversation's name: what it is for and what it is about, in brokerage words. Deterministic,
 * so the same request is named the same way twice, and never one of the empty titles.
 *
 * `clientName` and `insurerNames` come from the brokerage's own records (the client in scope or
 * named in the text; the insurers named in it) — never from a model.
 */
export function deriveConversationTitle(o: {
  text: string;
  purpose?: ConversationPurpose;
  clientName?: string | null;
  recordLabel?: string | null;
  insurerNames?: string[];
  brokerageName?: string | null;
  now?: Date;
}): string {
  const text = o.text.replace(/\s+/g, " ").trim();
  const purpose = o.purpose ?? conversationPurpose(text);
  const client = o.clientName ? shortName(o.clientName) : null;
  const cls = classIn(text);
  const insurers = (o.insurerNames ?? []).map(shortName).filter(Boolean);
  const month = (() => {
    const m = MONTHS.find((x) => new RegExp(`\\b${x.slice(0, 3)}`, "i").test(text));
    return m ?? null;
  })();
  let title: string | null = null;
  switch (purpose) {
    case "renewal":
      title = client ? `Renew ${client}${cls ? ` ${cls}` : ""} policy` : cls ? `Renew ${cls} policies` : "Prepare a renewal";
      break;
    case "comparison":
      title = insurers.length >= 2 ? `Compare ${insurers.slice(0, -1).join(", ")} and ${insurers.at(-1)} quotations` : client ? `Compare ${client} quotations` : "Compare quotations";
      break;
    case "quotation":
      title = client ? `${client}${cls ? ` ${cls}` : ""} quotation` : cls ? `New ${cls} quotation` : "Start a quotation";
      break;
    case "claim": {
      const what = /\btheft|stolen|burgl/i.test(text) ? "theft" : /\bfire\b/i.test(text) ? "fire" : /\baccident|collision|crash|hit\b/i.test(text) ? "accident" : /\bdamage/i.test(text) ? "damage" : null;
      title = client ? `${client}${what ? ` ${what}` : ""} claim` : what ? `Report ${what} claim` : "Report a claim";
      break;
    }
    case "import":
      title = `Import ${month ? `${month} ` : ""}${/\bschedules?\b/i.test(text) ? "policy schedules" : /\bclients?\b/i.test(text) ? "clients" : "records"}`;
      break;
    case "add_client": {
      const named = /\b(?:[Aa]dd|[Cc]reate|[Oo]nboard)\s+(?:a\s+)?(?:new\s+)?(?:client\s+)?(?:called\s+|named\s+)?([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})/.exec(text)?.[1];
      title = client ? `Add ${client}` : named && !/^client$/i.test(named) ? `Add ${shortName(named)}` : "Add a client";
      break;
    }
    case "upload":
      title = client ? `${client} documents` : "Upload documents";
      break;
    case "investigate": {
      const rest = text.replace(/^(please\s+)?(can you\s+)?(investigate|look into|find out)\s+/i, "").replace(/[?.!]+$/, "");
      title = `Investigate ${clip(rest.replace(/^why\s+/i, ""), 60).replace(/^\w/, (c) => c.toLowerCase())}`;
      break;
    }
    default: {
      const q = text
        .replace(/^(hi|hello|hey)[,!.\s]+/i, "")
        .replace(/^(please\s+)?(can|could|would) you\s+(please\s+)?/i, "")
        .replace(/^(tell me|show me|let me know)\s+/i, "")
        .replace(/[?.!]+$/, "")
        .trim();
      title = q.length >= 8 ? sentence(clip(q)) : null;
    }
  }
  if (!title || EMPTY_TITLES.test(title.trim())) {
    title = client ? `Ask about ${client}` : o.recordLabel ? `Ask about ${o.recordLabel}` : o.brokerageName ? `Ask about ${shortName(o.brokerageName)}` : "Ask about the brokerage";
  }
  return clip(title, 120);
}
