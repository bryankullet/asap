/**
 * End-to-end entry: the approved interface in the adaptive shell (D-155), in live mode, against the
 * real API (scripts/test-e2e.sh).
 *
 * Test-only and never bundled (vite builds index.html, not this). The only stand-in is the
 * session: the signed-in person's token is handed in by the test runner instead of coming from
 * Supabase Auth. Everything the page shows is read from the API and the disposable database. The
 * shell's addresses live in the hash here (#/ask/…, #/s/client?…) so a reload of this test page
 * reopens the same surface exactly as the real app's path does.
 */
import "../src/styles/index.css";
import { RouterProvider, createHashHistory, createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { supabase } from "../src/lib/supabase.js";
import { api } from "../src/lib/api.js";
import Component from "../src/asap/logic.js";
import "../src/asap/asap.css";
import { AdaptiveShell } from "../src/asap/shell/AdaptiveShell.js";
import type { ShellController } from "../src/asap/shell/types.js";
import { loadLiveAdapters } from "../src/asap/live.js";

const token = (window as unknown as { __E2E_TOKEN?: string }).__E2E_TOKEN ?? null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only override of the session lookup
(supabase.auth as any).getSession = async () => ({ data: { session: token ? { access_token: token } : null } });

const me = await api.me();
const orgKey = `${me.active_organization?.id ?? "none"}:${me.user.id}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the logic class is untyped JS
const C: any = Component;
C.prototype.render = function () {
  return createElement(AdaptiveShell, { logic: this, v: { ...this.props, ...this.renderVals() }, controller: this.props.shell, orgKey });
};
function App() {
  const controller = useRef<ShellController>({ open: () => {}, home: () => {}, search: () => {}, ensureConversation: async () => null }).current;
  return <C loadAdapters={() => loadLiveAdapters({ me, switchToDemo: () => {} })} shell={controller} orgKey={orgKey} />;
}
const root = createRootRoute({ component: () => <><App /><Outlet /></> });
const router = createRouter({
  routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component: () => null }),
    createRoute({ getParentRoute: () => root, path: "$", component: () => null }),
  ]),
  history: createHashHistory(),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test-built router instance
createRoot(document.getElementById("root")!).render(<RouterProvider router={router as any} />);
