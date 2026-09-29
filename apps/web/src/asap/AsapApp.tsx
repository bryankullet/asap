import { useCallback, useEffect, useState } from "react";
import { useMe } from "../lib/me.js";
import Component from "./generated/logic.gen.js";
import { renderTemplate } from "./generated/template.gen.js";
import "./generated/asap.css";
import { loadDemoAdapters } from "./demo.js";
import { loadLiveAdapters } from "./live.js";

/*
 * The approved interface's logic is an ordinary React class; its markup is compiled to a render
 * function. Rendering is exactly what the approved runtime does: the template over the component's
 * props merged with its `renderVals()`.
 */
type Logic = { props: Record<string, unknown>; renderVals(): Record<string, unknown>; forceUpdate(): void };
const proto = (Component as unknown as { prototype: Logic & { render(): unknown } }).prototype;
proto.render = function render(this: Logic) {
  return renderTemplate({ ...this.props, ...this.renderVals() });
};
const AsapComponent = Component as unknown as React.ComponentType<{ loadAdapters: () => Promise<unknown> }>;

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

  const choose = useCallback((next: Mode) => {
    try {
      sessionStorage.setItem(MODE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    setFailure(null);
    setMode(next);
  }, []);

  useEffect(() => {
    document.title = mode === "demo" ? "ASAP — demo" : "ASAP";
  }, [mode]);

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
          <div style={{ fontSize: 10.5, letterSpacing: ".12em", fontWeight: 700, color: "#a43b32" }}>COULD NOT LOAD</div>
          <h1 style={{ fontFamily: "Manrope, sans-serif", fontSize: 21, margin: "6px 0 8px" }}>Your records could not be loaded</h1>
          <p style={{ color: "#4c564e", fontSize: 14, lineHeight: 1.55, margin: 0 }}>{failure} Nothing was changed.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => { setFailure(null); setMode(mode); window.location.reload(); }} style={{ border: 0, background: "#1f6c49", color: "#fff", borderRadius: 11, padding: "10px 14px", fontWeight: 700 }}>
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
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 10, transform: "translateX(-50%)", zIndex: 60, background: "#18231c", color: "#fff", borderRadius: 99, padding: "6px 12px", fontSize: 12, fontWeight: 700, display: "flex", gap: 10, alignItems: "center" }}>
          Demo — fictional records in this browser only
          <button type="button" onClick={() => choose("live")} style={{ border: 0, background: "#fff", color: "#18231c", borderRadius: 99, padding: "3px 9px", fontSize: 12, fontWeight: 700 }}>
            Back to your brokerage
          </button>
        </div>
      )}
      <AsapComponent key={mode} loadAdapters={loadAdapters} />
    </>
  );
}
