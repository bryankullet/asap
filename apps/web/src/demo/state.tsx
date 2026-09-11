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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { env } from "../env.js";

/**
 * Demo state (D-064).
 *
 * The approved demo keeps temporary state for the length of a browser session and clears it on
 * Reset. This does the same, in React, over the typed fixtures — so a presenter can send a
 * fictional email, watch Work move to Waiting, assign an owner, approve something, and start again.
 *
 * State lasts for the browser session, as the approved demo specifies, and Reset clears it. It is
 * held in sessionStorage as well as React so that a presenter who reloads the page mid-walkthrough
 * does not silently lose everything they have just demonstrated — and so it never outlives the tab.
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
  /**
   * Work a person has kept. Session state, like everything else here — but it has to live at this
   * level rather than inside the Work screen, or navigating to the Pinned filter unmounts the
   * component holding it and the marker silently disappears.
   */
  pinned: string[];
  togglePin: (workId: string) => void;
  setWorkState: (id: string, state: DemoWorkState, note: string) => void;
  assign: (id: string, owner: string) => void;
  toggleAutomation: (id: string) => void;
  createAutomation: (draft: Omit<DemoAutomation, "id" | "runs" | "lastTest">) => string;
  updateAutomation: (id: string, patch: Partial<DemoAutomation>) => void;
  deleteAutomation: (id: string) => void;
  /** Runs an automation against the fixtures and reports what it would have prepared. */
  testAutomation: (id: string) => string;
  /** Appends to a fictional thread. Records that it was simulated — never that it was delivered. */
  sendDemoEmail: (threadId: string, body: string, workId: string | null) => void;
  saveDemoDraft: (workId: string | null) => void;
  reset: () => void;
};

const DemoContext = createContext<DemoState | null>(null);

const STORE_KEY = "asap.demo.v1";

type Persisted = {
  work: DemoWork[];
  jobs: DemoJob[];
  automations: DemoAutomation[];
  threads: DemoThread[];
  events: DemoEvent[];
  pinned: string[];
  activeScenarioId: string;
};

/** sessionStorage can throw (private mode, blocked storage). A demo must not die for that. */
function readStore(): Partial<Persisted> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function writeStore(value: Persisted): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Nothing to do: the demo still works, it just will not survive a reload.
  }
}

const stamp = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function DemoProvider({ children }: { children: ReactNode }) {
  const isDemo = env.VITE_PUBLIC_DEMO_MODE === "on";
  const stored = useMemo(() => (isDemo ? readStore() : {}), [isDemo]);
  const [activeScenarioId, setActiveScenarioId] = useState(
    stored.activeScenarioId ?? DEMO_SCENARIOS[0]?.id ?? "",
  );
  const [work, setWork] = useState<DemoWork[]>(() => stored.work ?? DEMO_WORK.map((w) => ({ ...w })));
  const [jobs, setJobs] = useState<DemoJob[]>(() => stored.jobs ?? DEMO_JOBS.map((j) => ({ ...j })));
  const [automations, setAutomations] = useState<DemoAutomation[]>(
    () => stored.automations ?? DEMO_AUTOMATIONS.map((a) => ({ ...a })),
  );
  const [threads, setThreads] = useState<DemoThread[]>(
    () => stored.threads ?? DEMO_THREADS.map((t) => ({ ...t, messages: [...t.messages] })),
  );
  const [events, setEvents] = useState<DemoEvent[]>(stored.events ?? []);
  const [pinned, setPinned] = useState<string[]>(stored.pinned ?? []);

  useEffect(() => {
    if (!isDemo) return;
    writeStore({ work, jobs, automations, threads, events, pinned, activeScenarioId });
  }, [isDemo, work, jobs, automations, threads, events, pinned, activeScenarioId]);

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

  const createAutomation = useCallback(
    (draft: Omit<DemoAutomation, "id" | "runs" | "lastTest">) => {
      const id = `a-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}`;
      setAutomations((prev) => [
        ...prev,
        // A new automation starts switched off and untested. Nothing begins watching the
        // brokerage's mail because somebody filled in a form.
        { ...draft, id, enabled: false, lastTest: "Not tested yet", runs: [] },
      ]);
      record(`Created: ${draft.name}`);
      return id;
    },
    [record],
  );

  const updateAutomation = useCallback(
    (id: string, patch: Partial<DemoAutomation>) => {
      setAutomations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      record("Automation edited");
    },
    [record],
  );

  const deleteAutomation = useCallback(
    (id: string) => {
      setAutomations((prev) => {
        record(`Deleted: ${prev.find((a) => a.id === id)?.name ?? id}`);
        return prev.filter((a) => a.id !== id);
      });
    },
    [record],
  );

  const testAutomation = useCallback(
    (id: string) => {
      const found = automations.find((a) => a.id === id);
      if (!found) return "No such automation.";
      // A test says what it *would* prepare. It never performs the action.
      const outcome = `Would prepare: ${found.preparedAction}. Nothing was done.`;
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, lastTest: `Tested just now — ${outcome}` } : a)),
      );
      record(`Tested: ${found.name}`);
      return outcome;
    },
    [automations, record],
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

  const togglePin = useCallback((workId: string) => {
    setPinned((prev) => (prev.includes(workId) ? prev.filter((id) => id !== workId) : [...prev, workId]));
  }, []);

  const reset = useCallback(() => {
    setWork(DEMO_WORK.map((w) => ({ ...w })));
    setJobs(DEMO_JOBS.map((j) => ({ ...j })));
    setAutomations(DEMO_AUTOMATIONS.map((a) => ({ ...a })));
    setThreads(DEMO_THREADS.map((t) => ({ ...t, messages: [...t.messages] })));
    setEvents([]);
    setPinned([]);
    setActiveScenarioId(DEMO_SCENARIOS[0]?.id ?? "");
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      // As above: a demo must not die because storage is unavailable.
    }
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
      pinned,
      togglePin,
      setWorkState,
      assign,
      toggleAutomation,
      createAutomation,
      updateAutomation,
      deleteAutomation,
      testAutomation,
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
      pinned,
      togglePin,
      setWorkState,
      assign,
      toggleAutomation,
      createAutomation,
      updateAutomation,
      deleteAutomation,
      testAutomation,
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
