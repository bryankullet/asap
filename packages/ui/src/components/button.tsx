import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

/**
 * Primitive button in the shadcn/ui shape, styled with the ASAP design tokens
 * (see apps/web/src/styles/tokens.css). Focus states are visible by default —
 * brokers work fast and keyboard-first.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-2 " +
    "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "bg-ink text-paper hover:bg-ink-secondary",
        accent: "bg-accent-green text-paper hover:opacity-90",
        outline: "border border-line-strong bg-paper text-ink hover:bg-wash",
        ghost: "text-ink hover:bg-wash",
        destructive: "bg-accent-red text-paper hover:opacity-90",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element instead of a <button>, keeping the styles. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
