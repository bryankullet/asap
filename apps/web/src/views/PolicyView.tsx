import { versionOn, type PolicyResponse } from "@asap/schema";
import { Card, CardTitle } from "@asap/ui";

/** A policy titled as itself: every version kept, the current one by date, rejected items visible. */
export function PolicyView({ data, today }: { data: PolicyResponse; today: string }) {
  const current = versionOn(data.versions, today);
  const fmt = (minor: number | null) =>
    minor === null ? "sum not stated" : `KES ${(minor / 100).toLocaleString("en-KE")}`;
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-ink">
          {data.clientName} — {data.policy.class_of_business} with {data.insurerName}
        </h1>
        <p className="text-sm leading-relaxed text-ink-muted">
          {data.policy.policy_number ?? "No policy number"} ·{" "}
          {data.periods.map((p) => `${p.period_start} to ${p.period_end}`).join("; ")}
        </p>
      </header>
      {[...data.versions].reverse().map((v) => (
        <Card
          key={v.id}
          variant={current?.id === v.id ? "attention" : "default"}
          className="flex flex-col gap-2"
        >
          <CardTitle>
            Version {v.version} · from {v.effective_from}
            {v.effective_to ? ` to ${v.effective_to}` : ""}
            {current?.id === v.id ? " · current" : ""}
            {v.source === "endorsement" ? " · from an endorsement" : ""}
          </CardTitle>
          <ul className="flex flex-col">
            {v.items.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line-soft py-2.5 text-sm last:border-b-0"
              >
                <span
                  className={i.covered ? "font-semibold text-ink" : "text-ink-muted line-through"}
                >
                  {i.label}
                </span>
                <span className="text-ink-muted">{fmt(i.sumInsuredMinor)}</span>
                {!i.covered && (
                  <span className="rounded-pill bg-accent-red-soft px-2.5 py-1 text-xs font-semibold text-accent-red-ink">
                    {i.status === "rejected_by_insurer"
                      ? "Not covered — rejected by the insurer"
                      : i.status === "removed"
                        ? "Not covered — removed"
                        : "Not covered"}
                  </span>
                )}
                {i.note && <span className="text-ink-secondary">· {i.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </article>
  );
}
