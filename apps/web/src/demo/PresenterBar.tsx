import { scenarioGroups } from "@asap/schema";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useDemo } from "./state.js";

/**
 * The presenter bar (D-064).
 *
 * Scenario picker, previous, next, coverage and reset — the approved demo's own controls. It is
 * gated on demo mode and renders nothing otherwise, so a brokerage running the real product never
 * sees it.
 *
 * Reset restores the fictional fixtures only. There is nothing else for it to restore: demo state
 * lives in React, never in the brokerage's database.
 */
export function PresenterBar() {
  const demo = useDemo();
  const navigate = useNavigate();
  const [coverage, setCoverage] = useState(false);
  if (!demo.isDemo) return null;

  const groups = scenarioGroups();
  const index = demo.scenarios.findIndex((s) => s.id === demo.activeScenarioId);

  function go(id: string) {
    demo.setScenario(id);
    void navigate({ to: "/ask", search: { scenario: id } });
  }

  return (
    <div className="sticky top-0 z-30 flex min-h-[2.25rem] flex-wrap items-center gap-2 bg-navy px-3 py-1.5 text-paper">
      <span className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.14em]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#f0c75e]" />
        DEMO MODE
      </span>

      <label htmlFor="scenario-pick" className="sr-only">
        Choose a scenario
      </label>
      <select
        id="scenario-pick"
        value={demo.activeScenarioId}
        onChange={(e) => go(e.target.value)}
        className="min-h-[28px] max-w-[16rem] rounded-compact bg-paper/10 px-2 text-xs text-paper"
      >
        {groups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.scenarios.map((s) => (
              <option key={s.id} value={s.id} className="text-ink">
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <button
        type="button"
        onClick={() => {
          demo.previousScenario();
          const i = (index - 1 + demo.scenarios.length) % demo.scenarios.length;
          const s = demo.scenarios[i];
          if (s) void navigate({ to: "/ask", search: { scenario: s.id } });
        }}
        className="rounded-compact bg-paper/10 px-2 py-1 text-xs hover:bg-paper/20"
      >
        ← Previous
      </button>
      <span className="text-xs tabular-nums opacity-80">
        {index + 1} / {demo.scenarios.length}
      </span>
      <button
        type="button"
        onClick={() => {
          demo.nextScenario();
          const i = (index + 1) % demo.scenarios.length;
          const s = demo.scenarios[i];
          if (s) void navigate({ to: "/ask", search: { scenario: s.id } });
        }}
        className="rounded-compact bg-paper/10 px-2 py-1 text-xs hover:bg-paper/20"
      >
        Next →
      </button>

      <button
        type="button"
        onClick={() => setCoverage((v) => !v)}
        aria-expanded={coverage}
        className="rounded-compact bg-paper/10 px-2 py-1 text-xs hover:bg-paper/20"
      >
        ✓ Coverage
      </button>
      <button
        type="button"
        onClick={demo.reset}
        className="ml-auto rounded-compact bg-paper/10 px-2 py-1 text-xs hover:bg-paper/20"
      >
        ↻ Reset
      </button>

      {coverage && (
        <div className="w-full rounded-card bg-paper p-3 text-ink">
          <h2 className="text-sm font-medium">Intent and Skill Map coverage</h2>
          <p className="text-xs text-ink-muted">
            {demo.scenarios.length} scenarios across {groups.length} domains. Every one is reachable
            from the rail on Ask ASAP.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <li
                key={g.group}
                className="rounded-pill border border-line-strong px-2.5 py-0.5 text-xs text-ink-secondary"
              >
                {g.group} · {g.scenarios.length}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
