import { DEMO_NOTICE, DEMO_SEARCH, type DemoSearchKind } from "@asap/schema";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { DemoBoundary } from "../demo/DemoBoundary.js";

/**
 * Search across everything the demo holds (D-064).
 *
 * Clients, policies, claims, Work, Jobs, documents, email and analysis — not Work titles alone.
 * Every result opens a real context: there are no result pages that go nowhere, which is the
 * failure that makes search feel like a lie.
 */
const KIND_WORD: Record<DemoSearchKind, string> = {
  client: "Client",
  policy: "Policy",
  claim: "Claim",
  work: "Work",
  job: "Job",
  document: "Document",
  email: "Email",
  analysis: "Analysis",
};

export function SearchDemo() {
  const { q = "" } = useSearch({ strict: false }) as { q?: string };
  const navigate = useNavigate();
  const needle = q.trim().toLowerCase();

  const results = needle
    ? DEMO_SEARCH.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          r.subtitle.toLowerCase().includes(needle) ||
          KIND_WORD[r.kind].toLowerCase().includes(needle),
      )
    : DEMO_SEARCH;

  const grouped = (Object.keys(KIND_WORD) as DemoSearchKind[])
    .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold text-ink">Search</h1>
        <label htmlFor="search-q" className="sr-only">
          Search everything
        </label>
        <input
          id="search-q"
          value={q}
          autoFocus
          onChange={(e) => void navigate({ to: "/search", search: { q: e.target.value } })}
          placeholder="A client, a policy, a claim, a document, an email…"
          className="min-h-[44px] rounded-control border border-line-strong bg-paper px-3 text-sm text-ink"
        />
        <p className="text-xs text-ink-muted">
          {results.length} {results.length === 1 ? "result" : "results"}
          {needle ? ` for "${q}"` : " across the brokerage"}
        </p>
      </header>

      {results.length === 0 ? (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Nothing matches "{q}". Try a client name, a policy number, a vehicle, or a word from an
          email.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <section key={g.kind} aria-label={KIND_WORD[g.kind]} className="flex flex-col gap-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {KIND_WORD[g.kind]}
              </h2>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={r.to}
                      className="block rounded-card border border-line-strong bg-paper p-3 hover:border-ink-muted"
                    >
                      <span className="block text-sm font-medium text-ink">{r.title}</span>
                      <span className="block text-xs text-ink-muted">{r.subtitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
    </div>
  );
}
