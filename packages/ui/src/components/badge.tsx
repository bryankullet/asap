import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

export type BadgeTone = "neutral" | "active" | "waiting" | "review";

const TONES: Record<BadgeTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-line-soft text-ink-done", dot: "bg-dot-neutral" },
  active: { pill: "bg-accent-green-soft text-accent-green-ink", dot: "bg-accent-green" },
  waiting: { pill: "bg-accent-gold-soft text-accent-gold-ink", dot: "bg-accent-gold" },
  review: { pill: "bg-accent-red-soft text-accent-red-ink", dot: "bg-accent-red" },
};

/**
 * The status pill — the prototype's `.status`, including its leading dot, which carries the same
 * meaning as the fill: green = running or active, gold = waiting, red = needs review, grey = done.
 * The dot is decorative; the word beside it is what a person reads, so it is hidden from
 * assistive technology.
 */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-sm font-semibold",
        TONES[tone].pill,
        className,
      )}
      {...props}
    >
      <span aria-hidden className={cn("h-[7px] w-[7px] shrink-0 rounded-full", TONES[tone].dot)} />
      {children}
    </span>
  );
}
