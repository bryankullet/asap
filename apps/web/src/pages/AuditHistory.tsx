import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ErrorState, LoadingList } from "../components/states.js";

/**
 * Audit history (D-064).
 *
 * §45 rule 15: AI actions, automation runs and job failures are never hidden from the history.
 * This is the brokerage-wide view of that — every row from `audit_log`, written server-side under
 * the caller's own session, carrying who, what, which record, and what changed.
 *
 * A denial is history too, and it is shown as one. So is a failure. The point of this screen is
 * that nothing quietly disappears from it.
 */
export function AuditHistory() {
  const me = useMe();
  const history = useQuery({
    queryKey: ["audit", me.data?.active_organization?.id],
    queryFn: () => api.audit(),
    enabled: Boolean(me.data?.active_organization?.id),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Audit history</h1>
        <p className="text-sm text-ink-secondary">
          Everything that happened, in order — including what ASAP only prepared, and what a person
          decided.
        </p>
      </header>

      {history.isPending && <LoadingList rows={4} label="Reading the audit history" />}
      {history.isError && (
        <ErrorState
          what={`We could not read the audit history. ${describeApiError(history.error)}`}
          retry={() => void history.refetch()}
        />
      )}
      {history.data && history.data.entries.length === 0 && (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Nothing has been recorded yet. Approve something, record a send or switch an automation
          on, and it appears here with who did it and what changed.
        </p>
      )}
      {history.data && history.data.entries.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {history.data.entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline gap-3 rounded-card border border-line-soft bg-paper px-3 py-2 text-sm"
            >
              <time
                className="shrink-0 text-xs tabular-nums text-ink-muted"
                dateTime={e.occurredAt}
              >
                {new Date(e.occurredAt).toLocaleString()}
              </time>
              <span className="text-ink">{e.action}</span>
              <span className="text-ink-secondary">
                {e.actorName ?? ACTOR_WORD[e.actorType]} · {e.objectType}
              </span>
              {e.changed.length > 0 && (
                <span className="text-xs text-ink-muted">{e.changed.join(", ")}</span>
              )}
              {e.result !== "success" && (
                <span className="rounded-pill bg-accent-red-soft px-2 py-0.5 text-xs text-accent-red-ink">
                  {e.result === "denied" ? "Denied" : "Failed"}
                  {e.failureReason ? `: ${e.failureReason}` : ""}
                </span>
              )}
              {e.objectId && (
                <Link
                  to="/r/$recordId"
                  params={{ recordId: e.objectId }}
                  search={{}}
                  className="ml-auto text-xs text-ink-secondary hover:underline"
                >
                  Open the record
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
      {history.data && history.data.visible > history.data.returned && (
        <p className="text-xs text-ink-muted">
          Showing the most recent {history.data.returned} of {history.data.visible}.
        </p>
      )}
    </div>
  );
}

/** Who acted, when it was not a person with a name. */
const ACTOR_WORD: Readonly<Record<string, string>> = {
  user: "A person",
  ai: "ASAP",
  automation: "An automation",
  system: "The platform",
};
