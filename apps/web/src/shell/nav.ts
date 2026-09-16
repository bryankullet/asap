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
 * Work's filters. The `id` is the API's `?view=` value and does not change; the label is what a
 * person reads.
 *
 * Two words are banned from this product's vocabulary and a test enforces both: **"Needs you"**,
 * retired in D-064, and a bare **"Waiting"** — retired in D-074, because waiting is only
 * meaningful when it names who is being waited on. A card says *With APA since 15 Sep*; the filter
 * that collects those cards says With someone else.
 */
export const WORK_FILTERS = [
  { id: "active", label: "In progress" },
  { id: "waiting", label: "With someone else" },
  { id: "review", label: "For review" },
  { id: "completed", label: "Done" },
  { id: "pinned", label: "Pinned" },
  { id: "recent", label: "Recent" },
] as const;
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
