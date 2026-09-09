import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

export type SelectProps = ComponentProps<"select"> & { invalid?: boolean };

/** Native select, styled. Enough for Phase 1 forms; Radix Select can replace it later. */
export function Select({ className, invalid, children, ...props }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-[46px] w-full rounded-control border bg-paper px-3.5 py-3 text-sm text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid ? "border-accent-red" : "border-line-strong",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
