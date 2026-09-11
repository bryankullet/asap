import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ErrorState, LoadingList } from "../components/states.js";
import { Page } from "../shell/Page.js";

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
    <Page
      title="Audit history"
      meta="Everything that happened, in order — including what ASAP only prepared"
    >

      {history.isPending && <LoadingList rows={4} label="Reading the audit history" />}
      {history.isError && (
        <ErrorState
          what={`We could not read the audit history. ${describeApiError(history.error)}`}
          retry={() => void history.refetch()}
        />
      )}
      {history.data && history.data.entries.length === 0 && (
        <article className="space-card" style={{ padding: 20 }}>
          <strong>Nothing has been recorded yet.</strong>
          <p style={{ fontSize: 12, color: "#707a72", margin: "6px 0 0" }}>
            Approve something, record a send or switch an automation on, and it appears here with
            who did it and what changed.
          </p>
        </article>
      )}
      {history.data && history.data.entries.length > 0 && (
        <ol className="audit-list">
          {history.data.entries.map((e) => (
            <li key={e.id}>
              <time dateTime={e.occurredAt}>{new Date(e.occurredAt).toLocaleString()}</time>
              <div className="audit-what">
                <strong>{e.action}</strong>
                <small>
                  {e.actorName ?? ACTOR_WORD[e.actorType]} · {e.objectType}
                  {e.changed.length > 0 ? ` · ${e.changed.join(", ")}` : ""}
                </small>
              </div>
              {e.result !== "success" && (
                <span className="pill high">
                  {e.result === "denied" ? "Denied" : "Failed"}
                  {e.failureReason ? `: ${e.failureReason}` : ""}
                </span>
              )}
              {e.objectId && (
                <Link
                  to="/r/$recordId"
                  params={{ recordId: e.objectId }}
                  search={{}}
                  className="link"
                >
                  Open
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
      {history.data && history.data.visible > history.data.returned && (
        <p className="quiet-line">
          Showing the most recent {history.data.returned} of {history.data.visible}.
        </p>
      )}
    </Page>
  );
}

/** Who acted, when it was not a person with a name. */
const ACTOR_WORD: Readonly<Record<string, string>> = {
  user: "A person",
  ai: "ASAP",
  automation: "An automation",
  system: "The platform",
};
