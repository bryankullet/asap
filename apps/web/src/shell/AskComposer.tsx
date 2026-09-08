import type { AskResponse } from "@asap/schema";
import { Input } from "@asap/ui";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";
import { api, describeApiError } from "../lib/api.js";

/**
 * Ask, Phase 1: a search bar that returns a UiIntent. It opens things; it cannot act
 * (UI Build Spec v1 Part 4.3). The response is validated against the shared contract in api.ts.
 */
export function AskComposer() {
  const [q, setQ] = useState("");
  const [last, setLast] = useState<AskResponse | null>(null);
  const navigate = useNavigate();
  const id = useId();
  const ask = useMutation({
    mutationFn: api.ask,
    onSuccess: (res) => {
      setLast(res);
      if (res.intent.type === "open_record" && res.intent.target) {
        void navigate({ to: "/r/$recordId", params: { recordId: res.intent.target } });
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length === 0) return;
    ask.mutate(q.trim());
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} role="search" aria-label="Ask ASAP" className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium text-ink-muted">
          Ask
        </label>
        <Input
          id={id}
          name="q"
          value={q}
          placeholder="Find a client, vehicle or item…"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      {ask.isPending && <p className="text-xs text-ink-muted">Searching…</p>}
      {ask.isError && <p className="text-xs text-accent-red">{describeApiError(ask.error)}</p>}
      {last && !ask.isPending && (
        <div className="flex flex-col gap-1 text-sm" aria-live="polite">
          <p className="text-ink-secondary">{last.intent.answer}</p>
          {last.results.length > 1 && (
            <ul className="flex flex-col gap-1">
              {last.results.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/r/$recordId"
                    params={{ recordId: r.id }}
                    className="text-ink hover:underline"
                  >
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
