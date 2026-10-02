export declare const MUTATION_TIMEOUT_MS: number;
export declare const REFRESH_WAIT_MS: number;
export declare class MutationTimeout extends Error {
  ms: number;
  constructor(ms: number);
}
export type MutationStatus = "succeeded" | "blocked" | "failed";
export type MutationResult = { ok: boolean; status: MutationStatus; error?: string; timeout?: boolean; [k: string]: unknown };
export declare function withTimeout<T>(promise: Promise<T> | T, ms: number): Promise<T>;
export declare function createRefresher<T>(
  load: () => Promise<T>,
  apply: (loaded: T) => void,
  opts?: { waitMs?: number },
): {
  status: { stale: boolean; lastError: string | null; refreshedAt: string | null };
  refresh(): Promise<void>;
  refreshFully(): Promise<void>;
  onChange(fn: (status: unknown) => void): () => void;
};
export declare function lifecycleOf(res: unknown): MutationStatus;
export declare function runMutation(
  start: () => Promise<unknown> | unknown,
  opts?: { timeoutMs?: number; describe?: (e: unknown) => string },
): Promise<MutationResult>;
