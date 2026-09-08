import { Link } from "@tanstack/react-router";
import { NAV } from "./nav.js";

/** The three destinations, in order. Pure so shell.test.tsx renders it in a memory router. */
export function ShellNav({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  return (
    <nav
      aria-label="Main"
      className={orientation === "vertical" ? "flex flex-col gap-1" : "flex justify-around"}
    >
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          className="flex items-center gap-2 rounded-control px-3 py-2 text-sm text-ink-secondary hover:bg-wash hover:text-ink [&.active]:bg-accent-green-soft [&.active]:font-medium [&.active]:text-accent-green"
          activeProps={{ className: "active" }}
        >
          <span aria-hidden>{n.glyph}</span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
