/**
 * What happened, taken out of how the person asked for it (staging finding, D-135).
 *
 * A claim request mixes the incident with directions about the work: "…front-left body damage, no
 * injury reported. Do not contact anyone." The directions are not part of the loss and must never
 * be saved as "What happened" — nor may the facts be lost because they came before the word
 * "claim". Each clause is classified: a direction (an instruction to ASAP or about the workflow)
 * is dropped; the lead-in that names the request ("Report a claim for <client>:") is trimmed; what
 * remains is kept only if it reads as an incident. When it does not, the result says so, and the
 * caller asks the person to write what happened rather than saving the prompt.
 */

/** A clause that is a direction about the work, not a fact about the loss. */
const DIRECTION =
  /^(?:(?:but|and|then|please|also|just|only)\s+)*(?:do not|don't|dont|never|no need to|not to|prepare|report|register|open|draft|create|start|log|file|notify|contact|send|submit|email|call|tell|inform|keep|leave|hold|wait|show|make sure|ensure|let me|i will|i'll|until|without (?:contacting|notifying|sending|registering)|this is a test|for testing)\b/i;
/** Directions that can sit inside a clause after the facts: "…, and do not notify the insurer". */
const TRAILING_DIRECTION =
  /[,;]?\s*(?:but|and|then)?\s*(?:please\s+)?(?:do not|don't|dont|never|without)\s+(?:contact|contacting|notify|notifying|send|sending|register|registering|submit|submitting|tell|telling|inform|informing|email|emailing|call|calling)\b.*$/i;
/** The request at the start of a clause: "Report a claim", "Open a claim draft for", "Report a claim:". */
const REQUEST =
  /^(?:please\s+)?(?:report|open|prepare|register|log|file|start|create|draft|record)\s+(?:a\s+|the\s+|an\s+)?(?:new\s+)?(?:draft\s+)?(?:motor\s+)?claim(?:\s+draft)?\s*/i;
/** The policy-choice words the clarifying question appends: "— policy not known". */
const POLICY_NOTE =
  /\s*(?:[—–]|-|,)?\s*(?:the\s+)?policy\s+(?:is\s+)?(?:not known(?: yet)?|unknown)\s*\.?$/i;

/**
 * Trims the request off the start of a clause. "for <client>:" names who it is for and goes with
 * it; "for the accident yesterday" is the loss itself and stays.
 */
function trimRequest(clause) {
  const req = REQUEST.exec(clause);
  if (!req) return clause;
  let rest = clause.slice(req[0].length);
  const forWhom =
    /^(?:for|about|on behalf of|under)\s+([^:—–]*?)\s*(?::|—|–|\s-\s|,)\s*(.*)$/i.exec(rest);
  if (forWhom && !INCIDENT.test(forWhom[1])) return forWhom[2];
  rest = rest.replace(/^(?:for|about|on behalf of)\s+/i, "").replace(/^[:—–,-]\s*/, "");
  return rest;
}
/** Words that make a clause about a loss. */
const INCIDENT =
  /\b(collision|collided|accident|crash(?:ed)?|hit|struck|knocked|rear-?ended|reversed into|overturned|damage[sd]?|dent(?:ed)?|scratch(?:ed|es)?|broken|broke|smashed|cracked|theft|stolen|burglar(?:y|ised|ized)|break-?in|fire|burnt|burned|flood(?:ed)?|burst|leak(?:ed)?|injur(?:y|ies|ed)|hurt|loss|lost)\b/i;

export function incidentFacts(raw) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  // Sentences, then the clauses a sentence joins with ";" or ". " — keeping dates like 2.10.2026 whole.
  const clauses = text
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9"“])|;\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
  const facts = [];
  const directions = [];
  for (let clause of clauses) {
    clause = trimRequest(clause.replace(POLICY_NOTE, ""));
    // "Prepare a draft claim for X but do not register it": the whole clause is a direction.
    if (DIRECTION.test(clause) && !INCIDENT.test(clause.replace(TRAILING_DIRECTION, ""))) {
      directions.push(clause);
      continue;
    }
    const trailing = TRAILING_DIRECTION.exec(clause);
    if (trailing) {
      directions.push(trailing[0].replace(/^[,;\s]+/, ""));
      clause = clause.slice(0, trailing.index);
    }
    // A clause that still starts with a direction but carries facts after a dash or colon.
    const afterLead = /^(?:keep|leave|hold)\b[^—:–]*[—:–]\s*(.+)$/i.exec(clause);
    if (afterLead) clause = afterLead[1];
    clause = clause.replace(/^[,;:\-—–\s]+|[,;:\-—–\s]+$/g, "");
    if (clause) facts.push(clause);
  }
  const kept = facts.filter(
    (f) =>
      INCIDENT.test(f) ||
      /\b(no|not)\b.*\b(injur|hurt)/i.test(f) ||
      /\b[A-Z]{3}\s?\d{3}[A-Z]\b/.test(f),
  );
  // One clause stays as written; several are joined as sentences.
  const cap = (f) => f.charAt(0).toUpperCase() + f.slice(1);
  const sentence =
    kept.length === 1
      ? cap(kept[0])
      : kept
          .map(cap)
          .map((f) => (/[.!?]$/.test(f) ? f : f + "."))
          .join(" ");
  const confident = kept.some((f) => INCIDENT.test(f)) && sentence.length >= 15;
  return { facts: confident ? sentence : null, directions };
}
