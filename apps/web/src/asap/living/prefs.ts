import type { SurfacePreferences } from "@asap/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrefsStore } from "../shell/types.js";

/**
 * One person's arrangement of one surface (D-157): pinned and collapsed blocks, selections inside
 * blocks, when they last looked. Kept on the server per brokerage, person and surface through the
 * shell's adapters. Without a store (demo mode, the UI Lab) it lives for this visit only: nothing
 * goes into browser storage, so a shared computer never hands one person's arrangement to another.
 */
export const EMPTY_PREFS: SurfacePreferences = { pinned: [], collapsed: [], selection: {}, lastSeenAt: null };

export function useSurfacePrefs(store: PrefsStore | undefined, surfaceKey: string | null) {
  const [prefs, setPrefs] = useState<SurfacePreferences>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(prefs);
  latest.current = prefs;

  useEffect(() => {
    setPrefs(EMPTY_PREFS);
    setLoaded(false);
    if (!surfaceKey) return;
    let live = true;
    const seen = new Date().toISOString();
    if (!store) { setLoaded(true); return; }
    store.get(surfaceKey).then(
      (p) => {
        if (!live) return;
        setPrefs(p);
        setLoaded(true);
        // Looking at the surface is what "since you last looked" is measured from.
        void store.put(surfaceKey, { ...p, lastSeenAt: seen }).catch(() => {});
      },
      () => live && setLoaded(true),
    );
    return () => { live = false; };
  }, [store, surfaceKey]);

  const update = useCallback((change: (p: SurfacePreferences) => SurfacePreferences) => {
    const next = change(latest.current);
    setPrefs(next);
    if (!store || !surfaceKey) return;
    // Saved at once: a person who refreshes straight after a click keeps what they arranged.
    void store.put(surfaceKey, next).catch(() => {});
  }, [store, surfaceKey]);

  return { prefs, loaded, update };
}
