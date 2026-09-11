import { scenarioGroups } from "@asap/schema";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useDemo } from "./state.js";

/**
 * The presenter bar, ported from the approved demo (D-064).
 *
 * 44px tall, `#151c18`, the DEMO MODE label on the left and the controls on the right — scenario
 * picker, previous, the counter, next, coverage and reset. Gated on demo mode, so a brokerage
 * running the real product never sees it.
 *
 * Reset restores the fictional fixtures only. There is nothing else for it to restore: demo state
 * lives in React and sessionStorage, never in the brokerage's database.
 */
export function PresenterBar() {
  const demo = useDemo();
  const navigate = useNavigate();
  const [coverage, setCoverage] = useState(false);
  if (!demo.isDemo) return null;

  const groups = scenarioGroups();
  const index = demo.scenarios.findIndex((s) => s.id === demo.activeScenarioId);

  const go = (id: string) => {
    demo.setScenario(id);
    void navigate({ to: "/ask", search: { scenario: id } });
  };
  const step = (delta: number) => {
    const i = (index + delta + demo.scenarios.length) % demo.scenarios.length;
    const s = demo.scenarios[i];
    if (s) go(s.id);
  };

  return (
    <>
      <div className="demo-bar">
        <div className="demo-label">
          <span aria-hidden className="demo-dot" /> DEMO MODE
        </div>
        <div className="demo-controls">
          <label htmlFor="scenario-pick" className="sr-only">
            Choose a demo scenario
          </label>
          <select
            id="scenario-pick"
            className="demo-select"
            value={demo.activeScenarioId}
            onChange={(e) => go(e.target.value)}
          >
            {groups.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className="demo-btn" onClick={() => step(-1)}>
            ← <span>Previous</span>
          </button>
          <span className="demo-count">
            {index + 1} / {demo.scenarios.length}
          </span>
          <button type="button" className="demo-btn" onClick={() => step(1)}>
            <span>Next</span> →
          </button>
          <button
            type="button"
            className="demo-btn"
            aria-expanded={coverage}
            onClick={() => setCoverage((v) => !v)}
          >
            ✓ <span>Coverage</span>
          </button>
          <button type="button" className="demo-btn reset" onClick={demo.reset}>
            ↻ <span>Reset</span>
          </button>
        </div>
      </div>

      {coverage && (
        <div className="coverage-sheet">
          <h2>Intent and Skill Map coverage</h2>
          <p>
            {demo.scenarios.length} scenarios across {groups.length} domains. Every one is reachable
            from Ask ASAP.
          </p>
          <ul>
            {groups.map((g) => (
              <li key={g.group}>
                {g.group} <span>{g.scenarios.length}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="demo-btn" onClick={() => setCoverage(false)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
