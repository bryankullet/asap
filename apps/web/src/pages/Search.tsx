import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { SearchResult } from "@asap/schema";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { Page } from "../shell/Page.js";

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
    <Page title="Search" meta="Clients, policies and work — everything your role can see">
      <div className="search-box">
        <label htmlFor="search-q" className="sr-only">
          Search everything
        </label>
        <input
          id="search-q"
          value={q}
          autoFocus
          onChange={(e) => void navigate({ to: "/search", search: { q: e.target.value } })}
          placeholder="A client, a policy number, a piece of work…"
        />
        {debounced.length > 0 && search.data && (
          <p className="search-count">
            {results.length} {results.length === 1 ? "result" : "results"} for “{search.data.query}”
          </p>
        )}
      </div>

      {/* Every state is designed (§36): nothing typed, searching, failed, nothing found. */}
      {debounced.length === 0 && (
        <article className="space-card" style={{ padding: 20 }}>
          <strong>Start typing.</strong>
          <p style={{ fontSize: 12, color: "#707a72", margin: "6px 0 0" }}>
            A client name, a policy number, or a word from a piece of work. ASAP looks only at the
            records your role can see.
          </p>
        </article>
      )}
      {search.isFetching && debounced.length > 0 && (
        <p className="quiet-line" role="status">
          Searching your records…
        </p>
      )}
      {search.isError && (
        <div className="warning" role="alert">
          <strong>We could not search:</strong> {describeApiError(search.error)}
        </div>
      )}
      {(search.data?.degraded ?? []).map((d) => (
        <div className="warning" key={d.what}>
          <strong>{d.what}:</strong> {d.because} Everything else was searched.
        </div>
      ))}
      {search.data && results.length === 0 && !search.isFetching && (
        <article className="space-card" style={{ padding: 20 }}>
          <strong>Nothing matches “{search.data.query}”.</strong>
          <p style={{ fontSize: 12, color: "#707a72", margin: "6px 0 0" }}>
            Try a client name, a policy number, or a word from a piece of work.
          </p>
        </article>
      )}

      {grouped.length > 0 && (
        <>
          {grouped.map((g) => (
            <section key={g.kind} aria-label={KIND_WORD[g.kind]}>
              <div className="section-label">{KIND_WORD[g.kind]}</div>
              <ul className="evidence-list">
                {g.items.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <Link to={r.to}>{r.title}</Link>
                    <small>{r.subtitle}</small>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </Page>
  );
}
