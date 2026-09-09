import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

/**
 * The prototype's card: a hairline border and a generous radius, never a drop shadow at rest.
 * Shadow is reserved for things that float (modal, drawer, toast, the Ask dock) and for the lift a
 * clickable card takes on hover.
 */
export const cardVariants = cva("rounded-card border p-5", {
  variants: {
    variant: {
      default: "border-line-strong bg-paper",
      /** No frame at all: grouping without a box. */
      quiet: "border-transparent bg-transparent p-0",
      /** Gold left rule: something wants a person's attention. */
      attention: "border-line-strong bg-paper border-l-4 border-l-accent-gold",
      green: "border-[#c8e7da] bg-accent-green-soft",
      /** The prototype's `.focus-card`: the one panel a record page leads with. */
      focus: "border-[#b4d2c8] border-l-4 border-l-accent-green bg-paper p-6",
      dark: "border-navy bg-navy text-paper",
    },
    clickable: {
      true: "cursor-pointer transition hover:border-line-hover hover:shadow-lift motion-reduce:transition-none",
      false: "",
    },
  },
  defaultVariants: { variant: "default", clickable: false },
});

export type CardProps = ComponentProps<"section"> & VariantProps<typeof cardVariants>;

export function Card({ className, variant, clickable, ...props }: CardProps) {
  return <section className={cn(cardVariants({ variant, clickable }), className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("font-heading text-base font-semibold tracking-tight text-ink", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm leading-relaxed text-ink-muted", className)} {...props} />;
}
