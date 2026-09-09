import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

export type InputProps = ComponentProps<"input"> & { invalid?: boolean };

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-[46px] w-full rounded-control border bg-paper px-3.5 py-3 text-sm text-ink placeholder:text-ink-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid ? "border-accent-red" : "border-line-strong",
        className,
      )}
      {...props}
    />
  );
}
