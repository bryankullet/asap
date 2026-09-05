import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

export type NoticeTone = "info" | "success" | "waiting" | "error";

/**
 * System-state notice (§36). Tone colours are the fixed semantic set: green = active/success,
 * gold = waiting/attention, red = needs review/error, grey = neutral.
 */
export function Notice({
  tone = "info",
  className,
  ...props
}: ComponentProps<"div"> & { tone?: NoticeTone }) {
  const tones: Record<NoticeTone, string> = {
    info: "bg-wash text-ink-secondary border-line-soft",
    success: "bg-accent-green-soft text-accent-green border-accent-green/20",
    waiting: "bg-accent-gold-soft text-ink border-accent-gold/30",
    error: "bg-accent-red-soft text-accent-red border-accent-red/20",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-control border px-3 py-2 text-sm", tones[tone], className)}
      {...props}
    />
  );
}
