import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.js";

export type NoticeTone = "info" | "success" | "waiting" | "error";

const TONES: Record<NoticeTone, { box: string; icon: string }> = {
  info: { box: "border-line-strong bg-wash text-ink-secondary", icon: "bg-surface-sunken" },
  success: {
    box: "border-[#c8e7da] bg-accent-green-soft text-accent-green-ink",
    icon: "bg-accent-green-soft text-accent-green",
  },
  waiting: {
    box: "border-accent-gold-line bg-accent-gold-soft text-accent-gold-ink",
    icon: "bg-accent-gold-soft text-accent-gold-ink",
  },
  error: {
    box: "border-accent-red/25 bg-accent-red-soft text-accent-red-ink",
    icon: "bg-accent-red-soft text-accent-red",
  },
};

/**
 * System-state notice (§36), in the prototype's shape: an optional icon tile beside the words.
 * Tone colours are the fixed semantic set: green = active or done, gold = waiting or attention,
 * red = needs review or error, grey = neutral.
 */
export function Notice({
  tone = "info",
  icon,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { tone?: NoticeTone; icon?: ReactNode }) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-control border px-3.5 py-3 text-sm leading-relaxed",
        t.box,
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-compact",
            t.icon,
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
