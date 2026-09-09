import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** The prototype's `.page`: one measured column, whatever the window. */
export function Page({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("mx-auto w-full max-w-[1000px] px-4 pt-6 pb-12", className)} {...props} />
  );
}

/** The prototype's `.page-head`: a title and its one sentence, with actions pushed right. */
export function PageHead({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-7 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-heading text-[clamp(1.7rem,3vw,2.4rem)] leading-tight font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description ? <p className="mt-1 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** The prototype's `.section-title`, with room for a count or a link on the right. */
export function SectionTitle({
  id,
  children,
  aside,
  className,
}: {
  id?: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-8 mb-3.5 flex items-center justify-between gap-4", className)}>
      <h2 id={id} className="font-heading text-xl font-semibold tracking-tight text-ink">
        {children}
      </h2>
      {aside}
    </div>
  );
}

/** The prototype's `.empty-state`. Abstention is a state, not a blank (§36). */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-10 text-center", className)}>
      <h2 className="font-heading text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {children ? <div className="mt-2 text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
