/**
 * The issued policy, field by field, against what it must agree with (4B-5).
 *
 * Three sources, each immutable where it is read from:
 *   1. the client's latest accepted instruction (their conditions, and any period they gave);
 *   2. the frozen placement basis (what the client accepted, including accepted changes);
 *   3. the insurer's cover confirmation (what the insurer confirmed before issuing).
 *
 * And one side under test: the values a person reviewed off the issued policy document — each
 * carrying the reviewed field or term it came from, so every issued value opens at its page.
 *
 * Six classifications, in words, never a colour alone:
 *   match              Matches
 *   changed            Changed
 *   missing_from_issued Missing from issued policy
 *   added_by_insurer   Added by insurer
 *   unclear            Needs a person to check
 *   not_applicable     Not stated in either source
 *
 * Pure and deterministic, so each rule is held by a test. It decides nothing about cover.
 */

export type IssuedClass = "match" | "changed" | "missing_from_issued" | "added_by_insurer" | "unclear" | "not_applicable";

export type IssuedEvidence = {
  documentFieldId: string | null;
  documentTermProposalId: string | null;
  page: number | null;
};

export type IssuedCheckItem = {
  field: string;
  termType: string | null;
  label: string;
  instructionValue: string | null;
  basisValue: string | null;
  confirmationValue: string | null;
  issuedValue: string | null;
  classification: IssuedClass;
  material: boolean;
  calculation: string | null;
  evidence: IssuedEvidence | null;
};

export type IssuedValue = { value: string | null; evidence: IssuedEvidence };

export type Term = { termType: string; label: string; value: string | null };

export type IssuedCheckInput = {
  clientName: string;
  insurerName: string;
  requestedPolicyNumber: string | null;
  instruction: {
    conditions: { text: string; state: "confirmed_by_insurer" | "satisfied" | "waived" | "unresolved" }[];
  };
  basis: {
    version: number;
    acceptedChanges: boolean;
    classOfBusiness: string | null;
    effectiveAt: string | null;
    expiryAt: string | null;
    derivedExpiryAt: string | null;
    derivation: string | null;
    premiumAmount: string | null;
    premiumCurrency: string | null;
    premiumBasis: string | null;
    sumInsured: string | null;
    terms: Term[];
  };
  confirmation: {
    insurerName: string | null;
    classOfBusiness: string | null;
    effectiveAt: string | null;
    expiryAt: string | null;
    premiumAmount: string | null;
    premiumCurrency: string | null;
    premiumBasis: string | null;
    terms: Term[];
  };
  /** Reviewed issued values by field key: insured_name, insurer_name, policy_number, … */
  issued: Record<string, IssuedValue | undefined>;
  issuedTerms: (Term & { evidence: IssuedEvidence })[];
};

/** Whitespace, case and thousands separators are presentation, not a change in terms. */
function norm(value: string | null): string | null {
  if (value === null) return null;
  const v = value.trim().replace(/\s+/g, " ").toLowerCase();
  return v === "" ? null : v.replace(/(\d),(?=\d{3}\b)/g, "$1");
}

function amount(value: string | null): number | null {
  if (value === null) return null;
  const cleaned = value.replace(/[^0-9.,-]/g, "");
  if (!/^-?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^-?[0-9]+(\.[0-9]+)?$/.test(cleaned)) return null;
  const n = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A date as the calendar day it names (UTC). A schedule prints days, not instants. */
function calendarDay(value: string | null): string | null {
  if (value === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (m) return m[1]!;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function accepted(...values: (string | null)[]): string | null {
  return values.find((v) => v !== null) ?? null;
}

type Row = Omit<IssuedCheckItem, "classification" | "material" | "calculation"> & { calculation?: string | null };

/** Classify one row: what was accepted (instruction, else basis) against what was issued. */
function classify(row: Row, same: (a: string, b: string) => boolean, materialWhenDifferent = true): IssuedCheckItem {
  const acceptedValue = accepted(row.basisValue, row.instructionValue);
  const issued = row.issuedValue;
  const base = { ...row, calculation: row.calculation ?? null };
  if (acceptedValue === null && issued === null) return { ...base, classification: "not_applicable", material: false };
  if (acceptedValue !== null && issued === null) return { ...base, classification: "missing_from_issued", material: materialWhenDifferent };
  if (acceptedValue === null && issued !== null) return { ...base, classification: "added_by_insurer", material: materialWhenDifferent };
  const matches = same(acceptedValue!, issued!);
  return { ...base, classification: matches ? "match" : "changed", material: !matches && materialWhenDifferent };
}

const textSame = (a: string, b: string) => norm(a) === norm(b);
const amountSame = (a: string, b: string) => {
  const x = amount(a);
  const y = amount(b);
  return x !== null && y !== null ? x === y : norm(a) === norm(b);
};
const daySame = (a: string, b: string) => calendarDay(a) === calendarDay(b);

export function checkIssuedPolicy(input: IssuedCheckInput): IssuedCheckItem[] {
  const out: IssuedCheckItem[] = [];
  const b = input.basis;
  const c = input.confirmation;
  const iv = (key: string) => input.issued[key] ?? { value: null, evidence: null };
  const v = (key: string) => iv(key).value ?? null;
  const ev = (key: string) => (input.issued[key] ? input.issued[key]!.evidence : null);

  out.push(classify({ field: "insured", termType: null, label: "Insured", instructionValue: input.clientName, basisValue: input.clientName, confirmationValue: null, issuedValue: v("insured_name"), evidence: ev("insured_name") }, textSame));
  out.push(classify({ field: "insurer", termType: null, label: "Insurer", instructionValue: null, basisValue: input.insurerName, confirmationValue: c.insurerName, issuedValue: v("insurer_name"), evidence: ev("insurer_name") }, textSame));

  /* The insurer assigns the number. Its absence is material; its presence, unrequested, is expected. */
  const number = v("policy_number");
  if (input.requestedPolicyNumber === null) {
    out.push({
      field: "policy_number", termType: null, label: "Policy number", instructionValue: null, basisValue: null, confirmationValue: null,
      issuedValue: number, evidence: ev("policy_number"), calculation: null,
      classification: number === null ? "missing_from_issued" : "added_by_insurer", material: number === null,
    });
  } else {
    out.push(classify({ field: "policy_number", termType: null, label: "Policy number", instructionValue: input.requestedPolicyNumber, basisValue: null, confirmationValue: null, issuedValue: number, evidence: ev("policy_number") }, textSame));
  }

  out.push(classify({ field: "class_of_business", termType: null, label: "Class of business", instructionValue: null, basisValue: b.classOfBusiness, confirmationValue: c.classOfBusiness, issuedValue: v("class_of_business"), evidence: ev("class_of_business") }, textSame));
  out.push(classify({ field: "inception", termType: null, label: "Cover begins", instructionValue: null, basisValue: calendarDay(b.effectiveAt), confirmationValue: calendarDay(c.effectiveAt), issuedValue: calendarDay(v("period_start")), evidence: ev("period_start") }, daySame));

  /*
   * The end. An accepted end date is compared as the day it names. With only an explicit period,
   * the frozen derived end is compared and its calculation shown. An accepted end at midnight
   * against a schedule printing the day before is the same cover if the schedule means the end of
   * that day — but that is a reading of the schedule, so a person decides.
   */
  const acceptedEnd = b.expiryAt ?? b.derivedExpiryAt;
  const issuedEnd = calendarDay(v("period_end"));
  const endRow: Row = {
    field: "expiry", termType: null, label: "Cover ends", instructionValue: null, basisValue: calendarDay(acceptedEnd),
    confirmationValue: calendarDay(c.expiryAt), issuedValue: issuedEnd, evidence: ev("period_end"),
    calculation: b.expiryAt === null ? b.derivation : null,
  };
  const endItem = classify(endRow, daySame);
  if (endItem.classification === "changed" && acceptedEnd !== null && issuedEnd !== null
      && /T00:00:00(\.000)?(Z|\+00:00)$/.test(acceptedEnd) && dayBefore(calendarDay(acceptedEnd)!) === issuedEnd) {
    out.push({
      ...endItem, classification: "unclear", material: true,
      calculation: `${endItem.calculation ?? "The accepted end is the start of " + calendarDay(acceptedEnd) + "."} The schedule's last day is ${issuedEnd}: the same cover if it means the end of that day. A person confirms.`,
    });
  } else {
    out.push(endItem);
  }

  out.push(classify({ field: "currency", termType: null, label: "Currency", instructionValue: null, basisValue: b.premiumCurrency, confirmationValue: c.premiumCurrency, issuedValue: v("currency"), evidence: ev("currency") }, textSame));
  out.push(classify({ field: "premium", termType: null, label: "Premium", instructionValue: null, basisValue: b.premiumAmount, confirmationValue: c.premiumAmount, issuedValue: v("premium"), evidence: ev("premium") }, amountSame));
  out.push(classify({ field: "premium_basis", termType: null, label: "Premium basis", instructionValue: null, basisValue: b.premiumBasis, confirmationValue: c.premiumBasis, issuedValue: v("premium_basis"), evidence: ev("premium_basis") }, textSame));

  /* A sum insured the accepted sources never stated cannot be matched: a person checks it. */
  const si = classify({ field: "sum_insured", termType: null, label: "Sum insured", instructionValue: null, basisValue: b.sumInsured, confirmationValue: null, issuedValue: v("sum_insured"), evidence: ev("sum_insured") }, amountSame);
  out.push(si.classification === "added_by_insurer" ? { ...si, classification: "unclear", material: true } : si);

  /* Every accepted term, then every term only the issued policy states. */
  const key = (t: { termType: string; label: string }) => `${t.termType}|${norm(t.label)}`;
  const issuedByKey = new Map(input.issuedTerms.map((t) => [key(t), t] as const));
  const confirmedByKey = new Map(c.terms.map((t) => [key(t), t] as const));
  const seen = new Set<string>();
  for (const t of b.terms) {
    const k = key(t);
    seen.add(k);
    const issued = issuedByKey.get(k);
    out.push(classify({
      field: "term", termType: t.termType, label: t.label, instructionValue: null, basisValue: t.value,
      confirmationValue: confirmedByKey.get(k)?.value ?? null, issuedValue: issued?.value ?? null, evidence: issued?.evidence ?? null,
      calculation: b.acceptedChanges ? `Accepted by the client in version ${b.version} of what they accepted.` : null,
    }, textSame));
  }
  for (const t of input.issuedTerms) {
    if (seen.has(key(t))) continue;
    out.push({
      field: "term", termType: t.termType, label: t.label, instructionValue: null, basisValue: null,
      confirmationValue: confirmedByKey.get(key(t))?.value ?? null, issuedValue: t.value, evidence: t.evidence,
      classification: "added_by_insurer", material: true, calculation: null,
    });
  }

  /* The client's own conditions: resolved ones match; an unresolved one needs a person. */
  for (const cond of input.instruction.conditions) {
    out.push({
      field: "client_condition", termType: null, label: cond.text, instructionValue: cond.text, basisValue: null, confirmationValue: null,
      issuedValue: null, evidence: null,
      classification: cond.state === "unresolved" ? "unclear" : "match",
      material: cond.state === "unresolved",
      calculation: cond.state === "confirmed_by_insurer" ? "Confirmed by the insurer." : cond.state === "satisfied" ? "Satisfied, with evidence." : cond.state === "waived" ? "Waived by the client, with evidence." : null,
    });
  }
  return out;
}

export const ISSUED_CLASS_WORDS: Record<IssuedClass, string> = {
  match: "Matches",
  changed: "Changed",
  missing_from_issued: "Missing from issued policy",
  added_by_insurer: "Added by insurer",
  unclear: "Needs a person to check",
  not_applicable: "Not stated in either source",
};
