import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

export type BadgeTone = "neutral" | "active" | "waiting" | "review";

/** Status pill. green = running/active, gold = waiting, red = needs review, grey = done/neutral. */
export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-line-soft text-ink-secondary",
    active: "bg-accent-green-soft text-accent-green",
    waiting: "bg-accent-gold-soft text-ink",
    review: "bg-accent-red-soft text-accent-red",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
