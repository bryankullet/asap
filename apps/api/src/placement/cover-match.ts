/**
 * `placement.verify_cover_match` — the insurer's confirmation against what the client accepted.
 *
 * Pure and deterministic, so the same two inputs always give the same answer and a test can hold
 * it to every classification. Both inputs are immutable records — an accepted basis version and
 * an insurer-response row — never the mutable quote rows, so the result describes what was
 * actually agreed and what was actually confirmed.
 *
 * Six classifications, never a blank:
 *   match                      — both say the same thing;
 *   changed                    — both say something, and it differs;
 *   missing_from_confirmation  — the client accepted it; the insurer's confirmation is silent;
 *   added_by_insurer           — the insurer confirmed a term the client never accepted;
 *   unclear                    — one side says something that cannot be compared;
 *   not_applicable             — neither side states it, and nothing turns on that.
 *
 * "Material" marks a difference a person must resolve before a policy is issued: every changed,
 * missing, added or unclear term, and any change to who, what, when or how much. A difference in
 * spacing, case or thousands separators is presentation, and is a match.
 */

export type MatchClass =
  | "match"
  | "changed"
  | "missing_from_confirmation"
  | "added_by_insurer"
  | "unclear"
  | "not_applicable";

export type MatchItem = {
  field: string;
  termType: string | null;
  label: string;
  acceptedValue: string | null;
  confirmedValue: string | null;
  classification: MatchClass;
  material: boolean;
  /** How a derived value was reached, with its source. Null when nothing was derived. */
  calculation: string | null;
};

export type SideTerm = {
  termType: string;
  label: string;
  value: string | null;
  amount: string | null;
  currency: string | null;
  unclear: boolean;
};

export type BasisSide = {
  insurerName: string;
  classOfBusiness: string | null;
  subject: string | null;
  effectiveAt: string | null;
  expiryAt: string | null;
  premiumAmount: string | null;
  premiumCurrency: string | null;
  premiumBasis: string | null;
  /** Carried for display only: client conditions are resolved separately (0056), never matched. */
  clientConditions: string | null;
  outstandingRequirements: string | null;
  /** An explicit accepted cover period. Null means none was accepted — and none is assumed. */
  periodMonths: number | null;
  periodDays: number | null;
  terms: SideTerm[];
};

export type ConfirmationSide = {
  insurerName: string | null;
  classOfBusiness: string | null;
  subject: string | null;
  effectiveAt: string | null;
  expiryAt: string | null;
  premiumAmount: string | null;
  premiumCurrency: string | null;
  premiumBasis: string | null;
  terms: SideTerm[];
};

/** Whitespace, case and thousands separators are presentation, not a change in terms. */
function norm(value: string | null): string | null {
  if (value === null) return null;
  const v = value.trim().replace(/\s+/g, " ").toLowerCase();
  return v === "" ? null : v.replace(/(\d),(?=\d{3}\b)/g, "$1");
}

function sameMoment(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function money(amount: string | null, currency: string | null): string | null {
  if (amount === null) return null;
  const n = Number(amount);
  return `${currency ?? ""} ${Number.isNaN(n) ? amount : n.toLocaleString("en-KE")}`.trim();
}

function termText(t: { value: string | null; amount: string | null; currency: string | null }): string | null {
  return t.value ?? money(t.amount, t.currency);
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The end of an accepted period: whole calendar months, then days, from the accepted start, to the
 * same instant. A month end that does not exist in the target month falls to that month's last
 * day (31 Jan + 1 month = 28 or 29 Feb). This is the whole rule, and the calculation says so.
 */
export function endOfPeriod(startIso: string, months: number, days: number): string {
  const start = new Date(startIso);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
  end.setUTCDate(end.getUTCDate() + days);
  return end.toISOString();
}

function periodWords(months: number, days: number): string {
  return [months > 0 ? `${months} ${months === 1 ? "month" : "months"}` : null, days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : null]
    .filter(Boolean)
    .join(" and ");
}

/** One header field. A field the confirmation leaves empty is missing, not a match. */
function header(
  field: string,
  label: string,
  accepted: string | null,
  confirmed: string | null,
  material: boolean,
  same: (a: string | null, b: string | null) => boolean = (a, b) => norm(a) === norm(b),
): MatchItem {
  const base = { field, termType: null, label, acceptedValue: accepted, confirmedValue: confirmed, calculation: null };
  if (accepted === null && confirmed === null) return { ...base, classification: "not_applicable", material: false };
  if (accepted !== null && confirmed === null) return { ...base, classification: "missing_from_confirmation", material };
  if (accepted === null && confirmed !== null) return { ...base, classification: "added_by_insurer", material };
  const matches = same(accepted, confirmed);
  return { ...base, classification: matches ? "match" : "changed", material: !matches && material };
}

export function verifyCoverMatch(basis: BasisSide, confirmation: ConfirmationSide): MatchItem[] {
  const items: MatchItem[] = [];

  /* An insurer confirming its own cover is the insurer unless it names another. */
  items.push(header("insurer", "Insurer", basis.insurerName, confirmation.insurerName ?? basis.insurerName, true));
  items.push(header("class_of_business", "Class of business", basis.classOfBusiness, confirmation.classOfBusiness, true));
  items.push(header("subject", "Risk or subject matter", basis.subject, confirmation.subject, true));
  items.push(header("effective_at", "Cover begins", basis.effectiveAt, confirmation.effectiveAt, true, sameMoment));
  items.push(coverEnd(basis, confirmation));
  items.push(
    header("premium", "Premium", money(basis.premiumAmount, basis.premiumCurrency), money(confirmation.premiumAmount, confirmation.premiumCurrency), true,
      () => basis.premiumAmount !== null && confirmation.premiumAmount !== null && Number(basis.premiumAmount) === Number(confirmation.premiumAmount)),
  );
  items.push(header("currency", "Currency", basis.premiumCurrency, confirmation.premiumCurrency, true));
  items.push(header("premium_basis", "Premium basis", basis.premiumBasis, confirmation.premiumBasis, false));

  /*
   * Anything outstanding is the broker's to carry. Client conditions are not compared here at
   * all: they are resolved one by one — confirmed, satisfied or waived — in their own state
   * (0056), because a client is never asked to "accept" their own condition.
   */
  const outstanding = basis.outstandingRequirements;
  items.push(
    outstanding === null
      ? { field: "outstanding_requirements", termType: null, label: "Outstanding requirements", acceptedValue: null, confirmedValue: null, classification: "not_applicable", material: false, calculation: null }
      : { field: "outstanding_requirements", termType: null, label: "Outstanding requirements", acceptedValue: outstanding, confirmedValue: null, classification: "unclear", material: false, calculation: null },
  );

  /* Every accepted term, then every term only the insurer states. */
  const key = (t: { termType: string; label: string }) => `${t.termType}|${norm(t.label)}`;
  const confirmedByKey = new Map(confirmation.terms.map((t) => [key(t), t] as const));
  const seen = new Set<string>();

  for (const accepted of basis.terms) {
    const k = key(accepted);
    seen.add(k);
    const confirmed = confirmedByKey.get(k) ?? null;
    const a = termText(accepted);
    const base = { field: "term", termType: accepted.termType, label: accepted.label, acceptedValue: a, calculation: null };
    if (confirmed === null) {
      items.push({ ...base, confirmedValue: null, classification: "missing_from_confirmation", material: true });
      continue;
    }
    const c = termText(confirmed);
    if (accepted.unclear || confirmed.unclear) {
      items.push({ ...base, confirmedValue: c, classification: "unclear", material: true });
      continue;
    }
    const same = norm(a) === norm(c);
    items.push({ ...base, confirmedValue: c, classification: same ? "match" : "changed", material: !same });
  }

  for (const confirmed of confirmation.terms) {
    if (seen.has(key(confirmed))) continue;
    items.push({
      field: "term",
      termType: confirmed.termType,
      label: confirmed.label,
      acceptedValue: null,
      confirmedValue: termText(confirmed),
      classification: confirmed.unclear ? "unclear" : "added_by_insurer",
      material: true,
      calculation: null,
    });
  }

  return items;
}

/**
 * The end of cover. An accepted end date is compared as a date. With none, an explicit accepted
 * period gives the exact end, shown with its calculation. With neither, whatever end the insurer
 * states is a term the client never accepted — material, and theirs to accept. No annual term is
 * assumed, ever.
 */
function coverEnd(basis: BasisSide, confirmation: ConfirmationSide): MatchItem {
  const plain = header("expiry_at", "Cover ends", basis.expiryAt, confirmation.expiryAt, true, sameMoment);
  if (basis.expiryAt !== null) return plain;
  const months = basis.periodMonths ?? 0;
  const days = basis.periodDays ?? 0;
  if (months + days === 0 || basis.effectiveAt === null) return plain;

  const derived = endOfPeriod(basis.effectiveAt, months, days);
  const calculation = `Cover begins ${day(basis.effectiveAt)} + ${periodWords(months, days)} = ${day(derived)}, from the cover period in the client's accepted instruction.`;
  if (confirmation.expiryAt === null) {
    return { ...plain, acceptedValue: derived, classification: "missing_from_confirmation", material: true, calculation };
  }
  const same = sameMoment(derived, confirmation.expiryAt);
  return { ...plain, acceptedValue: derived, classification: same ? "match" : "changed", material: !same, calculation };
}

export function summarise(items: MatchItem[]): { material: number; unclear: number } {
  return {
    material: items.filter((i) => i.material).length,
    unclear: items.filter((i) => i.classification === "unclear").length,
  };
}
