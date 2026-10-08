/**
 * Demo mode: the approved interface over its own fictional records, kept only in this browser.
 * Reached only after signing in, and labelled as a demo wherever it can be mistaken for real.
 */
import * as A from "./engine/adapters.js";
import * as S from "./engine/store.js";
import { supabase } from "../lib/supabase.js";
import { conversationPurpose, deriveConversationTitle, kindOfRef, refKey, CONVERSATION_STATUS_LABEL } from "@asap/schema";

/**
 * Demo sessions, Recent and Pins: fictional, in this page only, gone on reload — like every demo
 * record (D-115). Live mode keeps all three on the server (D-155).
 */
function demoShell() {
  const sessions = new Map();
  const threads = new Map();
  let recent = [];
  const pins = new Map();
  const summary = (c) => ({ ...c, status: (threads.get(c.id) || []).length > 1 ? "completed" : "draft", statusLabel: CONVERSATION_STATUS_LABEL[(threads.get(c.id) || []).length > 1 ? "completed" : "draft"] });
  const entry = (b) => (b.conversationId ? { key: "conversation:" + b.conversationId, kind: "conversation", ref: null, conversationId: b.conversationId, title: sessions.get(b.conversationId)?.title || "Conversation" } : { key: refKey(b.ref), kind: kindOfRef(b.ref), ref: b.ref, conversationId: null, title: b.title });
  let current = null;
  return {
    sessions: async (q) => [...sessions.values()].map(summary).filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase())).reverse(),
    session: async (id) => summary(sessions.get(id)),
    start: async (body) => {
      const purpose = body.purpose || conversationPurpose(body.text);
      const same = [...sessions.values()].find((c) => body.workItemId ? c.workItem?.id === body.workItemId : false);
      if (same) return { conversation: summary(same), reopened: true };
      const now = new Date().toISOString();
      const c = { id: crypto.randomUUID(), title: deriveConversationTitle({ text: body.text, purpose, brokerageName: "ASAP Brokers" }), titleSource: "derived", purpose, client: null, workItem: body.workItemId ? { id: body.workItemId, title: "", kind: "" } : null, runId: null, spaceRef: body.spaceRef || null, scope: body.scope || { kind: "brokerage", id: null }, createdAt: now, updatedAt: now, lastActivityAt: now };
      sessions.set(c.id, c);
      return { conversation: summary(c), reopened: false };
    },
    update: async (id, body) => {
      const c = sessions.get(id);
      if (body.title) Object.assign(c, { title: body.title, titleSource: "person" });
      if (body.spaceRef !== undefined) c.spaceRef = body.spaceRef;
      return summary(c);
    },
    recent: async () => recent.map((r) => ({ ...r, title: r.conversationId ? sessions.get(r.conversationId)?.title || r.title : r.title, pinned: pins.has(r.key) })),
    recordOpen: async (b) => {
      const e = entry(b);
      recent = [{ ...e, openedAt: new Date().toISOString() }, ...recent.filter((r) => r.key !== e.key)].slice(0, 40);
      return { key: e.key };
    },
    pins: async () => [...pins.values()],
    pin: async (b) => { const e = entry(b); pins.set(e.key, { ...e, openedAt: new Date().toISOString(), pinned: true }); return { key: e.key, pinned: true }; },
    unpin: async (key) => { pins.delete(key); return { key, pinned: false }; },
    async open(id) { current = id; return threads.get(id) || []; },
    currentId: () => current,
    keep: (id, thread) => threads.set(id, thread),
  };
}

export async function loadDemoAdapters({ switchToLive }) {
  S.useBackend(null);
  return {
    ...A,
    greetingChips: ["What needs attention today?", "Open Acme Manufacturing", "Is KDN 482Q covered right now?"],
    onChange: () => {},
    supervision: () => null,
    waitingDocuments: () => [],
    shell: demoShell(),
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
