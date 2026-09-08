import { Card, CardDescription, CardTitle } from "@asap/ui";
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
    <Card role="status" className="flex flex-col gap-2">
      <CardTitle>Nothing in {scope}</CardTitle>
      {freshness && <CardDescription>{freshness}</CardDescription>}
      {action}
    </Card>
  );
}

export function LoadingList({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-card bg-paper shadow-card" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function MissingData({ what, why }: { what: string; why: string }) {
  return (
    <Card role="status" className="flex flex-col gap-1 border border-accent-gold-soft">
      <CardTitle>{what}</CardTitle>
      <CardDescription>{why}</CardDescription>
    </Card>
  );
}

export function ErrorState({ what, retry }: { what: string; retry?: () => void }) {
  return (
    <Card role="alert" className="flex flex-col gap-2 border border-accent-red-soft">
      <CardTitle>{what}</CardTitle>
      <CardDescription>Nothing was changed. Try again, or refresh the page.</CardDescription>
      {retry && (
        <button
          type="button"
          className="self-start text-sm text-accent-green underline"
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
