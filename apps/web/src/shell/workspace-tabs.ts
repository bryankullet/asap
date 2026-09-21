import { useCallback, useEffect, useSyncExternalStore } from "react";

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
 *
 * **One store, not one per caller.** The tab strip lives in the shell and the tabs are opened by
 * the screens, which are different components — so this was two independent pieces of `useState`
 * and opening a Space from a screen never reached the strip above it. The state is a module-level
 * store read through `useSyncExternalStore`: every caller sees the same tabs, and a screen that
 * opens one is the same act as the strip showing it.
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

/**
 * The store itself. Module-level, so every component that asks gets the same answer.
 *
 * `localStorage` is read once, on first use, and written on every change: the browser is where
 * this belongs and where it survives a reload, but it is not the source components read from —
 * two components reading storage independently is how they drift apart.
 */
type TabState = { tabs: WorkspaceTab[]; recent: WorkspaceTab[] };

let state: TabState | null = null;
const listeners = new Set<() => void>();

function current(): TabState {
  state ??= {
    tabs: read<WorkspaceTab[]>(OPEN_KEY, []),
    recent: read<WorkspaceTab[]>(RECENT_KEY, []),
  };
  return state;
}

function commit(next: TabState): void {
  state = next;
  write(OPEN_KEY, next.tabs);
  write(RECENT_KEY, next.recent);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Forget everything, for tests.
 *
 * A module-level store outlives a render, so without this one test's tabs would arrive in the
 * next one. Production never calls it: closing a tab is `close`, and there is no "clear all".
 */
export function resetWorkspaceTabs(): void {
  state = null;
  for (const listener of listeners) listener();
}

/** Opens a tab, or brings the existing one forward if that identity is already open. */
function openTab(next: Omit<WorkspaceTab, "pinned" | "openedAt" | "lastSeenAt">): void {
  const key = tabKey(next);
  const now = Date.now();
  const { tabs, recent } = current();

  const existing = tabs.find((t) => tabKey(t) === key);
  let nextTabs: WorkspaceTab[];
  if (existing) {
    // Already open: keep its identity, its pin and the moment it was opened, and only note that
    // it has been seen again. Re-opening a tab must not look like opening a new one.
    nextTabs = tabs.map((t) =>
      tabKey(t) === key ? { ...t, title: next.title, path: next.path, lastSeenAt: now } : t,
    );
  } else {
    const added: WorkspaceTab = { ...next, pinned: false, openedAt: now, lastSeenAt: now };
    const grown = [...tabs, added];
    if (grown.length <= MAX_OPEN) {
      nextTabs = grown;
    } else {
      // Over the cap, the oldest *unpinned* tab goes. A pinned tab is never evicted to make room:
      // pinning it is the person saying they want it kept.
      const victim = grown.filter((t) => !t.pinned).sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
      nextTabs = victim ? grown.filter((t) => tabKey(t) !== tabKey(victim)) : grown.slice(1);
    }
  }

  const entry: WorkspaceTab = { ...next, pinned: false, openedAt: now, lastSeenAt: now };
  const nextRecent = [entry, ...recent.filter((t) => tabKey(t) !== key)].slice(0, MAX_RECENT);

  // Nothing changed: re-opening the tab you are already on must not re-render the whole shell.
  if (existing && sameTabs(tabs, nextTabs) && sameTabs(recent, nextRecent)) return;
  commit({ tabs: nextTabs, recent: nextRecent });
}

/** Same tabs, same order, same titles — the comparison that decides whether to notify. */
function sameTabs(a: WorkspaceTab[], b: WorkspaceTab[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const other = b[i]!;
    return tabKey(t) === tabKey(other) && t.title === other.title && t.pinned === other.pinned;
  });
}

export function useWorkspaceTabs(activePath: string): WorkspaceTabs {
  const { tabs, recent } = useSyncExternalStore(subscribe, current, current);

  const open = useCallback(openTab, []);

  const close = useCallback((id: TabIdentity) => {
    const key = tabKey(id);
    // Only the tab list changes. The record stays exactly as it was, and stays in Recent so
    // closing a tab by accident costs one click to undo.
    const now = current();
    commit({ ...now, tabs: now.tabs.filter((t) => tabKey(t) !== key) });
  }, []);

  const togglePin = useCallback((id: TabIdentity) => {
    const key = tabKey(id);
    const now = current();
    commit({
      ...now,
      tabs: now.tabs.map((t) => (tabKey(t) === key ? { ...t, pinned: !t.pinned } : t)),
    });
  }, []);

  const isOpen = useCallback(
    (id: TabIdentity) => tabs.some((t) => tabKey(t) === tabKey(id)),
    [tabs],
  );

  // The active tab is the one whose path the router is on. Derived, never stored: a stored "active"
  // can disagree with the address bar, and then the highlighted tab is not the screen you are on.
  useEffect(() => {
    const now = current();
    if (!now.tabs.some((t) => t.path === activePath)) return;
    commit({
      ...now,
      tabs: now.tabs.map((t) => (t.path === activePath ? { ...t, lastSeenAt: Date.now() } : t)),
    });
  }, [activePath]);

  return { tabs, recent, open, close, togglePin, isOpen };
}
