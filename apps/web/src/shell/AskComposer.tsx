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
  const renew = useMutation({
    mutationFn: (clientName: string) =>
      api.createWorkItem({ kind: "renewal", clientName, insurers: [] }),
    onSuccess: (res) => {
      setLast(null);
      void navigate({ to: "/r/$recordId", params: { recordId: res.item.id } });
    },
  });
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
    const text = q.trim();
    if (text.length === 0) return;
    // "Renew <client>" opens a renewal; asking twice reopens the same item (Part 5.4).
    const m = /^renew\s+(.+)$/i.exec(text);
    if (m?.[1]) {
      renew.mutate(m[1].trim());
      return;
    }
    ask.mutate(text);
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
      {(ask.isPending || renew.isPending) && (
        <p className="text-xs text-ink-muted">{renew.isPending ? "Opening…" : "Searching…"}</p>
      )}
      {ask.isError && <p className="text-xs text-accent-red">{describeApiError(ask.error)}</p>}
      {renew.isError && <p className="text-xs text-accent-red">{describeApiError(renew.error)}</p>}
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
