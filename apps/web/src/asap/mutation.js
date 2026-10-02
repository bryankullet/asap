/**
 * One lifecycle for every write the interface makes:
 *
 *   idle → submitting → succeeded | blocked | failed
 *
 * Two rules make "Saving…" impossible to get stuck on:
 *  1. A write settles when the server answers it — never when the follow-up re-read of the
 *     brokerage's records finishes. That re-read costs many seconds; it runs in the background,
 *     coalesced, and re-renders the interface when it lands.
 *  2. Every write has a hard deadline. Past it the action reports a plain failure, keeps what the
 *     person typed, and offers a retry — which is safe, because the retry reuses the same
 *     idempotency key and the server records the action at most once.
 */

export const MUTATION_TIMEOUT_MS = 45_000;
/** How long a write waits for the re-read before settling anyway; the re-read carries on. */
export const REFRESH_WAIT_MS = 1_500;

export class MutationTimeout extends Error {
  constructor(ms) {
    super("timeout");
    this.name = "MutationTimeout";
    this.ms = ms;
  }
}

/** Resolve or reject with `promise`, or reject with MutationTimeout after `ms`. */
export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new MutationTimeout(ms)), ms);
    }),
  ]);
}

/** Resolve after `ms` with `value`, never rejecting. */
const after = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));

/**
 * A coalescing background re-read. `refresh()` starts a load (or joins the one in flight), applies
 * it when it lands, notifies listeners, and resolves after the load or `waitMs`, whichever is
 * first. It never rejects: a failed re-read keeps the records already on screen and sets `stale`.
 */
export function createRefresher(load, apply, { waitMs = REFRESH_WAIT_MS } = {}) {
  const listeners = new Set();
  let running = null;
  let again = false;
  const status = { stale: false, lastError: null, refreshedAt: null };

  const notify = () => listeners.forEach((fn) => {
    try {
      fn(status);
    } catch {
      /* a listener's failure never breaks the re-read */
    }
  });

  const run = () => {
    running = (async () => {
      try {
        const loaded = await load();
        apply(loaded);
        Object.assign(status, { stale: false, lastError: null, refreshedAt: new Date().toISOString() });
      } catch (err) {
        Object.assign(status, { stale: true, lastError: err instanceof Error ? err.message : String(err) });
      }
      notify();
    })().finally(() => {
      running = null;
      // A write that landed during this re-read asked for a fresh one: run it once more.
      if (again) {
        again = false;
        run();
      }
    });
    return running;
  };

  return {
    status,
    refresh() {
      if (running) again = true;
      const p = running ?? run();
      return Promise.race([p, after(waitMs)]);
    },
    /** Wait for the full re-read (tests, the explicit "Refresh records" link). */
    refreshFully() {
      return running ?? run();
    },
    /** Re-render without a re-read: something already on hand changed (an upload's state). */
    notify,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The status a settled result maps to. */
export function lifecycleOf(res) {
  if (!res) return "failed";
  if (res.denied || res.blocked) return "blocked";
  return res.ok ? "succeeded" : "failed";
}

/**
 * Run one write to completion: it always settles, with a status, inside the deadline. A thrown
 * error or a timeout becomes a failure that names a safe reason and says the retry is safe.
 */
export async function runMutation(start, { timeoutMs = MUTATION_TIMEOUT_MS, describe = (e) => String(e?.message ?? e) } = {}) {
  let res;
  try {
    res = await withTimeout(start(), timeoutMs);
  } catch (err) {
    res =
      err instanceof MutationTimeout
        ? {
            ok: false,
            timeout: true,
            error:
              "Your brokerage's records did not answer in time. It may or may not have been saved — retrying is safe: ASAP records the same action only once.",
          }
        : { ok: false, error: describe(err).replace(/\.?\s*$/, ".") + " Nothing was changed — you can retry." };
  }
  if (!res || typeof res !== "object") res = { ok: false, error: "That could not be completed. Nothing was changed — you can retry." };
  return { ...res, status: lifecycleOf(res) };
}
