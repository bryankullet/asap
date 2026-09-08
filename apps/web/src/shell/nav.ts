/**
 * The permanent shell (UI Build Spec v1 Part 1, docs/ui-contract.md): three destinations, then
 * Ask, then the Activity chip. Order is asserted by shell.test.tsx. Insurance modules are never
 * navigation (Architecture v3.1 §45 rule 16).
 */
export const NAV = [
  { to: "/today", label: "Today", glyph: "☀" },
  { to: "/work", label: "Work", glyph: "▣" },
  { to: "/automations", label: "Automations", glyph: "⟳" },
] as const;

export type NavTo = (typeof NAV)[number]["to"];

/** Words that must never be a destination. Tested. */
export const NEVER_NAV = ["Clients", "Policies", "Renewals", "Claims", "Money", "Spaces", "Jobs"];
