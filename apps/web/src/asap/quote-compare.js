/**
 * Comparing quotation documents as ASAP read them (staging finding, D-135).
 *
 * Built only from the server's readings of each document (`GET /documents/:id/quotation`): every
 * value carries where it was read, and its state — confirmed by a person, or read and not yet
 * confirmed. Nothing here is a recommendation: ASAP never picks an insurer, and when a material
 * term is missing from any quotation it says that no comparison can be relied on yet.
 *
 * Absence is never shown as zero or "included". When ASAP read no value it says "Not extracted —
 * check the document" (D-136): that is what is known — the reading found nothing — and not that the
 * document says nothing, which ASAP cannot establish. A document ASAP could not read is "Could not
 * be read"; a term stated in words nobody can compare is "Unclear"; and a term ASAP does not read at
 * all (payment terms) says so, so a blank is never mistaken for nothing.
 *
 * Every value shows the page it was read from and whether a person has confirmed it. A status
 * warning the quotation states ("indicative terms only", "no cover is in force") is never folded
 * into another row: it has its own row and is raised as a warning.
 */

export const NOT_EXTRACTED = "Not extracted — check the document";

/** The dimensions compared, in the order a broker reads a quotation. */
export const DIMENSIONS = [
  { key: "premium", label: "Premium", field: "premium", material: true },
  { key: "sum_insured", label: "Sum insured", field: "sum_insured" },
  { key: "excess", label: "Excess", term: ["excess"], material: true },
  { key: "limit", label: "Limits", term: ["limit"], material: true },
  // Read by the extractor as `other` terms under one fixed label each (D-136).
  { key: "territory", label: "Geographic scope", term: ["other"], labelled: /^geographic scope$/i },
  { key: "exclusion", label: "Exclusions", term: ["exclusion"] },
  {
    key: "conditions",
    label: "Conditions and subjectivities",
    term: ["condition", "subjectivity"],
  },
  {
    key: "validity",
    label: "Quote validity",
    field: "quote_valid_until",
    orTerm: /^quote validity$/i,
    material: true,
  },
  {
    key: "outstanding",
    label: "Outstanding information",
    term: ["other"],
    labelled: /^outstanding information$/i,
  },
  { key: "status", label: "Status warnings", term: ["other"], labelled: /^status$/i },
  { key: "basis", label: "Premium basis", field: "premium_basis" },
  { key: "payment", label: "Payment terms", notRead: true },
];

const DAY = 86_400_000;

/** Where a value was read and whether a person confirmed it, said beside the value. */
function source(page, confirmed, conflicting = false) {
  const where = page ? "page " + page : "page not placed";
  const state = confirmed
    ? "confirmed"
    : conflicting
      ? "different values on the document"
      : "read, not confirmed";
  return " (" + where + " · " + state + ")";
}

/** A quotation's own words that say it is not cover, or not a firm offer. */
const WARNING = /indicative|not (yet )?(accepted|bound|issued)|no cover|not in force|subject to/i;

/** A date ASAP can compare: ISO or day/month/year. Null when it cannot tell. */
function dateOf(v) {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim());
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const words = Date.parse(v);
  return Number.isNaN(words) ? null : words;
}

/**
 * @param readings  the server's quotation readings, one per document
 * @param fieldIdOf (documentId, fieldKey) → the document field's id, so a value opens at its page
 * @param today     ms since epoch, for the validity check
 */
export function compareQuotations(readings, fieldIdOf = () => null, today = Date.now()) {
  // Each column is the insurer the document names, or its filename when it names none.
  const cols = readings.map((r) => {
    const f = r.fields.find((x) => x.fieldKey === "insurer_name");
    return (f && (f.correctedValue ?? f.proposedValue)) || r.document.filename;
  });
  const missingMaterial = new Map();
  const risks = [];
  const evidence = [];
  const warnings = [];

  const rows = DIMENSIONS.map((dim) => {
    const cells = readings.map((r, i) => {
      const name = cols[i];
      const unreadable = r.needsManualReview || r.document.extractionState === "failed";
      if (dim.notRead) return { v: "Not read by ASAP — check the document", flag: "uncertain" };
      if (unreadable) {
        if (dim.material)
          missingMaterial.set(name, [...(missingMaterial.get(name) || []), dim.label]);
        return { v: "Could not be read", flag: "missing" };
      }
      const fieldRead = dim.field ? r.fields.find((x) => x.fieldKey === dim.field) : null;
      const fieldValue = fieldRead ? (fieldRead.correctedValue ?? fieldRead.proposedValue) : null;
      const useField = dim.field && fieldValue && fieldRead.state !== "rejected";
      if (dim.field && (useField || !dim.orTerm)) {
        const f = fieldRead;
        const value = fieldValue;
        if (!useField) {
          if (dim.material)
            missingMaterial.set(name, [...(missingMaterial.get(name) || []), dim.label]);
          return { v: NOT_EXTRACTED, flag: "missing" };
        }
        const confirmed = f.state === "accepted" || f.state === "corrected";
        const conflicting = f.condition === "conflicting" && !confirmed;
        const currency =
          dim.key === "premium" ? r.fields.find((x) => x.fieldKey === "currency") : null;
        const cur = currency ? (currency.correctedValue ?? currency.proposedValue) : null;
        const shown =
          (cur && dim.key === "premium" && !value.toUpperCase().includes(cur.toUpperCase())
            ? cur + " "
            : "") + value;
        evidence.push({
          insurer: name,
          label: dim.label,
          value: shown,
          documentId: r.document.id,
          fieldId: fieldIdOf(r.document.id, dim.field),
          page: f.page,
          confirmed,
        });
        if (conflicting)
          risks.push({
            insurer: name,
            text:
              dim.label +
              " is given more than one way in the document — check the page before relying on it.",
            documentId: r.document.id,
            page: f.page,
          });
        if (dim.key === "validity") {
          const until = dateOf(value);
          if (until !== null && until < today)
            risks.push({
              insurer: name,
              text: "These terms expired on " + value + ". They would have to be re-quoted.",
              documentId: r.document.id,
              page: f.page,
            });
          else if (until !== null && until - today <= 7 * DAY)
            risks.push({
              insurer: name,
              text: "These terms lapse on " + value + " — within a week.",
              documentId: r.document.id,
              page: f.page,
            });
        }
        return {
          v: shown + source(f.page, confirmed, conflicting),
          flag: confirmed ? "ok" : "uncertain",
        };
      }
      // Terms: every reading of that kind, never flattened into one.
      const kinds = dim.term ?? ["other"];
      const named = dim.labelled ?? dim.orTerm;
      const terms = r.proposals.filter(
        (t) =>
          kinds.includes(t.termType) &&
          t.state !== "rejected" &&
          (!named || named.test(t.label.trim())) &&
          // An `other` term with a fixed label belongs to its own row, never to Limits or Exclusions.
          (t.termType !== "other" || named),
      );
      if (!terms.length) {
        if (dim.material)
          missingMaterial.set(name, [...(missingMaterial.get(name) || []), dim.label]);
        if (dim.key === "excess")
          risks.push({
            insurer: name,
            text: "No excess was found in this quotation — the client could not tell what they would pay on a claim.",
            documentId: r.document.id,
            page: null,
          });
        return { v: NOT_EXTRACTED, flag: "missing" };
      }
      // A term labelled only with its own kind ("Excess", "Exclusions") is not said twice.
      const generic = (t) =>
        !!named ||
        /^((key|main|principal) )?(exclusions?|excess(es)?|limits?( of liability)?|conditions?|subjectivit(y|ies))$/i.test(
          t.label.trim(),
        );
      for (const t of terms) {
        const value = t.correctedValue ?? t.proposedValue;
        const confirmed = t.state === "accepted" || t.state === "corrected";
        evidence.push({
          insurer: name,
          label: generic(t) ? dim.label : dim.label + " — " + t.label,
          value: value ?? "unclear",
          documentId: r.document.id,
          fieldId: null,
          page: t.page,
          confirmed,
        });
        if (dim.key === "status" && value && WARNING.test(value)) {
          warnings.push({
            insurer: name,
            text: value,
            documentId: r.document.id,
            page: t.page,
            confirmed,
          });
          risks.push({
            insurer: name,
            text: "Status warning: " + value,
            documentId: r.document.id,
            page: t.page,
          });
        }
        if (dim.key === "status" || dim.key === "validity" || dim.key === "outstanding") continue;
        if (t.condition === "unclear" || !value)
          risks.push({
            insurer: name,
            text:
              dim.label +
              " “" +
              t.label +
              "” is stated in words that cannot be compared — read it on the page.",
            documentId: r.document.id,
            page: t.page,
          });
        else if (dim.key === "exclusion" || t.termType === "subjectivity")
          risks.push({
            insurer: name,
            text:
              (dim.key === "exclusion" ? "Excludes: " : "Subject to: ") +
              (generic(t) ? value : t.label + (value && value !== t.label ? " — " + value : "")),
            documentId: r.document.id,
            page: t.page,
          });
      }
      const allConfirmed = terms.every((t) => t.state === "accepted" || t.state === "corrected");
      const anyUnclear = terms.some(
        (t) => t.condition === "unclear" || !(t.correctedValue ?? t.proposedValue),
      );
      return {
        v: terms
          .map(
            (t) =>
              (generic(t) ? "" : t.label + ": ") +
              (t.correctedValue ?? t.proposedValue ?? "unclear") +
              source(t.page, t.state === "accepted" || t.state === "corrected"),
          )
          .join("; "),
        flag:
          dim.key === "status" && warnings.some((w) => w.documentId === r.document.id)
            ? "missing"
            : anyUnclear
              ? "missing"
              : allConfirmed
                ? "ok"
                : "uncertain",
      };
    });
    return { label: dim.label, cells };
  });

  const unconfirmed = evidence.filter((e) => !e.confirmed).length;
  // In column order, so the words read in the order the table does.
  const missing = [...missingMaterial.entries()].sort(
    (a, b) => cols.indexOf(a[0]) - cols.indexOf(b[0]),
  );
  return {
    cols,
    rows,
    evidence,
    risks,
    warnings,
    missingMaterial: missing.map(([insurer, labels]) => ({ insurer, labels })),
    unconfirmed,
    // Never a pick. The reason is the honest one for this comparison.
    recommendation: null,
    whyNoRecommendation: missingMaterial.size
      ? "No quotation can be recommended: material terms are missing — " +
        missing.map(([n, l]) => n + " (" + l.join(", ") + ")").join("; ") +
        "."
      : unconfirmed
        ? "ASAP does not recommend an insurer, and these values are still readings nobody has confirmed. Review each quotation before presenting a comparison."
        : "ASAP does not recommend an insurer. The client chooses from the confirmed terms.",
  };
}
