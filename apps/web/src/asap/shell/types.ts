import type { ConversationSummary, RecentItem as Recent, RecordOpenRequest, SurfaceRef } from "@asap/schema";
import type { Ref } from "./routes.js";

export type RecentItem = Recent;

/** The small icon that tells a Recent entry's type apart — never a navigation section. */
export const KIND_ICON: Record<string, string> = {
  conversation: "✦",
  workflow: "↻",
  client: "◎",
  policy: "▤",
  claim: "⚑",
  quotation: "▱",
  document: "▧",
  comparison: "⇆",
  automation: "⌘",
  record: "•",
};

export type ShellApi = {
  sessions(q?: string): Promise<ConversationSummary[]>;
  session(id: string): Promise<ConversationSummary>;
  start(body: { text: string; scope?: { kind: "brokerage" | "client"; id: string | null }; workItemId?: string | null; spaceRef?: SurfaceRef | Ref | null }): Promise<{ conversation: ConversationSummary; reopened: boolean }>;
  update(id: string, body: { title?: string; workItemId?: string | null; spaceRef?: SurfaceRef | Ref | null }): Promise<ConversationSummary>;
  recent(): Promise<RecentItem[]>;
  recordOpen(body: RecordOpenRequest | { ref: Ref; title: string }): Promise<unknown>;
  pins(): Promise<RecentItem[]>;
  pin(body: RecordOpenRequest | { ref: Ref; title: string }): Promise<unknown>;
  unpin(key: string): Promise<unknown>;
};

export type ShellAdapters = {
  shell: ShellApi;
  supervision?: () => unknown;
  waitingDocuments?: () => string[];
  records: { actor(): { id: string; name: string }; act(a: string, p: unknown, id: string): Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }; sel: Record<string, (...a: never[]) => unknown> };
};

/** The approved interface's logic class, as the shell drives it. */
export type Logic = {
  A: ShellAdapters | undefined;
  state: { ready: boolean; ref: Ref | null; conversationId: string | null; thread: unknown[]; tick: number };
  inputRef: { current: HTMLTextAreaElement | null };
  setSurface(ref: Ref | null): void;
  openConversation(id: string | null): Promise<void>;
  clearContext(): void;
  setScope(ref: Ref | null): void;
  ask(text: string): Promise<void>;
  chatFiles(files: File[]): Promise<void>;
  act(action: string, payload: unknown, opts?: Record<string, unknown>): void;
  flash(text: string): void;
  openProfile(): void;
  bump(): void;
};

/** What the logic calls back into: every navigation goes through the address. */
export type ShellController = {
  open(ref: Ref, opts?: Record<string, unknown>): void;
  home(): void;
  search(): void;
  ensureConversation(text: string): Promise<string | null>;
  ready?(logic: Logic): void;
  /** A message left the composer: it is no longer a draft. */
  sent?(): void;
};
