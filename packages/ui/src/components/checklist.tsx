import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** The prototype's `.checklist`: hairline-separated rows, each with a square mark. */
export function Checklist({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("flex flex-col", className)} {...props} />;
}

export function ChecklistRow({
  done = false,
  mark,
  title,
  detail,
  className,
  children,
  ...props
}: Omit<ComponentProps<"li">, "title"> & {
  done?: boolean;
  /** What sits in the square. Defaults to a tick when done, a dash when not. */
  mark?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 border-b border-line-soft py-2.5 last:border-b-0",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-xs font-bold",
          done ? "bg-accent-green-soft text-accent-green" : "bg-surface-sunken text-ink-muted",
        )}
      >
        {mark ?? (done ? "✓" : "–")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{title}</p>
        {detail ? <span className="mt-0.5 block text-xs text-ink-muted">{detail}</span> : null}
        {children}
      </div>
    </li>
  );
}
