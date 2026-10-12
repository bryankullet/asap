import type { RenewalLivingFacts } from "./facts.js";

/**
 * Exploring a client decision before it is made (D-160): "if the client chose this insurer". Every
 * figure is read from the quotation and the expiring period; the comparison is with what the client
 * has today, never a ranking of insurers, and nothing is written. What choosing would set in motion
 * is the governed path (instruction with evidence → approved placement request → insurer
 * confirmation → issuance), said in order so the consequence of a choice is visible before it.
 */

const DAY = 86_400_000;
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const EXPLORE_NOTICE = "Exploring only: nothing is recorded, nothing is sent, and ASAP does not recommend a choice. The client decides; recording their instruction is a separate, evidenced step.";
const valueOf = (t: { correctedValue: string | null; extractedValue: string | null; amount?: string | null; currency?: string | null }) =>
  t.correctedValue ?? t.extractedValue ?? (t.amount ? `${t.currency ?? ""} ${t.amount}`.trim() : null);

export function explorationPanel(f: RenewalLivingFacts, exploring: string[], now: Date) {
  const o = f.opportunity;
  if (!o || f.placement) return null;
  const live = o.insurers.filter((i) => !i.removedAt);
  const answered = live.filter((i) => i.response);
  if (!answered.length) return null;
  const current = f.period;
  const expiringInsurer = live.find((i) => (current?.insurerId ? i.insurerId === current.insurerId : i.insurerName === current?.insurerName));
  const baseline = expiringInsurer?.response?.terms ?? [];

  const alternatives = exploring
    .map((id) => live.find((i) => i.id === id))
    .filter((i): i is (typeof live)[number] => !!i)
    .slice(0, 3)
    .map((i) => {
      const r = i.response;
      const quoted = r?.outcome === "quoted" && r.premiumAmount != null && r.premiumCurrency != null;
      const unavailableReason = !r ? "No answer is on file yet." : r.outcome === "declined" ? `Declined${r.declineReason ? `: ${r.declineReason}` : "."}` : r.outcome === "no_response" ? "The insurer will not respond." : !quoted ? "No premium is on file, so it cannot be compared." : null;
      const amount = quoted ? Number(r!.premiumAmount) : null;
      const exp = current?.premiumAmount != null && current.premiumCurrency ? { amount: Number(current.premiumAmount), currency: current.premiumCurrency } : null;
      let versusExpiring: string | null = null;
      let direction: "increase" | "decrease" | "same" | "unknown" = "unknown";
      if (amount != null && exp && exp.currency === r!.premiumCurrency) {
        const d = amount - exp.amount;
        direction = d > 0 ? "increase" : d < 0 ? "decrease" : "same";
        versusExpiring = d === 0 ? "Same as the expiring premium" : `${d > 0 ? "+" : "−"}${money(Math.abs(d), exp.currency)} against the expiring ${money(exp.amount, exp.currency)}${exp.amount > 0 ? ` (${d > 0 ? "+" : "−"}${Math.abs((d / exp.amount) * 100).toFixed(1)}%)` : ""}`;
      } else if (amount != null && !exp) versusExpiring = "The expiring premium is not recorded, so no change can be shown.";
      else if (amount != null) versusExpiring = "In a different currency from the expiring premium — not compared.";

      const until = r?.validUntil ?? null;
      const daysLeft = until ? Math.ceil((new Date(`${until}T23:59:59Z`).getTime() - now.getTime()) / DAY) : null;
      const validity = !until
        ? { until: null, note: "No validity date is recorded for this answer — confirm it with the insurer before relying on it.", tone: "gold" as const }
        : daysLeft! < 0
          ? { until, note: `Expired on ${fmt(until)}: it would have to be requoted.`, tone: "red" as const }
          : current && until < current.periodEnd.slice(0, 10)
            ? { until, note: `Valid until ${fmt(until)} — before the current cover ends on ${fmt(current.periodEnd)}, so the client must decide by then.`, tone: "gold" as const }
            : { until, note: `Valid until ${fmt(until)} (${daysLeft} day${daysLeft === 1 ? "" : "s"}).`, tone: "green" as const };

      const labels = [...new Set([...baseline.map((t) => t.label), ...(r?.terms ?? []).map((t) => t.label)])];
      const termDifferences = expiringInsurer && expiringInsurer.id !== i.id
        ? labels
            .map((label) => {
              const a = baseline.find((t) => t.label === label);
              const b = r?.terms.find((t) => t.label === label);
              return { label, current: a ? valueOf(a) : null, alternative: b ? valueOf(b) : null, unclear: Boolean(a?.unclear || b?.unclear) };
            })
            .filter((d) => d.current !== d.alternative || d.unclear)
            .slice(0, 8)
        : [];
      const insurerChange = Boolean(expiringInsurer ? expiringInsurer.id !== i.id : current && i.insurerName !== current.insurerName);
      const nextSteps = unavailableReason
        ? []
        : [
            "Record the client's instruction to proceed with this answer, with its evidence (an email, a signed form).",
            `Approve the placement request to ${i.insurerName}, then send it and record how.`,
            `${i.insurerName} confirms cover in writing — only then is the renewal covered.`,
            insurerChange ? `${current?.insurerName ?? "The current insurer"}'s policy is not renewed; tell them, and check nothing is left unpaid.` : "The policy document is issued, checked against what was agreed and applied.",
          ];
      return {
        id: i.id, insurer: i.insurerName.slice(0, 200), available: !unavailableReason, unavailableReason,
        premium: amount != null ? money(amount, r!.premiumCurrency!) : null, versusExpiring: versusExpiring?.slice(0, 120) ?? null, direction,
        insurerChange, validity, termDifferences, nextSteps,
      };
    });

  return {
    choices: live.slice(0, 8).map((i) => ({ id: i.id, insurer: i.insurerName.slice(0, 200), exploring: exploring.includes(i.id), answered: Boolean(i.response) })),
    alternatives,
    notice: EXPLORE_NOTICE,
  };
}
