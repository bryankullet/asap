import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

/**
 * The prototype's `.btn` and its modifiers, name for name: primary, green, ghost, soft, warn,
 * compact, full, plus the plain bordered default and `link` for `.link-btn`. `default` and
 * `accent` are kept as aliases of primary and green so existing call sites read the same.
 *
 * Focus states are visible by default — brokers work fast and keyboard-first.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-semibold transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-2 " +
    "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  {
    variants: {
      variant: {
        outline:
          "border border-line-strong bg-paper text-ink hover:border-line-hover hover:bg-wash",
        primary: "border border-navy bg-navy text-paper hover:bg-navy-hover",
        default: "border border-navy bg-navy text-paper hover:bg-navy-hover",
        green: "border border-accent-green bg-accent-green text-paper hover:brightness-110",
        accent: "border border-accent-green bg-accent-green text-paper hover:brightness-110",
        soft: "border border-transparent bg-accent-green-soft text-accent-green-ink hover:brightness-[0.98]",
        warn: "border border-accent-gold-line bg-accent-gold-soft text-accent-gold-ink",
        ghost: "border border-transparent bg-transparent text-ink hover:bg-wash",
        link: "h-auto border-0 bg-transparent p-0 font-bold text-accent-green underline-offset-2 hover:underline",
        destructive: "border border-accent-red bg-accent-red text-paper hover:brightness-110",
      },
      size: {
        /** The prototype's 42px hit target. */
        default: "min-h-[42px] px-4 py-2.5",
        compact: "min-h-[34px] rounded-compact px-3 py-1.5 text-[0.86rem]",
        sm: "min-h-[34px] rounded-compact px-3 py-1.5 text-[0.86rem]",
        lg: "min-h-[48px] px-6 text-base",
        icon: "h-[42px] w-[42px] p-0",
      },
      full: { true: "w-full", false: "" },
    },
    compoundVariants: [
      { variant: "link", size: "default", class: "min-h-0 px-0 py-0" },
      { variant: "link", size: "compact", class: "min-h-0 px-0 py-0" },
      { variant: "link", size: "sm", class: "min-h-0 px-0 py-0" },
    ],
    defaultVariants: { variant: "default", size: "default", full: false },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead of a <button>, keeping the styles. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, full, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, full }), className)} {...props} />;
}
