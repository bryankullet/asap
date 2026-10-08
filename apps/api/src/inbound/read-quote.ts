/**
 * Reads an insurer's reply from the email's own words (D-152) — premium and currency, validity, or a
 * decline and its reason — by fixed patterns, never the model. What it reads is a proposal: a person
 * accepts or corrects it before it becomes the insurer's response. When the words do not say
 * clearly, it says nothing rather than guess.
 */
export type ReadReply = {
  outcome: "quoted" | "declined";
  premiumAmount: string | null;
  premiumCurrency: string | null;
  validUntil: string | null;
  declineReason: string | null;
  evidence: { field: string; words: string }[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const CURRENCY = /\b(KES|KShs?\.?|Ksh|Kshs|USD|US\$)\s?([\d][\d,]*(?:\.\d{1,2})?)\b/gi;
const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const code = (c: string) => (/^us/i.test(c) ? "USD" : "KES");

function dateIn(s: string): string | null {
  const m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i);
  if (m) return iso(new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[2]!.toLowerCase()), Number(m[1]))));
  const n = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (n) return iso(new Date(Date.UTC(Number(n[3]), Number(n[2]) - 1, Number(n[1]))));
  return null;
}

export function readInsurerReply(text: string, sentAt: string, declined: boolean): ReadReply | null {
  const all = sentences(text);
  const declineSentence = all.find((s) => /\b(regret|unable to (offer|quote|provide|cover)|declin(e|es|ed|ing)|not in a position to|cannot offer)\b/i.test(s));
  if (declined || (declineSentence && !CURRENCY.test(text))) {
    CURRENCY.lastIndex = 0;
    if (!declineSentence) return null;
    return { outcome: "declined", premiumAmount: null, premiumCurrency: null, validUntil: null, declineReason: declineSentence.slice(0, 500), evidence: [{ field: "decline", words: declineSentence.slice(0, 300) }] };
  }
  CURRENCY.lastIndex = 0;
  // The premium: an amount in a sentence that says "premium", or the only amount in the email.
  const withAmount = all.map((s) => ({ s, amounts: [...s.matchAll(new RegExp(CURRENCY.source, "gi"))] })).filter((x) => x.amounts.length);
  const premiumSentences = withAmount.filter((x) => /\bpremium\b/i.test(x.s));
  const pick = premiumSentences.length === 1 && premiumSentences[0]!.amounts.length === 1 ? premiumSentences[0]! : withAmount.length === 1 && withAmount[0]!.amounts.length === 1 ? withAmount[0]! : null;
  if (!pick) return null;
  const amount = pick.amounts[0]!;
  const evidence = [{ field: "premium", words: pick.s.slice(0, 300) }];
  let validUntil: string | null = null;
  const validity = all.find((s) => /\bvalid\b/i.test(s));
  if (validity) {
    const days = validity.match(/\bvalid(?:ity)?\s+(?:for\s+)?(\d{1,3})\s+days\b/i);
    validUntil = days ? iso(new Date(new Date(sentAt).getTime() + Number(days[1]) * 86_400_000)) : dateIn(validity);
    if (validUntil) evidence.push({ field: "valid_until", words: validity.slice(0, 300) });
  }
  return { outcome: "quoted", premiumAmount: Number(amount[2]!.replace(/,/g, "")).toFixed(2), premiumCurrency: code(amount[1]!), validUntil, declineReason: null, evidence };
}
