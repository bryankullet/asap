import { DEMO_NOTICE, demoClient, scenarioById, type DemoWork } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { EvidenceConditionChip } from "../components/EvidenceCondition.js";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * Discover — what matters now (D-064).
 *
 * The approved demo answers one question and answers it compactly: a short ranked list of
 * meaningful issues across the brokerage, each with its client, its reason, its evidence
 * condition and a direct way in. Not a dashboard, and not a heavy stack of cards — a broker
 * should be able to read the whole thing without scrolling past the third item.
 *
 * Ranking is not a model's opinion. The order comes from the same deterministic signals the
 * backend uses, and each row shows why it is where it is.
 */

/** The approved priority order, most consequential first. Deterministic, and visible as a reason. */
const PRIORITY: { workId: string; why: string; condition: string; noticed?: string }[] = [
  {
    workId: "w-acme-kdn",
    why: "Cover was requested, not confirmed. Driving an unconfirmed vehicle is the live risk.",
    condition: "conflicting",
    noticed: "The certificate register has no entry for this vehicle either.",
  },
  {
    workId: "w-bluewave-renewal",
    why: "The renewal is 34 days out and the terms received cannot be compared.",
    condition: "missing",
    noticed: "Two pages of the quote would not extract — nothing was recorded from them.",
  },
  {
    workId: "w-mara-balance",
    why: "Premium is 62 days overdue and two receipts do not match any invoice.",
    condition: "conflicting",
  },
  {
    workId: "w-greencare-claim",
    why: "The settlement was offered and accepted. Money has not arrived.",
    condition: "waiting",
    noticed: "Acceptance is not payment — the claim stays open until the money is recorded.",
  },
  {
    workId: "w-jane-claim",
    why: "No movement for five days and no assessor allocated.",
    condition: "stale",
  },
];

export function DiscoverDemo() {
  const demo = useDemo();
  const rows = PRIORITY.map((p) => ({
    ...p,
    work: demo.work.find((w) => w.id === p.workId),
  })).filter((r): r is typeof r & { work: DemoWork } => Boolean(r.work));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">What matters now?</h1>
        <p className="text-sm text-ink-secondary">
          The few things across the brokerage worth your attention, most consequential first. Each
          one says why it is here.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Nothing needs attention. That is a real answer, not an empty screen.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-line-soft rounded-card border border-line-strong bg-paper">
          {rows.map((r, i) => (
            <li key={r.workId}>
              <PriorityRow rank={i + 1} row={r} />
            </li>
          ))}
        </ol>
      )}

      <section aria-label="Quick actions" className="flex flex-wrap gap-2">
        <Link
          to="/ask"
          search={{ scenario: "brokerage-priorities" }}
          className="rounded-control border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
        >
          Ask what to do first
        </Link>
        <Link
          to="/work"
          search={{ view: "active" }}
          className="rounded-control border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
        >
          Open all work
        </Link>
        <Link
          to="/jobs"
          search={{ filter: "running" }}
          className="rounded-control border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
        >
          See what ASAP is doing
        </Link>
      </section>

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
    </div>
  );
}

function PriorityRow({
  rank,
  row,
}: {
  rank: number;
  row: { work: DemoWork; why: string; condition: string; noticed?: string };
}) {
  const client = demoClient(row.work.clientId);
  const scenario = scenarioById(row.work.scenarioId);
  const verb =
    row.work.state === "review" ? "Review" : row.work.state === "waiting" ? "Open" : "Continue";

  return (
    <article className="flex flex-wrap items-start gap-3 px-4 py-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-wash text-xs font-medium text-ink-muted"
      >
        {rank}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/work/$workId"
            params={{ workId: row.work.id }}
            className="font-medium text-ink hover:underline"
          >
            {row.work.title}
          </Link>
          <EvidenceConditionChip condition={row.condition as never} />
        </div>
        <p className="text-xs text-ink-muted">
          {client?.shortName}
          {scenario ? ` · ${scenario.panel.title}` : ""}
        </p>
        {/* Why this is here, in words. A rank with no reason is not a reason. */}
        <p className="text-sm text-ink-secondary">{row.why}</p>
        {row.noticed && (
          <p className="text-sm text-accent-gold-ink">
            <span className="font-medium">ASAP noticed:</span> {row.noticed}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          to="/work/$workId"
          params={{ workId: row.work.id }}
          className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
        >
          {verb}
        </Link>
        {scenario && (
          <Link
            to="/ask"
            search={{ scenario: scenario.id }}
            className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink-secondary hover:border-ink-muted"
          >
            Ask
          </Link>
        )}
      </div>
    </article>
  );
}
