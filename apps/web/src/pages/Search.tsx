import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { searchSpace } from "../live/search-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Search across the brokerage's own records.
 *
 * Answered by a lookup on the server, under the caller's session, so a role that cannot see a
 * client does not find it here either. Eight kinds, every one a real table; the four things a
 * person may reasonably look for and cannot find yet are named on the Space rather than left to
 * look like an empty result.
 *
 * Rendered through the one Space renderer — no page frame, no `Page`, no `ScreenTitle`. The only
 * thing here that is not a block is the query field itself, which belongs to the address bar: the
 * URL stays authoritative so a search can be linked, reloaded and reopened in its own tab.
 */
export function Search() {
  const { q = "" } = useSearch({ strict: false }) as { q?: string };
  const navigate = useNavigate();
  const me = useMe();
  const tabs = useWorkspaceTabs("/search");

  // Typing is not a query per keystroke: the URL stays authoritative, the request waits for a pause.
  const [debounced] = useDebounced(q.trim(), 200);

  const search = useQuery({
    queryKey: ["search", me.data?.active_organization?.id, debounced],
    queryFn: () => api.search(debounced),
    enabled: Boolean(me.data?.active_organization?.id) && debounced.length > 0,
    retry: false,
  });

  /* Search is a Space, so it is a tab — one tab, whatever the query, because it is one board. */
  useEffect(() => {
    tabs.open({
      spaceType: "route",
      recordType: "search",
      recordId: "search",
      kind: "SEARCH",
      title: "Search",
      path: "/search",
    });
    /* Once: the query lives in the URL and does not make a second tab. */
  }, []);

  const space = searchSpace(debounced, search.data, {
    typing: debounced !== q.trim(),
    loading: search.isFetching,
    error: search.isError ? describeApiError(search.error) : null,
  });

  return (
    <>
      {/*
       * The field is part of the Space's head rather than a block: a block cannot hold the focus
       * ring, the label and the address all at once, and a search box that does not own the URL is
       * a search you cannot send to anybody.
       */}
      <div className="sp-search-box">
        <label htmlFor="search-q" className="sp-label">
          SEARCH EVERYTHING
        </label>
        <input
          id="search-q"
          className="sp-input"
          value={q}
          autoFocus
          onChange={(e) => void navigate({ to: "/search", search: { q: e.target.value } })}
          placeholder="A client, a policy number, a claim reference, a word from an email…"
        />
      </div>
      <SpaceFrameView
        space={space}
        onAct={(action) => {
          if (action.verb === "open" && action.to) void navigate({ to: action.to.path });
        }}
      />
    </>
  );
}

/**
 * A value that follows another after a pause.
 *
 * The request waits for a typist rather than firing per keystroke, while the URL — which is what
 * makes a search linkable — updates immediately.
 */
function useDebounced(value: string, ms: number): [string, (v: string) => void] {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return [held, setHeld];
}
