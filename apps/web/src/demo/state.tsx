import {
  DEMO_AUTOMATIONS,
  DEMO_JOBS,
  DEMO_SCENARIOS,
  DEMO_WORK,
  type DemoAutomation,
  type DemoJob,
  type DemoScenario,
  type DemoThread,
  type DemoWork,
  type DemoWorkState,
  DEMO_THREADS,
} from "@asap/schema";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { env } from "../env.js";

/**
 * Demo state (D-064).
 *
 * The approved demo keeps temporary state for the length of a browser session and clears it on
 * Reset. This does the same, in React, over the typed fixtures — so a presenter can send a
 * fictional email, watch Work move to Waiting, assign an owner, approve something, and start again.
 *
 * Two boundaries this module exists to hold:
 *
 *  - **Nothing here is a business fact.** It is demonstration state. Every surface that reads it
 *    renders the demo notice, and a simulated send is labelled as simulated rather than claiming a
 *    provider delivered anything.
 *  - **It does not exist in production.** `isDemo` is false unless the deployment turns it on, and
 *    every presenter control is gated on it.
 */

export type DemoEvent = { at: string; text: string };

type DemoState = {
  isDemo: boolean;
  scenarios: readonly DemoScenario[];
  activeScenarioId: string;
  setScenario: (id: string) => void;
  nextScenario: () => void;
  previousScenario: () => void;
  work: DemoWork[];
  jobs: DemoJob[];
  automations: DemoAutomation[];
  threads: DemoThread[];
  /** Fictional sends and approvals, newest first, for the history panels. */
  events: DemoEvent[];
  setWorkState: (id: string, state: DemoWorkState, note: string) => void;
  assign: (id: string, owner: string) => void;
  toggleAutomation: (id: string) => void;
  /** Appends to a fictional thread. Records that it was simulated — never that it was delivered. */
  sendDemoEmail: (threadId: string, body: string, workId: string | null) => void;
  saveDemoDraft: (workId: string | null) => void;
  reset: () => void;
};

const DemoContext = createContext<DemoState | null>(null);

const stamp = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function DemoProvider({ children }: { children: ReactNode }) {
  const isDemo = env.VITE_PUBLIC_DEMO_MODE === "on";
  const [activeScenarioId, setActiveScenarioId] = useState(DEMO_SCENARIOS[0]?.id ?? "");
  const [work, setWork] = useState<DemoWork[]>(() => DEMO_WORK.map((w) => ({ ...w })));
  const [jobs, setJobs] = useState<DemoJob[]>(() => DEMO_JOBS.map((j) => ({ ...j })));
  const [automations, setAutomations] = useState<DemoAutomation[]>(() =>
    DEMO_AUTOMATIONS.map((a) => ({ ...a })),
  );
  const [threads, setThreads] = useState<DemoThread[]>(() =>
    DEMO_THREADS.map((t) => ({ ...t, messages: [...t.messages] })),
  );
  const [events, setEvents] = useState<DemoEvent[]>([]);

  const record = useCallback((text: string) => {
    setEvents((prev) => [{ at: stamp(), text }, ...prev].slice(0, 40));
  }, []);

  const setScenario = useCallback((id: string) => setActiveScenarioId(id), []);

  const step = useCallback((delta: number) => {
    setActiveScenarioId((current) => {
      const i = DEMO_SCENARIOS.findIndex((s) => s.id === current);
      const next = (i + delta + DEMO_SCENARIOS.length) % DEMO_SCENARIOS.length;
      return DEMO_SCENARIOS[next]?.id ?? current;
    });
  }, []);

  const setWorkState = useCallback(
    (id: string, state: DemoWorkState, note: string) => {
      setWork((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, state, reason: note, history: [[stamp(), note], ...w.history] }
            : w,
        ),
      );
      record(note);
    },
    [record],
  );

  const assign = useCallback(
    (id: string, owner: string) => {
      setWork((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, owner, history: [[stamp(), `Assigned to ${owner}`], ...w.history] }
            : w,
        ),
      );
      record(`Assigned to ${owner}`);
    },
    [record],
  );

  const toggleAutomation = useCallback(
    (id: string) => {
      setAutomations((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const enabled = !a.enabled;
          record(`${enabled ? "Switched on" : "Paused"}: ${a.name}`);
          return { ...a, enabled };
        }),
      );
    },
    [record],
  );

  const sendDemoEmail = useCallback(
    (threadId: string, body: string, workId: string | null) => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  {
                    id: `m${t.messages.length + 1}`,
                    from: "grace@asapbrokers.co.ke",
                    to: t.counterparty,
                    at: stamp(),
                    direction: "outbound" as const,
                    body,
                  },
                ],
              }
            : t,
        ),
      );
      // The approved behaviour: sending moves the Work to Waiting, because the next move is
      // somebody else's. The wording never claims a provider delivered it.
      if (workId) {
        setWorkState(workId, "waiting", "Simulated send recorded. Waiting on the other party.");
      }
      record("Simulated send — no real message left this demo");
    },
    [record, setWorkState],
  );

  const saveDemoDraft = useCallback(
    (workId: string | null) => {
      if (workId) setWorkState(workId, "review", "Draft saved. A person still has to send it.");
      record("Draft saved — nothing was sent");
    },
    [record, setWorkState],
  );

  const reset = useCallback(() => {
    setWork(DEMO_WORK.map((w) => ({ ...w })));
    setJobs(DEMO_JOBS.map((j) => ({ ...j })));
    setAutomations(DEMO_AUTOMATIONS.map((a) => ({ ...a })));
    setThreads(DEMO_THREADS.map((t) => ({ ...t, messages: [...t.messages] })));
    setEvents([]);
    setActiveScenarioId(DEMO_SCENARIOS[0]?.id ?? "");
  }, []);

  const value = useMemo<DemoState>(
    () => ({
      isDemo,
      scenarios: DEMO_SCENARIOS,
      activeScenarioId,
      setScenario,
      nextScenario: () => step(1),
      previousScenario: () => step(-1),
      work,
      jobs,
      automations,
      threads,
      events,
      setWorkState,
      assign,
      toggleAutomation,
      sendDemoEmail,
      saveDemoDraft,
      reset,
    }),
    [
      isDemo,
      activeScenarioId,
      setScenario,
      step,
      work,
      jobs,
      automations,
      threads,
      events,
      setWorkState,
      assign,
      toggleAutomation,
      sendDemoEmail,
      saveDemoDraft,
      reset,
    ],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo outside DemoProvider");
  return ctx;
}
