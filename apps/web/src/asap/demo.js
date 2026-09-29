/**
 * Demo mode: the approved interface over its own fictional records, kept only in this browser.
 * Reached only after signing in, and labelled as a demo wherever it can be mistaken for real.
 */
import * as A from "./engine/adapters.js";
import * as S from "./engine/store.js";
import { supabase } from "../lib/supabase.js";

export async function loadDemoAdapters({ switchToLive }) {
  S.useBackend(null);
  return {
    ...A,
    greetingChips: ["What needs attention today?", "Open Acme Manufacturing", "Is KDN 482Q covered right now?"],
    onChange: () => {},
    records: {
      ...A.records,
      demo: true,
      modeLinks: [
        { title: "Back to your brokerage", note: "Leave the demo and open your real records", go: switchToLive },
        { title: "Sign out", note: "End this session", go: () => void supabase.auth.signOut().then(() => window.location.assign("/sign-in")) },
      ],
    },
  };
}
