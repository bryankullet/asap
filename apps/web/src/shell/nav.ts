/**
 * The permanent shell (UI Build Spec v1 Part 1, docs/ui-contract.md): three destinations, then
 * Ask, then the Activity chip. Order is asserted by shell.test.tsx. Insurance modules are never
 * navigation (Architecture v3.1 §45 rule 16).
 *
 * Position 1 is **Discover** since D-060, which renamed Today. Still three destinations: the
 * count is what Screen Map v3 fixes, and the label is what the architecture's §42 already used.
 * `Jobs` stays in NEVER_NAV below — the richer run experience lives in the Activity chip, on a
 * record's run history and in Work, never as a fourth destination.
 */
export const NAV = [
  { to: "/discover", label: "Discover", glyph: "✦" },
  { to: "/work", label: "Work", glyph: "▣" },
  { to: "/automations", label: "Automations", glyph: "⟳" },
] as const;

export type NavTo = (typeof NAV)[number]["to"];

/** Words that must never be a destination. Tested. */
export const NEVER_NAV = ["Clients", "Policies", "Renewals", "Claims", "Money", "Spaces", "Jobs"];
