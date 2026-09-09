import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

/**
 * The prototype's `.table`, in its `.table-wrap` scroller so a wide table scrolls inside itself
 * rather than pushing the page sideways.
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn("w-full min-w-[430px] border-collapse text-left", className)}
        {...props}
      />
    </div>
  );
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line-strong px-2.5 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  best = false,
  ...props
}: ComponentProps<"td"> & { best?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-line-soft px-2.5 py-3 align-top text-sm",
        best && "bg-accent-green-soft font-bold",
        className,
      )}
      {...props}
    />
  );
}
