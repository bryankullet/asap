/**
 * The permanent shell (D-074, superseding D-064).
 *
 * Three destinations, and the reasoning is the reasoning D-058 and D-060 had before the
 * interactive demo briefly widened it to five:
 *
 *  - **Ask ASAP is not a destination.** It is persistent — docked on every surface, in reach
 *    wherever a person is — and a destination as well would make it two things competing for the
 *    same attention. It still has a URL (`/ask`) so a conversation can be linked and reopened;
 *    it is simply not in the sidebar.
 *  - **Jobs is not a destination.** What ASAP is processing reaches a person through the Activity
 *    chip beside Ask, and a run opens in full from there, from its own Work item, from an import
 *    or from automation history. A run must never be the only place something important lives:
 *    anything needing a person is in Work first, so Activity can be ignored without cost.
 *  - **Today, not Discover.** D-060 renamed it; the rebuilt product calls it Today, and `/discover`
 *    redirects so older links, bookmarks and `?next=` values keep working.
 *
 * What has not changed, and must not: no insurance module is ever a destination (§45 rule 16).
 */
export const NAV = [
  { to: "/today", label: "Today", glyph: "✦" },
  { to: "/work", label: "Work", glyph: "▱" },
  { to: "/automations", label: "Automations", glyph: "⌘" },
] as const;

export type NavTo = (typeof NAV)[number]["to"];

/**
 * Words that must never be a destination. Tested.
 *
 * `Jobs` and `Ask ASAP` are back on this list under D-074 — not because either is unimportant, but
 * because neither is somewhere a person goes: runs arrive through Activity, and Ask is always
 * already there. What remains beyond them is §45 rule 16's insurance-module tree, plus `Spaces`,
 * which is called Work on screen.
 */
export const NEVER_NAV = [
  "Jobs",
  "Ask ASAP",
  "Clients",
  "Policies",
  "Renewals",
  "Claims",
  "Money",
  "Spaces",
];

/**
 * Work's main views (D-075). The `id` is the API's own `?view=` value; the label is what a person
 * reads, and comes from `WORK_VIEW_LABELS` so the sidebar, the board and the API cannot disagree.
 *
 * Four of these are the task-status layer: work nobody has picked up, work held by an outside
 * party, work in progress, work done. **Your work is the default** — it is the question a person
 * opens Work to answer.
 *
 * Not here, on purpose:
 *
 *  - **Pinned** is a personal marker, not a workflow state. It has its own control and its own
 *    endpoint (`PINNED_VIEW` below), because a way of finding work is not a state work is in.
 *  - **For review** is contextual. It collects what ASAP prepared and nobody has acted on, and it
 *    appears where that is the question — never as the name for all human work.
 *
 * Two words are banned outright and a test enforces both: **"Needs you"** (D-064) and a bare
 * **"Waiting"** (D-074). Waiting only means something once it names the party, which is why a card
 * reads *With CIC since 12 Aug*, *With client since 14 Aug*, *With assessor since 16 Aug*.
 */
export const WORK_FILTERS = [
  { id: "needs", label: "Your work" },
  { id: "with", label: "With others" },
  { id: "progress", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "recent", label: "Recent" },
] as const;

/** The default view: what Work opens on. */
export const DEFAULT_WORK_FILTER = "needs" as const;

/** A personal marker, beside the views rather than among them. */
export const PINNED_VIEW = { id: "pinned", label: "Pinned" } as const;

/** Contextual, never a main view: what ASAP prepared and nobody has acted on yet. */
export const REVIEW_VIEW = { id: "review", label: "For review" } as const;

/**
 * Older links keep working. `?view=active` was "Active" and meant the task-status the product now
 * calls Your work; `completed` was Done; `waiting` was With others.
 */
export const LEGACY_WORK_FILTERS: Readonly<Record<string, string>> = {
  active: "needs",
  waiting: "with",
  completed: "done",
};

export type WorkFilterId = (typeof WORK_FILTERS)[number]["id"];

/**
 * The Jobs board's filters. Jobs is no longer a destination (D-074) but the board is still reached
 * from Activity, and its vocabulary stays deliberately different from Work's: this is what ASAP is
 * processing, not what a person owns.
 */
export const JOB_FILTERS = [
  { id: "all", label: "All" },
  { id: "running", label: "Working" },
  { id: "waiting", label: "Waiting on someone else" },
  { id: "work", label: "Stopped for a person" },
  { id: "completed", label: "Finished" },
] as const;
export type JobFilterId = (typeof JOB_FILTERS)[number]["id"];
