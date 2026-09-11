import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, CardTitle, Input } from "@asap/ui";
import { EmptyState, ErrorState } from "../components/states.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";

/**
 * H04 Search. It was a sidebar link to `/work?view=recent`, which is not search — it is a
 * different list wearing the word.
 *
 * It is now a real surface over `GET /ask`, which is the one search the backend actually has:
 * a case-insensitive match on work-item titles, scoped to the caller's brokerage and read under
 * their own RLS. The page says exactly that, because a search that quietly covers less than a
 * person expects is worse than one that names its own limits.
 *
 * The query lives in the URL, so a search is a link a colleague can be sent.
 */
export function Search() {
  const { q = "" } = useSearch({ strict: false }) as { q?: string };
  const [text, setText] = useState(q);
  const navigate = useNavigate();
  const me = useMe();
  const org = me.data?.active_organization;

  const search = useMutation({ mutationFn: api.ask });

  // Run whatever the URL asks for, so a shared link searches on arrival.
  useEffect(() => {
    setText(q);
    if (q.trim().length > 0) search.mutate(q.trim());
    else search.reset();
    // Keyed on the URL query alone: the mutation is stable for the life of the page, and
    // depending on it would re-run the search every time its own state changed.
  }, [q]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void navigate({ to: "/search", search: text.trim() ? { q: text.trim() } : {} });
  }

  const results = search.data?.results ?? [];

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} role="search" aria-label="Search" className="flex gap-2">
        <Input
          aria-label="Search this brokerage"
          value={text}
          placeholder="A client, a vehicle, a record…"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="green" disabled={search.isPending}>
          Search
        </Button>
      </form>

      {/* Naming the limit is part of the answer. */}
      <p className="text-sm text-ink-muted">
        Search covers the titles of work in {org?.name ?? "this brokerage"}. Documents, email and
        the contents of records are not searched yet — they arrive with extraction and the mailbox
        connection. Everything you can see here, you can see because your role allows it.
      </p>

      {search.isPending && (
        <p role="status" className="text-sm text-ink-muted">
          Searching…
        </p>
      )}
      {search.isError && (
        <ErrorState
          what={`Search could not run. ${describeApiError(search.error)}`}
          retry={() => text.trim() && search.mutate(text.trim())}
        />
      )}
      {search.isSuccess && results.length === 0 && (
        <EmptyState
          scope={`${org?.name ?? "this brokerage"} matching "${q}"`}
          freshness="Nothing matched. Titles only, for now."
          action={
            <Link
              to="/work"
              search={{ view: "recent" }}
              className="text-sm font-bold text-accent-green underline underline-offset-2"
            >
              Browse recent work instead
            </Link>
          }
        />
      )}
      {results.length > 0 && (
        <section aria-label="Results" className="flex flex-col gap-2">
          <p className="text-sm text-ink-secondary">
            {results.length} {results.length === 1 ? "match" : "matches"}
          </p>
          {results.map((r) => (
            <Card key={r.id} clickable className="p-4">
              <CardTitle>
                <Link to="/r/$recordId" params={{ recordId: r.id }} className="hover:underline">
                  {r.title}
                </Link>
              </CardTitle>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
