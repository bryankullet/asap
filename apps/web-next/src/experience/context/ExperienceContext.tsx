import type { ActionSpec, ASAPExperienceSpec, ExperienceUiState } from "@asap/schema";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ContinuityStore } from "../continuity/ContinuityStore.js";
import type { DispatchExtra, FormResult } from "../interactions/ActionDispatcher.js";

/** What every rendered component may reach: the validated spec, its state, and dispatch. Nothing more. */
export type ExperienceCtx = {
  spec: ASAPExperienceSpec;
  store: ContinuityStore;
  run: (actionId: string, extra?: DispatchExtra) => Promise<void>;
  pending: ReadonlySet<string>;
  formResults: Readonly<Record<string, FormResult>>;
  changed: ReadonlySet<string>;
  added: ReadonlySet<string>;
  narrow: boolean;
};

const Ctx = createContext<ExperienceCtx | null>(null);
/** Asking inside the experience — the Ask bar, and answers typed into a clarification. */
const AskCtx = createContext<{ ask: (text: string) => Promise<void>; busy: boolean } | null>(null);
export const AskProvider = AskCtx.Provider;
export function useExperienceAsk() {
  const v = useContext(AskCtx);
  if (!v) throw new Error("useExperienceAsk outside an experience");
  return v;
}
export const ExperienceProvider = Ctx.Provider;

export function useExperience(): ExperienceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useExperience outside an experience");
  return v;
}

export function useUi(): ExperienceUiState {
  const { store } = useExperience();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useAction(id: string | null | undefined): ActionSpec | null {
  const { spec } = useExperience();
  return id ? (spec.actions.find((a) => a.id === id) ?? null) : null;
}

/** Narrow layout under 900px — the same breakpoint as the rest of ASAP. */
export function useNarrow(): boolean {
  const query = "(max-width: 899px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}
