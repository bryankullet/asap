import type { AttentionItem, AttentionResponse } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Count, SectionTitle } from "@asap/ui";
import { WorkCard } from "../components/WorkCard.js";
import { EmptyState, PartialSuccess } from "../components/states.js";
import { FactList } from "../components/EvidenceCondition.js";

/**
 * Discover — "what matters now?" — rendered from `GET /attention`.
 *
 * A pure view. The ranking, the cap, the reason on each card, the signals behind the rank, the
 * client and period context and the decision that a third-party check is due are all the server's
 * (D-060; Architecture §27, §42). This file renders the answer and adds nothing to it.
 *
 * It is not a dashboard: two sections, a hard cap, and every card leads somewhere — the Work item,
 * the client's file, the policy, or Ask with the item's own words already typed.
 */
export function DiscoverView({ data }: { data: AttentionResponse }) {
  const needsYou = data.items.filter((i) => i.section === "needs_you");
  const checksDue = data.items.filter((i) => i.section === "checks_due");
  const orgName = data.organization.name;

  if (needsYou.length === 0 && checksDue.length === 0 && data.orphanRuns.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PartialSuccess parts={data.degraded} />
        <EmptyState
          scope={`${orgName} today`}
          freshness="Nothing needs you right now. Checked just now."
          action={
            <Link
              to="/work"
              search={{ view: "with" }}
              className="text-sm font-bold text-accent-green underline underline-offset-2"
            >
              See what is with others
            </Link>
          }
        />
      </div>
    );
  }

  const section = (key: "needs_you" | "checks_due") => data.sections.find((s) => s.key === key);

  return (
    <div className="flex flex-col gap-8">
      <PartialSuccess parts={data.degraded} />

      <section aria-labelledby="needs-you" className="flex flex-col gap-3">
        <SectionTitle
          id="needs-you"
          className="mt-0"
          aside={needsYou.length > 0 ? <Count>{needsYou.length}</Count> : undefined}
        >
          Needs you
        </SectionTitle>
        {needsYou.length === 0 && (
          <p className="text-sm text-ink-muted">Nothing needs you right now.</p>
        )}
        {needsYou.map((row) => (
          <DiscoverCard key={row.item.id} row={row} />
        ))}
        <Capped section={section("needs_you")} view="needs" />
        {data.orphanRuns.map((r) => (
          <p
            key={r.id}
            className="rounded-card border border-accent-red/25 bg-accent-red-soft p-4 text-sm text-ink"
          >
            {r.title}: ASAP could not finish. {r.nextStep ?? "Check this run."}{" "}
            <Link to="/r/$recordId" params={{ recordId: r.id }} className="underline">
              Open
            </Link>
          </p>
        ))}
      </section>

      {checksDue.length > 0 && (
        <section aria-labelledby="checks-due" className="flex flex-col gap-3">
          <SectionTitle id="checks-due" className="mt-0" aside={<Count>{checksDue.length}</Count>}>
            Checks due
          </SectionTitle>
          {checksDue.map((row) => (
            <DiscoverCard key={row.item.id} row={row} />
          ))}
          <Capped section={section("checks_due")} view="with" />
        </section>
      )}
    </div>
  );
}

/** A capped section says so rather than quietly showing part of the answer. */
function Capped({
  section,
  view,
}: {
  section: { visible: number; returned: number } | undefined;
  view: "needs" | "with";
}) {
  if (!section || section.visible <= section.returned) return null;
  return (
    <p className="text-sm text-ink-muted">
      Showing {section.returned} of {section.visible}.{" "}
      <Link
        to="/work"
        search={{ view }}
        className="font-bold text-accent-green underline underline-offset-2"
      >
        See all in Work
      </Link>
    </p>
  );
}

/**
 * One attention card. The item's own headline and status come from `WorkCard`, so a Discover card
 * and a Work card are the same card; what Discover adds is the context line, "Why here?" (the
 * engine's reason plus the signals that ranked it) and the routes out.
 */
function DiscoverCard({ row }: { row: AttentionItem }) {
  const [why, setWhy] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const period = row.period;

  return (
    <WorkCard
      item={row.item}
      reason={row.reason}
      nowStep={row.nowStep}
      context={
        row.client || period ? (
          <p className="text-sm text-ink-secondary">
            {row.client && (
              <Link
                to="/files/$clientId"
                params={{ clientId: row.client.id }}
                className="font-semibold text-ink hover:underline"
              >
                {row.client.name}
              </Link>
            )}
            {row.client && period && <span className="text-ink-muted"> · </span>}
            {period && (
              <>
                <Link
                  to="/r/$recordId"
                  params={{ recordId: period.id }}
                  search={{ kind: "policy" as const }}
                  className="hover:underline"
                >
                  {period.classOfBusiness} with {period.insurerName}
                </Link>
                <span className="text-ink-muted">
                  {" "}
                  · {period.periodStart} to {period.periodEnd}
                  {period.daysToEnd !== null &&
                    period.daysToEnd >= 0 &&
                    period.daysToEnd <= 45 &&
                    ` · ends in ${period.daysToEnd} day${period.daysToEnd === 1 ? "" : "s"}`}
                </span>
              </>
            )}
          </p>
        ) : undefined
      }
      footer={
        <div className="flex flex-col gap-2">
          {row.runFailure && (
            <p className="text-sm text-accent-red">
              ASAP could not finish: {row.runFailure.nextStep ?? "check this item"}.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="compact" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
              Why here?
            </Button>
            {row.facts.length > 0 && (
              <Button
                variant="ghost"
                size="compact"
                aria-expanded={evidence}
                onClick={() => setEvidence((v) => !v)}
              >
                <span aria-hidden>▤</span> Evidence ({row.facts.length})
              </Button>
            )}
            <Link
              to="/r/$recordId"
              params={{ recordId: row.item.id }}
              className="rounded-compact px-2.5 py-1.5 text-[0.86rem] font-semibold text-ink hover:bg-wash"
            >
              Open the work
            </Link>
            {/* Ask carries the item's own words, so the dock opens on this context. */}
            <Link
              to="/discover"
              search={{ ask: row.links.ask }}
              className="rounded-compact px-2.5 py-1.5 text-[0.86rem] font-semibold text-ink hover:bg-wash"
            >
              Ask about this
            </Link>
          </div>
          {why && (
            <div className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-wash px-3 py-2.5">
              <p className="text-sm leading-relaxed text-ink">{row.reason}</p>
              <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">
                Why it is ranked here
              </p>
              <ul className="flex flex-col gap-1 text-sm text-ink-secondary">
                {row.signals.map((s) => (
                  <li key={s.id}>{s.because}</li>
                ))}
              </ul>
            </div>
          )}
          {evidence && (
            <div className="rounded-card border border-line-soft bg-wash px-3 py-2.5">
              <FactList facts={row.facts} />
            </div>
          )}
        </div>
      }
    />
  );
}
