type Ref = Record<string, unknown> & { ws: string };
type Action = { label: string; ref: Ref };
export type WorkRow = { id: string; view: string; title: string; client: { id: string; name: string } | null; kind: string; statusText: string; owner: string | null; party: string | null; when: string | null; urgency: "high" | "medium" | "low" | "none"; action: Action; sortAt: string };
export function runRef(r: unknown): Ref;
export function workInbox(o: { supervision: unknown; meId: string | null }): { views: { key: string; label: string; rows: WorkRow[] }[] };
export function homeSurface(o: { supervision: unknown; meId: string | null; waitingDocuments?: string[]; automationFailures?: { id: string; name: string; reason?: string }[] }): {
  attention: { kind: string; title: string; why: string; action: Action; weight: number }[];
  more: number;
  handling: { title: string; doing: string; record: string | null; state: string; next: string | null; safe: boolean; ref: Ref }[];
  firstUse: boolean;
};
type Card = { id: string; name: string; state: string; tone: string; lines: string[]; next: string; ref: Ref; canPause: boolean };
export function automationsBoard(o: { supervision: unknown }): { workflows: Card[]; standing: (Card & { on: boolean; failure: { id: string; name: string; reason?: string } | null })[] };
export function activityLog(o: { filter?: Record<string, string> }): { id: string; at: string; when: string; sentence: string; client: { id: string; name: string } | null; asap: boolean; approval: boolean; external: boolean; workflow: boolean; ref: Ref | null }[];
