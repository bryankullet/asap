import { Link } from "@tanstack/react-router";
import { NAV } from "./nav.js";

/** The three destinations, in order. Pure so shell.test.tsx renders it in a memory router. */
export function ShellNav({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  const vertical = orientation === "vertical";
  return (
    <nav
      aria-label="Main"
      className={vertical ? "flex flex-col gap-1" : "grid h-full grid-cols-3 gap-1"}
    >
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          className={
            vertical
              ? "flex min-h-[48px] items-center gap-3 rounded-[11px] px-3 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-wash hover:text-ink [&.active]:bg-[#eef2f4] [&.active]:text-ink"
              : "flex flex-col items-center justify-center gap-0.5 rounded-[9px] text-xs font-semibold text-ink-muted [&.active]:bg-wash [&.active]:text-ink"
          }
          activeProps={{ className: "active" }}
        >
          <span aria-hidden className={vertical ? "w-5 text-center" : "text-base"}>
            {n.glyph}
          </span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
