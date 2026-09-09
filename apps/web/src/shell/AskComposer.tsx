import type { AskResponse, CreateClientResponse, CreateWorkItemResponse } from "@asap/schema";
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
  const [pending, setPending] = useState<CreateWorkItemResponse | CreateClientResponse | null>(
    null,
  );
  const [lastRequest, setLastRequest] = useState<{
    kind: "claim" | "endorsement";
    clientName: string;
    requestText?: string;
    incidentSummary?: string;
  } | null>(null);
  const renew = useMutation({
    mutationFn: (input: {
      kind?: "renewal" | "claim" | "endorsement";
      clientName?: string;
      clientId?: string;
      policyId?: string;
      requestText?: string;
      incidentOn?: string;
      incidentSummary?: string;
      source?: "ask";
    }) => api.createWorkItem({ kind: input.kind ?? "renewal", insurers: [], ...input }),
    onSuccess: (res) => {
      setLast(null);
      if (res.outcome === "opened") {
        setPending(null);
        void navigate({ to: "/r/$recordId", params: { recordId: res.item.id } });
        return;
      }
      setPending(res);
    },
  });
  // The H05 create path, with duplicate review. Ask never creates a client by itself (D-050).
  const createClient = useMutation({
    mutationFn: (input: { name: string; confirmNew: boolean }) =>
      api.createClient({ name: input.name, kind: "corporate", confirmNew: input.confirmNew }),
    onSuccess: (res) => {
      if (res.outcome === "created") {
        setPending(null);
        renew.mutate({ clientId: res.file.client.id });
        return;
      }
      setPending(res);
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
      setPending(null);
      renew.mutate({ clientName: m[1].trim() });
      return;
    }
    // "Claim for <client>": a draft claim, today's date, the words typed as the report; a person registers it.
    const cm = /^claim\s+(?:for\s+)?(.+?)(?::\s*(.+))?$/i.exec(text);
    if (cm?.[1]) {
      setPending(null);
      setLastRequest({
        kind: "claim",
        clientName: cm[1].trim(),
        incidentSummary: cm[2]?.trim() || `Reported through Ask: ${text}`,
      });
      renew.mutate({
        kind: "claim",
        clientName: cm[1].trim(),
        incidentOn: new Date().toISOString().slice(0, 10),
        incidentSummary: cm[2]?.trim() || `Reported through Ask: ${text}`,
        source: "ask",
      });
      return;
    }
    // "Endorse <client>: <request>" or "Change <client>'s policy: <request>"
    const em = /^(?:endorse|change)\s+(.+?)(?:'s policy)?(?::\s*(.+))?$/i.exec(text);
    if (em?.[1]) {
      setPending(null);
      const requestText = em[2]?.trim() || text;
      setLastRequest({ kind: "endorsement", clientName: em[1].trim(), requestText });
      renew.mutate({ kind: "endorsement", clientName: em[1].trim(), requestText });
      return;
    }
    ask.mutate(text);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Answers and choices sit above the bar, because the bar is docked to the foot of the page. */}
      <div className="empty:hidden flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-3 shadow-dock empty:border-0 empty:p-0 empty:shadow-none">
        {(ask.isPending || renew.isPending) && (
          <p className="text-xs text-ink-muted">{renew.isPending ? "Opening…" : "Searching…"}</p>
        )}
        {ask.isError && <p className="text-xs text-accent-red">{describeApiError(ask.error)}</p>}
        {renew.isError && (
          <p className="text-xs text-accent-red">{describeApiError(renew.error)}</p>
        )}
        {createClient.isError && (
          <p className="text-xs text-accent-red">{describeApiError(createClient.error)}</p>
        )}
        {pending?.outcome === "ambiguous" && (
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            <p className="text-ink-secondary">Which {pending.name}?</p>
            {pending.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className="text-left text-ink hover:underline"
                onClick={() => renew.mutate({ clientId: c.id })}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        {pending?.outcome === "ambiguous_policy" && (
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            <p className="text-ink-secondary">Which policy?</p>
            {pending.candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                className="text-left text-ink hover:underline"
                onClick={() =>
                  renew.mutate({
                    kind: "endorsement",
                    clientId: pending.clientId,
                    policyId: p.id,
                    requestText: lastRequest?.requestText ?? q,
                  })
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        {pending?.outcome === "no_policy" && (
          <p className="text-sm text-ink-secondary" aria-live="polite">
            {pending.intent.answer}
          </p>
        )}
        {pending?.outcome === "no_client" && (
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            <p className="text-ink-secondary">{pending.intent.answer}</p>
            <button
              type="button"
              className="text-left text-accent-green underline"
              onClick={() => createClient.mutate({ name: pending.name, confirmNew: false })}
            >
              {pending.intent.suggestions[0]}
            </button>
          </div>
        )}
        {pending?.outcome === "possible_duplicates" && (
          <div className="flex flex-col gap-1 text-sm" aria-live="polite">
            <p className="text-ink-secondary">
              Possibly already on file. Use an existing client, or create separately.
            </p>
            {pending.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className="text-left text-ink hover:underline"
                onClick={() => renew.mutate({ clientId: c.id })}
              >
                Use {c.name}
              </button>
            ))}
            <button
              type="button"
              className="text-left text-accent-red underline"
              onClick={() => createClient.mutate({ name: pending.name, confirmNew: true })}
            >
              Create {pending.name} separately
            </button>
          </div>
        )}
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
      <form
        onSubmit={submit}
        role="search"
        aria-label="Ask ASAP"
        className="flex items-center gap-2 rounded-[20px] border border-[#cbd6dc] bg-paper p-2.5 shadow-dock"
      >
        <label htmlFor={id} className="sr-only">
          Ask
        </label>
        <span aria-hidden className="px-1 text-xl text-accent-green">
          ✦
        </span>
        <Input
          id={id}
          name="q"
          value={q}
          placeholder="Find a client, vehicle or item…"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          className="min-h-[42px] flex-1 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
        />
        <button
          type="submit"
          aria-label="Ask"
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-control bg-navy text-paper hover:bg-navy-hover focus-visible:ring-2 focus-visible:ring-accent-green focus-visible:outline-none"
        >
          →
        </button>
      </form>
      <p className="hidden text-center text-[0.8125rem] text-ink-muted min-[900px]:block">
        Ask opens things. Sending, approving and paying are recorded by a person.
      </p>
    </div>
  );
}
