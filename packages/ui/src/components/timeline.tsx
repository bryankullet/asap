import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** The prototype's `.timeline`: a hairline rail with a dot per event, green for the current one. */
export function Timeline({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn(
        "relative flex flex-col pl-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line-strong",
        className,
      )}
      {...props}
    />
  );
}

export function TimelineEvent({
  current = false,
  title,
  when,
  className,
  children,
  ...props
}: Omit<ComponentProps<"li">, "title"> & {
  current?: boolean;
  title: ReactNode;
  when?: ReactNode;
}) {
  return (
    <li className={cn("relative pt-0 pr-0 pb-4 pl-4 last:pb-0", className)} {...props}>
      <span
        aria-hidden
        className={cn(
          "absolute top-1.5 -left-[3px] h-[9px] w-[9px] rounded-full border-[3px] border-paper",
          current ? "bg-accent-green" : "bg-dot-neutral",
        )}
      />
      <strong className="block text-sm font-semibold text-ink">{title}</strong>
      {when ? <span className="text-xs text-ink-muted">{when}</span> : null}
      {children}
    </li>
  );
}
