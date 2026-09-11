import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SearchResult } from "@asap/schema";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";

/**
 * Search across the brokerage's own records (D-064).
 *
 * Clients, policies and work — answered by a lookup on the server, under the caller's session, so
 * a role that cannot see a client does not find it here either. Every result opens a real context:
 * there are no result pages that go nowhere, which is the failure that makes search feel like a lie.
 */
const KIND_WORD: Record<SearchResult["kind"], string> = {
  client: "Clients",
  policy: "Policies",
  work: "Work",
};

export function Search() {
  const { q = "" } = useSearch({ strict: false }) as { q?: string };
  const navigate = useNavigate();
  const me = useMe();

  // Typing is not a query per keystroke: the URL stays authoritative, the request waits for a pause.
  const [debounced, setDebounced] = useState(q.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const search = useQuery({
    queryKey: ["search", me.data?.active_organization?.id, debounced],
    queryFn: () => api.search(debounced),
    enabled: Boolean(me.data?.active_organization?.id) && debounced.length > 0,
    retry: false,
  });

  const results = search.data?.results ?? [];
  const grouped = (Object.keys(KIND_WORD) as SearchResult["kind"][])
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
          placeholder="A client, a policy number, a piece of work…"
          className="min-h-[44px] rounded-control border border-line-strong bg-paper px-3 text-sm text-ink"
        />
        {debounced.length > 0 && search.data && (
          <p className="text-xs text-ink-muted">
            {results.length} {results.length === 1 ? "result" : "results"} for “{search.data.query}”
          </p>
        )}
      </header>

      {/* Every state is designed (§36): nothing typed, searching, failed, nothing found. */}
      {debounced.length === 0 && (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Type a client name, a policy number, or a word from a piece of work. ASAP looks only at
          the records your role can see.
        </p>
      )}
      {search.isFetching && debounced.length > 0 && (
        <p className="text-sm text-ink-muted" role="status">
          Searching your records…
        </p>
      )}
      {search.isError && (
        <p
          role="alert"
          className="rounded-card border border-line-soft bg-paper p-4 text-sm text-accent-red"
        >
          We could not search. {describeApiError(search.error)}
        </p>
      )}
      {(search.data?.degraded ?? []).map((d) => (
        <p key={d.what} className="text-xs text-ink-muted">
          <strong>{d.what}:</strong> {d.because} Everything else was searched.
        </p>
      ))}
      {search.data && results.length === 0 && !search.isFetching && (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Nothing matches “{search.data.query}”. Try a client name, a policy number, or a word from
          a piece of work.
        </p>
      )}

      {grouped.length > 0 && (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <section key={g.kind} aria-label={KIND_WORD[g.kind]} className="flex flex-col gap-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {KIND_WORD[g.kind]}
              </h2>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
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
    </div>
  );
}
