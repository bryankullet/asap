import type { AttentionResponse } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { Count, SectionTitle } from "@asap/ui";
import { WorkCard } from "../components/WorkCard.js";
import { EmptyState } from "../components/states.js";

/**
 * Today, rendered from `GET /attention`.
 *
 * A pure view: the ranking, the cap, the reason on each card and the decision that a third-party
 * check is due were all computed here before, in the browser, against the browser's clock. They
 * are the server's now (D-058; Architecture §27, §42). This file renders the answer and nothing
 * else — a run that could not finish is still shown through its work item, never only in Activity.
 */
export function TodayView({ data }: { data: AttentionResponse }) {
  const needsYou = data.items.filter((i) => i.section === "needs_you");
  const checksDue = data.items.filter((i) => i.section === "checks_due");
  const orgName = data.organization.name;

  if (needsYou.length === 0 && checksDue.length === 0 && data.orphanRuns.length === 0) {
    return (
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
    );
  }

  const needsYouSection = data.sections.find((s) => s.key === "needs_you");
  const checksDueSection = data.sections.find((s) => s.key === "checks_due");

  return (
    <div className="flex flex-col gap-8">
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
          <WorkCard
            key={row.item.id}
            item={row.item}
            showWhy
            reason={row.reason}
            footer={
              row.runFailure ? (
                <p className="text-sm text-accent-red">
                  ASAP could not finish: {row.runFailure.nextStep ?? "check this item"}.
                </p>
              ) : undefined
            }
          />
        ))}
        {/* A capped section says so rather than quietly showing part of the answer. */}
        {needsYouSection && needsYouSection.visible > needsYouSection.returned && (
          <p className="text-sm text-ink-muted">
            Showing {needsYouSection.returned} of {needsYouSection.visible}.{" "}
            <Link
              to="/work"
              search={{ view: "needs" }}
              className="font-bold text-accent-green underline underline-offset-2"
            >
              See all in Work
            </Link>
          </p>
        )}
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
            <WorkCard key={row.item.id} item={row.item} showWhy reason={row.reason} />
          ))}
          {checksDueSection && checksDueSection.visible > checksDueSection.returned && (
            <p className="text-sm text-ink-muted">
              Showing {checksDueSection.returned} of {checksDueSection.visible}.{" "}
              <Link
                to="/work"
                search={{ view: "with" }}
                className="font-bold text-accent-green underline underline-offset-2"
              >
                See all in Work
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
