import { IMPORT_COLUMN_SYNONYMS, type ImportColumn, type PremiumBasis } from "../api/imports.js";
import { normaliseHeader, type RawRow } from "./csv.js";

/**
 * Turning a line of somebody's spreadsheet into something ASAP can record — or into a plain
 * sentence about why it cannot.
 *
 * Pure, like the parser, and for the same reason: this is where a book's values are interpreted,
 * and interpreting one wrongly is silent. Dates are the worst of it, so they are handled
 * explicitly and ambiguity is refused rather than resolved by guessing.
 */

/** What one line means, once the columns are known. Nothing here has been written. */
export type InterpretedRow = {
  lineNumber: number;
  clientName: string;
  clientKind: "individual" | "corporate";
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactRole: string | null;
  policyNumber: string | null;
  insurerName: string | null;
  classOfBusiness: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  premiumAmount: string | null;
  premiumCurrency: string | null;
  commissionRate: string | null;
  commissionAmount: string | null;
  /** Plain language, or null when the row is fine. */
  problem: string | null;
};

/**
 * Guess what each header means, from the spellings real exports use.
 *
 * A guess, and returned as one: the preview shows the mapping it used and a person can correct it
 * before anything is written. A header matching nothing maps to null and says so, rather than
 * being quietly attached to whatever was nearest.
 */
export function suggestColumns(headers: string[]): Record<string, ImportColumn | null> {
  const out: Record<string, ImportColumn | null> = {};
  const taken = new Set<ImportColumn>();
  for (const header of headers) {
    const n = normaliseHeader(header);
    let found: ImportColumn | null = null;
    for (const [meaning, spellings] of Object.entries(IMPORT_COLUMN_SYNONYMS)) {
      const m = meaning as ImportColumn;
      // First column to claim a meaning keeps it: a file with both "premium" and "gross premium"
      // must not silently map two columns onto one field, where the last one read would win.
      if (taken.has(m)) continue;
      if (spellings.some((s) => normaliseHeader(s) === n)) {
        found = m;
        break;
      }
    }
    if (found) taken.add(found);
    out[header] = found;
  }
  return out;
}

/** A number as a spreadsheet writes it: thousands separators, a currency symbol, maybe brackets. */
function toDecimal(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  // Accounting negatives — (1,234.00) — are a real thing in exports, and a premium is never
  // negative, so this is recognised in order to be refused rather than read as positive.
  if (/^\(.*\)$/.test(t)) return null;
  const cleaned = t.replace(/[^0-9.]/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * A commission cell, as either a rate or an amount.
 *
 * "12.5%" and "0.125" are the same rate; "150,000" in a rate column is not a rate at all. A value
 * that cannot be read as a fraction of premium is refused rather than stored as one, because a
 * rate above 1 would silently multiply every later figure.
 */
export function toRate(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const isPercent = t.includes("%");
  const n = Number(toDecimal(t));
  if (!Number.isFinite(n)) return null;
  const rate = isPercent ? n / 100 : n > 1 ? n / 100 : n;
  if (rate < 0 || rate > 1) return null;
  return rate.toFixed(4);
}

/**
 * A date, as a spreadsheet writes it, or nothing.
 *
 * ISO (2026-04-01) and unambiguous day-first (01/04/2026 where the first part is over 12) are
 * read. **An ambiguous slash date is refused**: 03/04/2026 is the third of April in Nairobi and
 * the fourth of March elsewhere, and a policy that expires on the wrong one of those is a claim
 * repudiated. The row says so and asks for ISO rather than picking.
 */
export function toDate(raw: string): { value: string | null; problem: string | null } {
  const t = raw.trim();
  if (t === "") return { value: null, problem: null };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return { value: t, problem: null };

  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(t);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    if (a > 12 && b <= 12) {
      return { value: `${year}-${pad(b)}-${pad(a)}`, problem: null }; // day first, unambiguously
    }
    if (b > 12 && a <= 12) {
      return { value: `${year}-${pad(a)}-${pad(b)}`, problem: null }; // month first, unambiguously
    }
    return {
      value: null,
      problem: `"${t}" could be two different dates. Write dates as YYYY-MM-DD so the cover period is not guessed at.`,
    };
  }
  return { value: null, problem: `"${t}" was not recognised as a date. Write dates as YYYY-MM-DD.` };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Whether a client's name reads as a person or a company, when the file did not say. */
function inferKind(name: string, declared: string): "individual" | "corporate" {
  const d = declared.trim().toLowerCase();
  if (d.startsWith("ind") || d === "person" || d === "personal") return "individual";
  if (d.startsWith("corp") || d === "company" || d === "business" || d === "commercial") {
    return "corporate";
  }
  // A conservative default: the suffixes are unambiguous, and everything else is a person, which
  // is the safer wrong answer — a person mis-filed as a company is a correction, whereas a
  // company mis-filed as a person changes which compliance documents are asked for.
  return /\b(ltd|limited|plc|llp|inc|co|company|holdings|group|enterprises|sacco|bank)\b/i.test(name)
    ? "corporate"
    : "individual";
}

export function interpretRow(
  row: RawRow,
  columns: Record<string, ImportColumn | null>,
  premiumBasis: PremiumBasis | null,
): InterpretedRow {
  const get = (meaning: ImportColumn): string => {
    for (const [header, m] of Object.entries(columns)) {
      if (m === meaning) return (row.cells[header] ?? "").trim();
    }
    return "";
  };

  const clientName = get("client_name");
  const problems: string[] = [];
  if (clientName === "") problems.push("This row has no client name, so there is nothing to file it under.");

  const start = toDate(get("period_start"));
  const end = toDate(get("period_end"));
  if (start.problem) problems.push(start.problem);
  if (end.problem) problems.push(end.problem);
  if (start.value && end.value && end.value < start.value) {
    problems.push("The cover period ends before it starts.");
  }

  const premiumRaw = get("premium_amount");
  const premiumAmount = toDecimal(premiumRaw);
  if (premiumRaw !== "" && premiumAmount === null) {
    problems.push(`"${premiumRaw}" was not recognised as an amount.`);
  }
  if (premiumAmount !== null && !premiumBasis) {
    problems.push(
      "This file has a premium column, so it needs to say whether those figures are gross or the total payable.",
    );
  }

  /*
   * Commission, where the column heading is not to be trusted.
   *
   * A column called "Commission" holds a rate as often as an amount — 12.5% and 150,000 both
   * appear under it in real exports. A percent sign settles it whatever the heading said, because
   * reading "12.5%" as an amount would record a rate of twelve and a half shillings, and nothing
   * downstream could tell. The heading decides only when the value does not.
   */
  const commissionRateRaw = get("commission_rate");
  const commissionAmountRaw = get("commission_amount");
  const amountIsReallyARate = commissionAmountRaw.includes("%");
  const rateSource = amountIsReallyARate ? commissionAmountRaw : commissionRateRaw;
  const commissionRate = toRate(rateSource);
  if (rateSource !== "" && commissionRate === null) {
    problems.push(`"${rateSource}" was not recognised as a commission rate.`);
  }
  const commissionAmount = amountIsReallyARate ? null : toDecimal(commissionAmountRaw);

  const policyNumber = get("policy_number") || null;
  // A policy needs its period: cover without dates cannot be renewed, chased or reported on, and
  // recording it anyway creates a record that looks complete and is not.
  if (policyNumber && (!start.value || !end.value)) {
    problems.push("This row has a policy number but no usable cover period.");
  }

  const emailRaw = get("contact_email");
  const emailLooksRight = emailRaw === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw);
  if (!emailLooksRight) {
    problems.push(`"${emailRaw}" is not an email address, so nobody would be reachable at it.`);
  }
  // Judged on its own merit: a bad date elsewhere on the line does not make the address invalid.
  const contactEmail = emailRaw !== "" && emailLooksRight ? emailRaw : null;

  return {
    lineNumber: row.lineNumber,
    clientName,
    clientKind: inferKind(clientName, get("client_kind")),
    contactName: get("contact_name") || null,
    contactEmail,
    contactPhone: get("contact_phone") || null,
    contactRole: get("contact_role") || null,
    policyNumber,
    insurerName: get("insurer_name") || null,
    classOfBusiness: get("class_of_business") || null,
    periodStart: start.value,
    periodEnd: end.value,
    premiumAmount,
    premiumCurrency: (get("premium_currency") || "KES").toUpperCase().slice(0, 3),
    commissionRate,
    commissionAmount,
    problem: problems.length > 0 ? problems.join(" ") : null,
  };
}
