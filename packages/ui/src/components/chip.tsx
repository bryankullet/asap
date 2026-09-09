import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

/**
 * The prototype's `.chip`: a pill-shaped control for filters and quick actions. `soft` is the
 * green-tinted variant; `selected` is what the Work filters use for the view you are looking at.
 */
export const chipVariants = cva(
  "inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-1 " +
    "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "border border-line-strong bg-paper text-ink hover:border-line-hover",
        soft: "border border-transparent bg-accent-green-soft text-accent-green-ink",
      },
      selected: {
        true: "border-transparent bg-navy text-paper hover:border-transparent",
        false: "",
      },
    },
    defaultVariants: { variant: "default", selected: false },
  },
);

export type ChipProps = ComponentProps<"button"> & VariantProps<typeof chipVariants>;

export function Chip({ className, variant, selected, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? undefined}
      className={cn(chipVariants({ variant, selected }), className)}
      {...props}
    />
  );
}

/** A count beside a section title — the prototype's `.count`. */
export function Count({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "rounded-pill bg-surface-sunken px-2 py-0.5 text-xs font-bold text-ink-secondary",
        className,
      )}
      {...props}
    />
  );
}
