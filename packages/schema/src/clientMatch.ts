/**
 * Matching a typed name to existing clients (v1 catalogue Part 1: "Ask for a choice when a name
 * or policy period is ambiguous"; H02: "Renew Acme: ask which"). Ask never creates a client from
 * a name. Normalisation: case, punctuation, whitespace and trailing legal suffixes are ignored.
 */
const LEGAL_SUFFIXES = [
  "limited",
  "ltd",
  "plc",
  "llp",
  "llc",
  "inc",
  "co",
  "company",
  "corp",
  "corporation",
];

export function normaliseClientName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

export type ClientCandidate = { id: string; name: string; kind: "individual" | "corporate" };

export type ClientMatch =
  | { outcome: "one"; client: ClientCandidate }
  | { outcome: "many"; candidates: ClientCandidate[] }
  | { outcome: "none" };

/**
 * One exact normalised match wins. A partial match is never a sure one: it only proposes the
 * client for a person to confirm ("many", even when there is a single candidate). A name is only
 * a partial match when one name's words appear, whole and in order, inside the other's, and the
 * shorter name has at least three characters — so a client called "A" is not "Rapid Test Motors",
 * which is exactly how an import once filed a policy under the wrong client.
 */
export function matchClientName(typed: string, clients: readonly ClientCandidate[]): ClientMatch {
  const q = normaliseClientName(typed);
  if (!q) return { outcome: "none" };
  const exact = clients.filter((c) => normaliseClientName(c.name) === q);
  if (exact.length === 1) return { outcome: "one", client: exact[0]! };
  if (exact.length > 1) return { outcome: "many", candidates: exact };
  const wholeWords = (short: string, long: string) => short.length >= 3 && (" " + long + " ").includes(" " + short + " ");
  const plausible = clients.filter((c) => {
    const n = normaliseClientName(c.name);
    return wholeWords(q, n) || wholeWords(n, q);
  });
  if (plausible.length > 0) return { outcome: "many", candidates: plausible };
  return { outcome: "none" };
}
