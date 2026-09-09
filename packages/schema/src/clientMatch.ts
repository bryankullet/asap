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
 * One exact normalised match wins. Otherwise every client whose normalised name contains the
 * typed name, or is contained by it, is plausible: one → match, several → ask, none → none.
 */
export function matchClientName(typed: string, clients: readonly ClientCandidate[]): ClientMatch {
  const q = normaliseClientName(typed);
  if (!q) return { outcome: "none" };
  const exact = clients.filter((c) => normaliseClientName(c.name) === q);
  if (exact.length === 1) return { outcome: "one", client: exact[0]! };
  if (exact.length > 1) return { outcome: "many", candidates: exact };
  const plausible = clients.filter((c) => {
    const n = normaliseClientName(c.name);
    return n.includes(q) || q.includes(n);
  });
  if (plausible.length === 1) return { outcome: "one", client: plausible[0]! };
  if (plausible.length > 1) return { outcome: "many", candidates: plausible };
  return { outcome: "none" };
}
