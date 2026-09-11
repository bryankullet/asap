import { DEMO_CLIENTS, DEMO_NOTICE } from "@asap/schema";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * `+ New` — the approved starting paths (D-064).
 *
 * Three ways in: give ASAP something, tell it what you need, or create a record directly. Each one
 * leads somewhere real. The old behaviour — a menu whose items said "not available yet" — is
 * exactly what the approved demo is meant to replace: the primary action of a demonstration
 * cannot be an apology.
 */
const KINDS = [
  { id: "client", label: "A client", hint: "Someone the brokerage will act for" },
  { id: "opportunity", label: "An opportunity", hint: "New business to quote and place" },
  { id: "policy", label: "A policy", hint: "Cover that has been placed" },
  { id: "claim", label: "A claim", hint: "An incident to notify and track" },
  { id: "payment", label: "A payment", hint: "Money received, to match against what is owed" },
  { id: "work", label: "A piece of work", hint: "Something to do that is not any of the above" },
] as const;

export function NewThing() {
  const { kind } = useSearch({ strict: false }) as { kind?: string };
  const navigate = useNavigate();
  const demo = useDemo();
  const [told, setTold] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState("");

  const chosen = KINDS.find((k) => k.id === kind);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Start something</h1>
        <p className="text-sm text-ink-secondary">
          Give ASAP what you have, tell it what you need, or create a record yourself.
        </p>
      </header>

      <section
        aria-label="Give ASAP something"
        className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4"
      >
        <h2 className="text-sm font-medium text-ink">Give ASAP something to read</h2>
        <p className="text-xs text-ink-muted">
          A schedule, a quote, a statement, an email — ASAP reads it, says what it found, and opens
          the work it belongs to.
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted">
            Upload files
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const n = e.target.files?.length ?? 0;
                if (n > 0) setCreated(`${n} ${n === 1 ? "file" : "files"} queued for reading`);
              }}
            />
          </label>
          <Link
            to="/documents"
            className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
          >
            See what is already on file
          </Link>
        </div>
        <label htmlFor="paste" className="text-xs text-ink-muted">
          Or paste information
        </label>
        <textarea
          id="paste"
          rows={3}
          placeholder="Paste an email, a schedule extract, a list of vehicles…"
          className="rounded-control border border-line-strong bg-paper p-2.5 text-sm"
          onChange={(e) => setCreated(e.target.value.trim() ? "Ready to read what you pasted" : null)}
        />
      </section>

      <section
        aria-label="Tell ASAP"
        className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4"
      >
        <h2 className="text-sm font-medium text-ink">Tell ASAP what you need</h2>
        <div className="flex flex-wrap gap-2">
          <label htmlFor="tell" className="sr-only">
            What do you need?
          </label>
          <input
            id="tell"
            value={told}
            onChange={(e) => setTold(e.target.value)}
            placeholder="Add a vehicle to Acme's cover…"
            className="min-h-[40px] flex-1 rounded-control border border-line-strong bg-paper px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => {
              const hit =
                demo.scenarios.find((s) => s.ask.toLowerCase().includes(told.trim().toLowerCase())) ??
                demo.scenarios[0];
              if (hit) void navigate({ to: "/ask", search: { scenario: hit.id } });
            }}
            disabled={told.trim().length === 0}
            className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover disabled:opacity-50"
          >
            Ask ASAP
          </button>
        </div>
      </section>

      <section
        aria-label="Create a record"
        className="flex flex-col gap-3 rounded-card border border-line-strong bg-paper p-4"
      >
        <h2 className="text-sm font-medium text-ink">Or create a record</h2>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Link
              key={k.id}
              to="/new"
              search={{ kind: k.id }}
              aria-current={k.id === kind ? "true" : undefined}
              className={`rounded-pill px-3 py-1 text-sm ${
                k.id === kind
                  ? "bg-navy text-paper"
                  : "border border-line-strong text-ink-secondary hover:border-ink-muted"
              }`}
            >
              {k.label}
            </Link>
          ))}
        </div>

        {chosen && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCreated(`${chosen.label} created: ${name}`);
              setName("");
            }}
          >
            <p className="text-xs text-ink-muted">{chosen.hint}</p>
            <label htmlFor="new-name" className="sr-only">
              Name
            </label>
            <input
              id="new-name"
              value={name}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder={chosen.id === "client" ? "Client name" : `What is this ${chosen.label.toLowerCase()}?`}
              className="min-h-[40px] rounded-control border border-line-strong bg-paper px-3 text-sm"
            />
            {chosen.id !== "client" && (
              <>
                <label htmlFor="new-client" className="text-xs text-ink-muted">
                  For which client?
                </label>
                <select
                  id="new-client"
                  className="min-h-[40px] rounded-control border border-line-strong bg-paper px-3 text-sm"
                >
                  {DEMO_CLIENTS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="submit"
              className="self-start rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
            >
              Create
            </button>
          </form>
        )}

        {created && (
          <p className="rounded-card bg-wash px-3 py-2 text-sm text-ink-secondary" role="status">
            {created}.
          </p>
        )}
      </section>

      <DemoBoundary>
        {DEMO_NOTICE} Creating here adds to the demonstration only — no brokerage record is written.
      </DemoBoundary>
    </div>
  );
}
