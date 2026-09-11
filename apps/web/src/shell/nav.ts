/**
 * The permanent shell, per the approved interactive demo (D-064).
 *
 * The demo is now controlling for the visible product experience, which changed three things that
 * earlier decisions had fixed:
 *
 *  - **Five destinations, not three.** D-058 and D-060 capped the shell at three. The approved
 *    demo's sidebar is Discover · Ask ASAP · Work · Jobs · Automations, and the count was never
 *    the point — §45 rule 16 forbids *insurance modules* as navigation (Clients, Policies,
 *    Renewals, Claims, Money), and none of these five is one.
 *  - **Ask ASAP is a destination as well as a composer.** It stays permanently reachable from
 *    every surface; it is now also openable in full, which is how the demo presents it.
 *  - **Jobs is a destination.** D-060 put it in NEVER_NAV. The demo shows Jobs as its own
 *    surface, and it earns one: Jobs is what *ASAP* is processing, which is a different question
 *    from what a *person* owns in Work. Keeping the two separate is the point of showing both.
 *
 * What has not changed, and must not: no insurance module is ever a destination.
 */
export const NAV = [
  { to: "/discover", label: "Discover", glyph: "✦" },
  { to: "/ask", label: "Ask ASAP", glyph: "⌁" },
  { to: "/work", label: "Work", glyph: "▱" },
  { to: "/jobs", label: "Jobs", glyph: "◴" },
  { to: "/automations", label: "Automations", glyph: "⌘" },
] as const;

export type NavTo = (typeof NAV)[number]["to"];

/**
 * Words that must never be a destination. Tested.
 *
 * `Jobs` and `Pinned` left this list in D-064: Jobs is an approved destination, and Pinned is an
 * approved Work *filter* (still not a destination of its own — it is not in NAV). What remains is
 * exactly §45 rule 16's insurance-module tree, plus `Spaces`, which is called Work on screen.
 */
export const NEVER_NAV = ["Clients", "Policies", "Renewals", "Claims", "Money", "Spaces"];

/**
 * Work's filters, in the approved order. "Needs you" is gone from the product's vocabulary
 * entirely (D-064) — a filter test asserts it appears nowhere visible.
 */
export const WORK_FILTERS = [
  { id: "active", label: "Active" },
  { id: "waiting", label: "Waiting" },
  { id: "review", label: "For review" },
  { id: "completed", label: "Completed" },
  { id: "pinned", label: "Pinned" },
  { id: "recent", label: "Recent" },
] as const;
export type WorkFilterId = (typeof WORK_FILTERS)[number]["id"];

/** What ASAP is processing. Deliberately a different vocabulary from Work's. */
export const JOB_FILTERS = [
  { id: "running", label: "Running" },
  { id: "waiting", label: "Waiting" },
  { id: "needs_human", label: "Needs a person" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
] as const;
export type JobFilterId = (typeof JOB_FILTERS)[number]["id"];
