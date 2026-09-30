/**
 * Why a prepared message may not be reviewed or sent, in words a broker reads (D-123). One rule,
 * shared: the API refuses to prepare such a draft, and the web refuses to offer sending it.
 *
 * Checked on the raw draft, before any clean-up. A draft carrying "undefined", "null" or "NaN", a
 * demo or example address, a recipient that is not an address at all, no insured, an unresolved
 * insurer, or no policy (unless the policy is explicitly recorded as not known) is never sendable.
 * Fields the caller does not pass (`insured`, `insurer`, `policy`) are not checked.
 */
export type DraftForCheck = {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
  text?: string | null;
  recipients?: (string | null | undefined)[];
  insured?: string | null;
  insurer?: string | null;
  policy?: string | null;
  policyUnknown?: boolean;
};

const FAKE_ADDRESS = /\.demo\b|@example\./i;
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function draftProblems(d: DraftForCheck): string[] {
  const out: string[] = [];
  const text = [d.subject, d.body, d.text, d.to].filter((v) => v != null).map(String).join("\n");
  if (/\b(undefined|null|NaN)\b/.test(text)) out.push("the draft has a blank value in it");
  const to = [d.to, ...(d.recipients ?? [])].filter((e): e is string => typeof e === "string" && e.trim() !== "");
  if (to.length === 0) out.push("no recipient address is on file");
  else if (to.some((e) => FAKE_ADDRESS.test(e) || FAKE_ADDRESS.test(text))) out.push("its recipient is not a real address on file");
  else if (to.some((e) => !ADDRESS.test(e.trim()))) out.push("its recipient is a name, not a verified address");
  if ("insured" in d && !d.insured) out.push("the insured is missing");
  if ("insurer" in d && !d.insurer) out.push("the insurer is not resolved");
  if ("policy" in d && !d.policy && d.policyUnknown !== true) out.push("no policy is named and it is not recorded as unknown");
  return out;
}
