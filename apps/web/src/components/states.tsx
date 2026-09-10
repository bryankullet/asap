import { Card, CardDescription, CardTitle, EmptyState as EmptyStateShell } from "@asap/ui";
import type { ReactNode } from "react";

/**
 * The states every screen owes (UI Build Spec v1 Part 10). Empty names its scope and freshness and
 * offers one action; loading is a skeleton in the final layout; missing data and errors say so.
 */

export function EmptyState({
  scope,
  freshness,
  action,
}: {
  scope: string;
  freshness?: string;
  action?: ReactNode;
}) {
  return (
    <Card role="status">
      <EmptyStateShell title={`Nothing in ${scope}`} action={action}>
        {freshness}
      </EmptyStateShell>
    </Card>
  );
}

export function LoadingList({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-card border border-line-strong bg-paper"
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function MissingData({ what, why }: { what: string; why: string }) {
  return (
    <Card role="status" variant="attention" className="flex flex-col gap-1">
      <CardTitle>{what}</CardTitle>
      <CardDescription>{why}</CardDescription>
    </Card>
  );
}

export function ErrorState({ what, retry }: { what: string; retry?: () => void }) {
  return (
    <Card role="alert" className="flex flex-col gap-2 border-l-4 border-l-accent-red">
      <CardTitle>{what}</CardTitle>
      <CardDescription>Nothing was changed. Try again, or refresh the page.</CardDescription>
      {retry && (
        <button
          type="button"
          className="self-start text-sm font-bold text-accent-green underline underline-offset-2"
          onClick={retry}
        >
          Try again
        </button>
      )}
    </Card>
  );
}

export function Stale({ from }: { from: string }) {
  return <p className="text-xs text-ink-muted">Data from {from}.</p>;
}

/**
 * Something the caller's role does not include. It names what and why, and never renders a blank
 * where a value would be (ui-contract: "a restricted field says 'Not available to your role'").
 */
export function PermissionNotice({ what, role }: { what: string; role?: string | undefined }) {
  return (
    <Card role="status" variant="quiet" className="flex flex-col gap-1">
      <CardTitle>{what} is not available to your role</CardTitle>
      <CardDescription>
        {role ? `Your role in this brokerage is ${role}. ` : ""}
        Nothing is hidden without saying so. Ask a brokerage administrator if you need it.
      </CardDescription>
    </Card>
  );
}

/**
 * Part of the answer could not be read. The rest is shown rather than thrown away — §36's
 * partial-success state, which is the honest alternative to a blank screen or a silent gap.
 */
export function PartialSuccess({
  parts,
}: {
  parts: { what: string; because: string }[];
}) {
  if (parts.length === 0) return null;
  return (
    <Card role="status" variant="attention" className="flex flex-col gap-1.5">
      <CardTitle>Some of this could not be loaded</CardTitle>
      <CardDescription>
        Everything else below is current. What is missing is named, not guessed at.
      </CardDescription>
      <ul className="flex flex-col gap-1 text-sm text-ink-secondary">
        {parts.map((p) => (
          <li key={p.what}>
            <span className="text-ink">{p.what}</span> — {p.because}
          </li>
        ))}
      </ul>
    </Card>
  );
}
