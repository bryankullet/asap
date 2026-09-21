import { useCallback, useEffect, useState } from "react";

/**
 * Open workspace tabs.
 *
 * A tab is *interface* state: which records a person happens to have open. It is not a business
 * fact, nothing else depends on it, and losing it costs a person one click — so it lives in
 * `localStorage`, which is what CLAUDE.md allows for "harmless interface preferences".
 *
 * What a tab is **not** is a handle on the record's lifecycle. Closing one closes the tab. It does
 * not delete, complete, unassign or otherwise touch the record, and nothing in this module can:
 * there is no API call in here at all. That separation is the point — a tab strip that could end a
 * renewal by being tidied up would be a trap.
 */

/**
 * What makes two tabs the same tab.
 *
 * All four parts matter. Two clients are two records, so `recordId` distinguishes them. The same
 * client opened as a client and as the subject of a renewal is two different pieces of work, so
 * `spaceType` and `recordType` distinguish those. And one record can carry more than one workflow
 * at a time — two endorsements on one policy — so `workflowId` distinguishes those.
 */
export type TabIdentity = {
  spaceType: string;
  recordType: string;
  recordId: string;
  workflowId?: string | undefined;
};

export type WorkspaceTab = TabIdentity & {
  /** What the tab strip shows above the title: "CLIENT", "RENEWAL". */
  kind: string;
  /** The record's own name, as the API gave it. Never invented here. */
  title: string;
  /** Where clicking the tab goes. */
  path: string;
  /** A personal marker, like a pin on a work item — not a state the record is in. */
  pinned: boolean;
  /** For the Recent list, and for ordering. Milliseconds. */
  openedAt: number;
  lastSeenAt: number;
};

/** The stable key for an identity. Order is fixed so the same tab always hashes the same way. */
export function tabKey(id: TabIdentity): string {
  return [id.spaceType, id.recordType, id.recordId, id.workflowId ?? ""].join("|");
}

const OPEN_KEY = "asap.workspace.tabs.v1";
const RECENT_KEY = "asap.workspace.recent.v1";
/** Enough to be useful, few enough that the strip stays readable and storage stays small. */
const MAX_OPEN = 12;
const MAX_RECENT = 20;

/**
 * Reading and writing never throw.
 *
 * Storage is absent in a private window, blocked by policy, and unavailable during a server render;
 * in every one of those the shell must still mount with no tabs rather than fail to mount.
 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* A preference that cannot be saved is not an error worth showing anyone. */
  }
}

export type WorkspaceTabs = {
  tabs: WorkspaceTab[];
  recent: WorkspaceTab[];
  /** Opens a tab, or brings the existing one forward if that identity is already open. */
  open: (tab: Omit<WorkspaceTab, "pinned" | "openedAt" | "lastSeenAt">) => void;
  /** Closes the interface tab. Touches no record. */
  close: (id: TabIdentity) => void;
  togglePin: (id: TabIdentity) => void;
  isOpen: (id: TabIdentity) => boolean;
};

export function useWorkspaceTabs(activePath: string): WorkspaceTabs {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => read<WorkspaceTab[]>(OPEN_KEY, []));
  const [recent, setRecent] = useState<WorkspaceTab[]>(() => read<WorkspaceTab[]>(RECENT_KEY, []));

  useEffect(() => write(OPEN_KEY, tabs), [tabs]);
  useEffect(() => write(RECENT_KEY, recent), [recent]);

  const open = useCallback((next: Omit<WorkspaceTab, "pinned" | "openedAt" | "lastSeenAt">) => {
    const key = tabKey(next);
    const now = Date.now();
    setTabs((current) => {
      const existing = current.find((t) => tabKey(t) === key);
      if (existing) {
        // Already open: keep its identity, its pin and the moment it was opened, and only note
        // that it has been seen again. Re-opening a tab must not look like opening a new one.
        return current.map((t) =>
          tabKey(t) === key ? { ...t, title: next.title, path: next.path, lastSeenAt: now } : t,
        );
      }
      const added: WorkspaceTab = { ...next, pinned: false, openedAt: now, lastSeenAt: now };
      const grown = [...current, added];
      if (grown.length <= MAX_OPEN) return grown;
      // Over the cap, the oldest *unpinned* tab goes. A pinned tab is never evicted to make room:
      // pinning it is the person saying they want it kept.
      const victim = grown.filter((t) => !t.pinned).sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      return victim ? grown.filter((t) => tabKey(t) !== tabKey(victim)) : grown.slice(1);
    });
    setRecent((current) => {
      const without = current.filter((t) => tabKey(t) !== key);
      return [{ ...next, pinned: false, openedAt: now, lastSeenAt: now }, ...without].slice(
        0,
        MAX_RECENT,
      );
    });
  }, []);

  const close = useCallback((id: TabIdentity) => {
    const key = tabKey(id);
    // Only the tab list changes. The record stays exactly as it was, and stays in Recent so
    // closing a tab by accident costs one click to undo.
    setTabs((current) => current.filter((t) => tabKey(t) !== key));
  }, []);

  const togglePin = useCallback((id: TabIdentity) => {
    const key = tabKey(id);
    setTabs((current) =>
      current.map((t) => (tabKey(t) === key ? { ...t, pinned: !t.pinned } : t)),
    );
  }, []);

  const isOpen = useCallback(
    (id: TabIdentity) => tabs.some((t) => tabKey(t) === tabKey(id)),
    [tabs],
  );

  // The active tab is the one whose path the router is on. Derived, never stored: a stored "active"
  // can disagree with the address bar, and then the highlighted tab is not the screen you are on.
  useEffect(() => {
    setTabs((current) =>
      current.map((t) => (t.path === activePath ? { ...t, lastSeenAt: Date.now() } : t)),
    );
  }, [activePath]);

  return { tabs, recent, open, close, togglePin, isOpen };
}
