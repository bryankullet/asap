import type { ReactNode } from "react";
import { useDemo } from "./state.js";

/**
 * The line between demonstration and the real thing (D-064).
 *
 * Wherever fictional data or a simulated action appears, this says so. It is not decoration: the
 * approved demo shows email being "sent", claims being prepared and money being reconciled, and a
 * viewer must never be left thinking a real message went out or a real balance was read.
 *
 * Renders nothing outside demo mode, so production surfaces carry no demo language at all.
 */
export function DemoBoundary({ children }: { children: ReactNode }) {
  const { isDemo } = useDemo();
  if (!isDemo) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-card border border-line-soft bg-wash px-2.5 py-1.5 text-xs text-ink-muted">
      <span aria-hidden>●</span>
      <span>{children}</span>
    </p>
  );
}
