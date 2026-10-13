/**
 * The UI Lab (D-156): the Living surface at every renewal stage, for design review and screenshots.
 *
 * Development only and never bundled — vite builds index.html, not this page. The surfaces are the
 * server composer's own output for one fictional renewal (living-lab.json, kept equal to the composer
 * by apps/api/test/living-lab.test.ts), so what renders here is what a brokerage's records produce.
 * Fictional records live only here and in demo mode (D-115).
 */
import "../src/styles/index.css";
import type { LivingSurface as Surface } from "@asap/schema";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LivingSurface } from "../src/asap/living/LivingSurface.js";
import "../src/asap/shell/shell.css";
import lab from "./living-lab.json";

const scenarios = lab as unknown as { key: string; label: string; surface: Surface }[];
const current = () => new URLSearchParams(location.hash.slice(1)).get("stage") ?? scenarios[0]!.key;

function Lab() {
  const [key, setKey] = useState(current);
  useEffect(() => {
    const on = () => setKey(current());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const s = scenarios.find((x) => x.key === key) ?? scenarios[0]!;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "var(--color-wash)" }}>
      <nav aria-label="Lab scenarios" style={{ display: "flex", gap: 6, padding: "10px 16px", overflowX: "auto", borderBottom: "1px solid var(--color-line)", background: "#fff" }}>
        <strong style={{ fontFamily: "var(--font-display)", marginRight: 8, whiteSpace: "nowrap" }}>UI Lab</strong>
        {scenarios.map((x) => (
          <button key={x.key} type="button" className={x.key === s.key ? "lv-btn lv-btn-primary" : "lv-btn"} onClick={() => { location.hash = `stage=${x.key}`; }} style={{ whiteSpace: "nowrap" }}>{x.label}</button>
        ))}
      </nav>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <LivingSurface key={s.key} workItemId={s.surface.subject.id} runId="lab-run" load={async () => s.surface} onOpen={() => {}} onAsk={() => {}} />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Lab />);
