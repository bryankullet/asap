import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMe } from "../lib/me.js";
import Component from "./logic.js";
import "./asap.css";
import { AdaptiveShell } from "./shell/AdaptiveShell.js";
import type { Logic, ShellController } from "./shell/types.js";
import { loadDemoAdapters } from "./demo.js";
import { loadLiveAdapters } from "./live.js";

/*
 * The approved interface's logic is an ordinary React class (D-115). Since D-155 it renders the
 * adaptive shell, which lays out the approved Space, conversation and sheet renderers by what the
 * person is doing and owns the address.
 */
type LogicClass = Logic & { props: Record<string, unknown> & { shell: ShellController; orgKey: string }; renderVals(): Record<string, unknown> };
const proto = (Component as unknown as { prototype: LogicClass & { render(): unknown } }).prototype;
proto.render = function render(this: LogicClass) {
  return createElement(AdaptiveShell, { logic: this, v: { ...this.props, ...this.renderVals() }, controller: this.props.shell, orgKey: this.props.orgKey });
};
const AsapComponent = Component as unknown as React.ComponentType<{ loadAdapters: () => Promise<unknown>; shell: ShellController; orgKey: string }>;

type Mode = "live" | "demo";
const MODE_KEY = "asap.mode";

function readMode(): Mode {
  try {
    return sessionStorage.getItem(MODE_KEY) === "demo" ? "demo" : "live";
  } catch {
    return "live";
  }
}

/**
 * The application: the approved ASAP interface, mounted only inside the session and membership
 * guards. Live mode reads and writes this brokerage's records through the API; demo mode runs the
 * approved fictional records in this browser only, and says so.
 */
export function AsapApp() {
  const me = useMe();
  const [mode, setMode] = useState<Mode>(readMode);
  const [failure, setFailure] = useState<string | null>(null);
  // Filled in by the shell on every render; the logic calls it to navigate (D-155).
  const controller = useRef<ShellController>({ open: () => {}, home: () => {}, search: () => {}, ensureConversation: async () => null }).current;
  const router = useRouter();
  const orgKey = me.data ? `${me.data.active_organization?.id ?? "none"}:${me.data.user.id}` : "loading";

  const choose = useCallback((next: Mode) => {
    try {
      sessionStorage.setItem(MODE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    setFailure(null);
    setMode(next);
  }, []);

  // A brokerage or person switch clears inherited context at once: the app remounts (its key) and
  // opens Home, so no address from the previous brokerage stays open (D-155).
  const firstOrg = useRef(orgKey);
  useEffect(() => {
    if (orgKey === "loading" || firstOrg.current === orgKey) return;
    if (firstOrg.current !== "loading") router.history.replace("/");
    firstOrg.current = orgKey;
  }, [orgKey, router]);

  useEffect(() => {
    document.title = mode === "demo" ? "ASAP — demo" : "ASAP";
  }, [mode]);

  // The workspace is open, so onboarding's "opening your workspace" hand-off is finished.
  useEffect(() => {
    try {
      sessionStorage.removeItem("asap.brokerage.created");
    } catch {
      /* storage blocked */
    }
  }, []);

  const loadAdapters = useCallback(async () => {
    try {
      if (mode === "demo") return await loadDemoAdapters({ switchToLive: () => choose("live") });
      if (!me.data) throw new Error("Your account is still loading.");
      return await loadLiveAdapters({ me: me.data, switchToDemo: () => choose("demo") });
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Your records could not be loaded.");
      throw err;
    }
  }, [mode, me.data, choose]);

  if (failure)
    return (
      <div role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#fbfcfa" }}>
        <div style={{ maxWidth: 440, background: "#fff", border: "1px solid #e5e9e5", borderRadius: 16, padding: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.04em", fontWeight: 400, color: "#a43b32" }}>COULD NOT LOAD</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 20, margin: "6px 0 8px" }}>Your records could not be loaded</h1>
          <p style={{ color: "#4c564e", fontSize: 14, lineHeight: 1.55, margin: 0 }}>{failure} Nothing was changed.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => { setFailure(null); setMode(mode); window.location.reload(); }} style={{ border: 0, background: "#1f6c49", color: "#fff", borderRadius: 11, padding: "10px 14px", fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>
              Try again
            </button>
            {mode === "live" && (
              <button type="button" onClick={() => choose("demo")} style={{ border: "1px solid #e5e9e5", background: "#fff", borderRadius: 11, padding: "10px 14px", fontWeight: 600, color: "#4c564e" }}>
                Open the demo instead
              </button>
            )}
          </div>
        </div>
      </div>
    );

  return (
    <>
      {mode === "demo" && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 10, transform: "translateX(-50%)", zIndex: 60, background: "#18231c", color: "#fff", borderRadius: 99, padding: "6px 12px", fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 600, display: "flex", gap: 10, alignItems: "center" }}>
          Demo — fictional records in this browser only
          <button type="button" onClick={() => choose("live")} style={{ border: 0, background: "#fff", color: "#18231c", borderRadius: 99, padding: "3px 9px", fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 600 }}>
            Back to your brokerage
          </button>
        </div>
      )}
      <AsapComponent key={`${mode}:${orgKey}`} loadAdapters={loadAdapters} shell={controller} orgKey={orgKey} />
    </>
  );
}
