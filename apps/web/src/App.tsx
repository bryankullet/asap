import { useQuery } from "@tanstack/react-query";
import { Button } from "@asap/ui";
import type { HealthResponse } from "@asap/schema";
import { fetchHealth } from "./api.js";
import { env } from "./env.js";

/**
 * Phase 1 placeholder shell. Sign-in, create-brokerage, invitations and the organization
 * switcher arrive with work item 4. This screen exists to prove the web → schema → API path.
 */
export function App() {
  const health = useQuery<HealthResponse>({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold">ASAP</h1>
        <p className="text-ink-secondary">Insurance work, understood.</p>
      </header>

      <section className="rounded-card bg-paper p-6 shadow-card">
        <h2 className="mb-3 text-lg font-semibold">API</h2>
        {health.isPending && <p className="text-ink-muted">Checking…</p>}
        {health.isError && (
          <p role="alert" className="rounded-control bg-accent-red-soft p-3 text-accent-red">
            The API is not reachable at {env.VITE_PUBLIC_API_BASE_URL}.
          </p>
        )}
        {health.data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-muted">Status</dt>
            <dd>
              <span className="rounded-pill bg-accent-green-soft px-2 py-0.5 text-accent-green">
                {health.data.status}
              </span>
            </dd>
            <dt className="text-ink-muted">Version</dt>
            <dd>{health.data.version}</dd>
            <dt className="text-ink-muted">Commit</dt>
            <dd className="font-mono">{health.data.commit}</dd>
          </dl>
        )}
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={() => void health.refetch()}>
            Re-check
          </Button>
        </div>
      </section>

      <p className="text-xs text-ink-muted">Environment: {env.VITE_PUBLIC_APP_ENV}</p>
    </main>
  );
}
