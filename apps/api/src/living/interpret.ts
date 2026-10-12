import type { PortfolioInterpretation, PortfolioQuery } from "@asap/schema";

/**
 * Ask ASAP refining a portfolio view (D-158), deterministically. A request in plain language becomes
 * a change to a typed query — a window, a grouping, filters, a comparison — applied on top of the
 * view the person already has, so "group by insurer" keeps November and "only increases" keeps the
 * grouping. Every refinement is said back in words. What is not understood is returned as such, and
 * a word naming two insurers asks which; nothing is guessed, and no value is ever produced here —
 * the query only says what to select.
 *
 * No model runs. A model-assisted reading may come later behind the same output schema and an
 * evaluation run (§45 rule 11); until then this is the only path.
 */

export type Vocabulary = { insurers: { id: string; name: string }[]; classes: string[] };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")}|${MONTHS.map((m) => m.slice(0, 3)).join("|")})\\b(?:\\s+(20\\d\\d))?`, "i");
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
const label = (from: Date, to: Date) => {
  const f = from.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const t = to.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${f} – ${t}`;
};

/** The default view: renewals ending in the next 90 days. */
export function defaultQuery(now: Date): PortfolioQuery {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + 90 * 86_400_000);
  return { subject: "renewals", window: { from: ymd(from), to: ymd(to), label: "in the next 90 days" }, groupBy: null, filters: { insurers: [], classOfBusiness: null, premiumChange: null, mine: false, status: null }, compare: [] };
}

type Understood = PortfolioInterpretation["understood"][number];

function window(text: string, now: Date): { from: string; to: string; label: string; matched: string } | null {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let m = text.match(/\b(?:next|coming)\s+(\d{1,3})\s+days?\b/i);
  if (m) {
    const n = Math.min(366, Number(m[1]));
    return { from: ymd(today), to: ymd(new Date(today.getTime() + n * 86_400_000)), label: `in the next ${n} days`, matched: m[0] };
  }
  m = text.match(/\b(this|next)\s+month\b/i);
  if (m) {
    const add = m[1]!.toLowerCase() === "next" ? 1 : 0;
    const y = today.getUTCFullYear();
    const mo = today.getUTCMonth() + add;
    const from = new Date(Date.UTC(y, mo, 1));
    const to = monthEnd(from.getUTCFullYear(), from.getUTCMonth());
    return { from: ymd(from), to: ymd(to), label: `in ${from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`, matched: m[0] };
  }
  m = text.match(/\b(this|next)\s+quarter\b|\bq([1-4])(?:\s+(20\d\d))?\b/i);
  if (m) {
    let q: number;
    let y = today.getUTCFullYear();
    if (m[2]) {
      q = Number(m[2]) - 1;
      if (m[3]) y = Number(m[3]);
    } else {
      q = Math.floor(today.getUTCMonth() / 3) + (m[1]!.toLowerCase() === "next" ? 1 : 0);
      if (q > 3) { q = 0; y += 1; }
    }
    const from = new Date(Date.UTC(y, q * 3, 1));
    const to = monthEnd(y, q * 3 + 2);
    return { from: ymd(from), to: ymd(to), label: `in Q${q + 1} ${y}`, matched: m[0] };
  }
  m = text.match(MONTH_RE);
  if (m) {
    const idx = MONTHS.findIndex((x) => x.startsWith(m![1]!.toLowerCase().slice(0, 3)));
    // A month without a year is the next one to come (this month counts).
    let y = m[2] ? Number(m[2]) : today.getUTCFullYear();
    if (!m[2] && idx < today.getUTCMonth()) y += 1;
    const from = new Date(Date.UTC(y, idx, 1));
    const to = monthEnd(y, idx);
    return { from: ymd(from), to: ymd(to), label: `in ${from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`, matched: m[0] };
  }
  m = text.match(/\b(?:by|before|until)\s+(?:the\s+)?end\s+of\s+(?:the\s+)?year\b/i);
  if (m) {
    const to = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
    return { from: ymd(today), to: ymd(to), label: `between ${label(today, to)}`, matched: m[0] };
  }
  return null;
}

const GROUPS: [RegExp, PortfolioQuery["groupBy"], string][] = [
  [/\b(?:group(?:ed)?\s+by|by|per|split\s+by)\s+insurers?\b/i, "insurer", "Grouped by insurer"],
  [/\b(?:group(?:ed)?\s+by|by|per|split\s+by)\s+(?:class(?:es)?(?:\s+of\s+business)?|line\s+of\s+business)\b/i, "class", "Grouped by class of business"],
  [/\b(?:group(?:ed)?\s+by|by|per|split\s+by)\s+(?:owner|handler|account\s+executive|person)\b/i, "owner", "Grouped by owner"],
  [/\b(?:group(?:ed)?\s+by|by|per|split\s+by)\s+clients?\b/i, "client", "Grouped by client"],
  [/\b(?:group(?:ed)?\s+by|by|per|split\s+by)\s+months?\b/i, "month", "Grouped by month"],
  [/\b(?:group(?:ed)?\s+by|by|per|split\s+by)\s+(?:status|stage)\b/i, "status", "Grouped by status"],
];
const CHANGES: [RegExp, NonNullable<PortfolioQuery["filters"]["premiumChange"]>, string][] = [
  [/\b(?:premium\s+)?(?:increases?|increased|went\s+up|gone\s+up|higher|more\s+expensive|rises?|rose)\b/i, "increase", "Only premium increases"],
  [/\b(?:premium\s+)?(?:decreases?|decreased|went\s+down|gone\s+down|lower|cheaper|reductions?|fell)\b/i, "decrease", "Only premium decreases"],
  [/\b(?:premium\s+)?(?:changed|changes?)\b/i, "changed", "Only where the premium changed"],
  [/\b(?:no\s+terms(?:\s+yet)?|without\s+terms|not\s+quoted(?:\s+yet)?)\b/i, "unknown", "Only renewals with no renewal premium yet"],
];
const STATUSES: [RegExp, NonNullable<PortfolioQuery["filters"]["status"]>, string][] = [
  [/\b(?:needs?\s+me|need\s+my\s+attention|for\s+me\s+to\s+act)\b/i, "needs_me", "Only what needs me"],
  [/\b(?:waiting\s+on\s+(?:the\s+)?(?:insurers?|others|client)|with\s+(?:the\s+)?insurers?)\b/i, "with_party", "Only what waits on others"],
  [/\b(?:not\s+started|untouched)\b/i, "not_started", "Only renewals not started"],
  [/\b(?:done|finished|completed|renewed)\b/i, "done", "Only finished renewals"],
];

const strip = (text: string, part: string) => text.replace(part, " ");

export function interpret(text: string, current: PortfolioQuery | null, now: Date, vocab: Vocabulary): PortfolioInterpretation {
  const base = current ?? defaultQuery(now);
  let rest = ` ${text.toLowerCase().replace(/[?.!,;]+/g, " ")} `;
  const understood: Understood[] = [];
  let q: PortfolioQuery = structuredClone(base);
  let clarify: PortfolioInterpretation["clarify"] = null;

  if (/\b(?:reset|start\s+over|clear\s+(?:all|everything|filters?))\b/.test(rest)) {
    q = { ...defaultQuery(now), window: base.window };
    understood.push({ kind: "reset", text: "Filters, grouping and comparison cleared" });
    rest = rest.replace(/\b(?:reset|start\s+over|clear\s+(?:all|everything|filters?))\b/g, " ");
  }

  const w = window(rest, now);
  if (w) {
    q.window = { from: w.from, to: w.to, label: w.label };
    understood.push({ kind: "window", text: `Ending ${w.label}` });
    rest = strip(rest, w.matched.toLowerCase());
  }

  // Comparison first: "compare CIC and Jubilee", "CIC vs Jubilee".
  const cmp = rest.match(/\bcompare\s+(.+?)(?:\s+(?:in|for|ending|over|during)\b|$)|(\S+(?:\s+\S+)?)\s+(?:vs\.?|versus)\s+(\S+(?:\s+\S+)?)/);
  if (cmp) {
    const phrase = cmp[1] ?? `${cmp[2]} and ${cmp[3]}`;
    const names = phrase.split(/\s*(?:,|\band\b|&|\bwith\b)\s*/).map((x) => x.trim()).filter(Boolean);
    const found = names.map((n) => vocab.insurers.filter((i) => i.name.toLowerCase().includes(n))).filter((m) => m.length);
    const ids = [...new Set(found.filter((m) => m.length === 1).map((m) => m[0]!.id))];
    if (ids.length >= 2) {
      q.compare = ids.slice(0, 4);
      q.groupBy = "insurer";
      understood.push({ kind: "compare", text: `Comparing ${ids.map((id) => vocab.insurers.find((i) => i.id === id)!.name).join(" and ")}` });
      rest = strip(rest, cmp[0]);
    }
  }

  for (const [re, g, words] of GROUPS) {
    const m = rest.match(re);
    if (m) {
      q.groupBy = g;
      understood.push({ kind: "group", text: words });
      rest = strip(rest, m[0]);
      break;
    }
  }
  if (/\b(?:ungroup(?:ed)?|no\s+grouping|flat\s+list)\b/.test(rest)) {
    q.groupBy = null;
    q.compare = [];
    understood.push({ kind: "group", text: "No grouping" });
    rest = rest.replace(/\b(?:ungroup(?:ed)?|no\s+grouping|flat\s+list)\b/, " ");
  }

  for (const [re, c, words] of CHANGES) {
    const m = rest.match(re);
    if (m) {
      q.filters.premiumChange = c;
      understood.push({ kind: "filter", text: words });
      rest = strip(rest, m[0]);
      break;
    }
  }
  for (const [re, st, words] of STATUSES) {
    const m = rest.match(re);
    if (m) {
      q.filters.status = st;
      understood.push({ kind: "filter", text: words });
      rest = strip(rest, m[0]);
      break;
    }
  }
  // "mine", "assigned to me", or "my … renewals" with a word or two between ("my fire renewals").
  const mine = rest.match(/\b(?:mine|assigned\s+to\s+me)\b|\bmy(?=(?:\s+\w+){0,2}\s+(?:renewals|clients|work|policies)\b)/);
  if (mine) {
    q.filters.mine = true;
    understood.push({ kind: "filter", text: "Only mine" });
    rest = strip(rest, mine[0]);
  }
  const anyIns = rest.match(/\ball\s+insurers\b/);
  if (anyIns) {
    q.filters.insurers = [];
    understood.push({ kind: "filter", text: "Every insurer" });
    rest = strip(rest, anyIns[0]);
  }

  // An insurer named on its own ("only Jubilee", "with CIC"): one match filters, several ask.
  if (!cmp || q.compare.length === 0) {
    for (const ins of [...vocab.insurers].sort((a, b) => b.name.length - a.name.length)) {
      const first = ins.name.toLowerCase().split(/\s+/)[0]!;
      if (first.length < 3) continue;
      const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (!re.test(rest)) continue;
      const same = vocab.insurers.filter((i) => i.name.toLowerCase().split(/\s+/)[0] === first);
      if (same.length > 1) {
        clarify = { question: `Which insurer do you mean by “${first}”?`, options: same.slice(0, 6).map((i) => ({ label: i.name, text: `only ${i.name}` })) };
      } else {
        q.filters.insurers = [ins.id];
        understood.push({ kind: "filter", text: `Only ${ins.name}` });
      }
      rest = rest.replace(re, " ");
      break;
    }
  }
  for (const cls of [...vocab.classes].sort((a, b) => b.length - a.length)) {
    const word = cls.toLowerCase();
    if (word.length >= 3 && rest.includes(word)) {
      q.filters.classOfBusiness = cls;
      understood.push({ kind: "filter", text: `Only ${cls}` });
      rest = rest.replace(word, " ");
      break;
    }
  }

  // What remains, less the words that only frame a request, is what was not understood.
  const leftover = rest
    .replace(/\b(?:show|me|list|give|find|what|which|are|is|the|a|an|of|in|for|and|only|just|please|renewals?|policies|policy|expiring|ending|due|that|with|by|to|from|all|our|my|can|you|i|want|see|view|filter|group|grouped|sort|order|those|these|them|now|then)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { query: q, understood: understood.slice(0, 12), unclear: leftover ? `I did not understand “${leftover.slice(0, 120)}”.` : null, clarify };
}
