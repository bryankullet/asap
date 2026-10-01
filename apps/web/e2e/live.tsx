/**
 * End-to-end entry: the approved interface in live mode against the real API (scripts/test-e2e.sh).
 *
 * Test-only and never bundled (vite builds index.html, not this). The only stand-in is the
 * session: the signed-in person's token is handed in by the test runner instead of coming from
 * Supabase Auth. Everything the page shows is read from the API and the disposable database.
 */
import "../src/styles/index.css";
import { createRoot } from "react-dom/client";
import { supabase } from "../src/lib/supabase.js";
import { api } from "../src/lib/api.js";
import Component from "../src/asap/generated/logic.gen.js";
import { renderTemplate } from "../src/asap/generated/template.gen.js";
import "../src/asap/generated/asap.css";
import { loadLiveAdapters } from "../src/asap/live.js";

const token = (window as unknown as { __E2E_TOKEN?: string }).__E2E_TOKEN ?? null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only override of the session lookup
(supabase.auth as any).getSession = async () => ({ data: { session: token ? { access_token: token } : null } });

const me = await api.me();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated component is untyped
const C: any = Component;
C.prototype.render = function () {
  return renderTemplate({ ...this.props, ...this.renderVals() });
};
createRoot(document.getElementById("root")!).render(<C loadAdapters={() => loadLiveAdapters({ me, switchToDemo: () => {} })} />);
