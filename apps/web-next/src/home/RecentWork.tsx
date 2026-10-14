import type { ExperienceSummary } from "@asap/schema";
import { navigate } from "../app/router.js";

const KIND: Record<ExperienceSummary["kind"], string> = { create_client: "New client", explore_policies: "Policies", renew_policy: "Renewal", clarify: "Question", unsupported: "Request" };
const PROGRESS: Record<ExperienceSummary["progress"], [string, "green" | "gold" | "red" | "grey"]> = {
  started: ["Started", "grey"],
  working: ["In progress", "green"],
  waiting_input: ["Waiting for you", "gold"],
  complete: ["Done", "grey"],
  blocked: ["Blocked", "red"],
};

/** Resumable work: the person's own experiences in this brokerage, newest first. */
export function RecentWork({ recent }: { recent: ExperienceSummary[] | "loading" | "error" }) {
  return (
    <section className="x-card" aria-labelledby="h-recent">
      <div className="x-card-head">
        <h2 id="h-recent" className="x-card-title">
          Continue where you left off
        </h2>
      </div>
      {recent === "loading" ? (
        <div className="x-skeleton" style={{ width: "60%" }} aria-busy="true" />
      ) : recent === "error" ? (
        <p className="x-muted">Your recent work could not be read right now.</p>
      ) : recent.length === 0 ? (
        <p className="x-muted">Work you start here will wait for you.</p>
      ) : (
        <ul className="x-list" style={{ gap: 2 }}>
          {recent.slice(0, 8).map((r) => (
            <li key={r.id}>
              <button type="button" className="x-work-row" onClick={() => navigate(`/x/${r.id}`)}>
                <span className={`x-dot ${PROGRESS[r.progress][1]}`} aria-hidden />
                <span className="x-list-body">
                  <span className="x-list-title">{r.title}</span>
                  <span className="x-help" style={{ display: "block" }}>
                    {KIND[r.kind]} · {PROGRESS[r.progress][0]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
