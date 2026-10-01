import type { Logger } from "pino";

/**
 * The workflow schedule (D-129). The worker owns time; the API owns the engine — as for events.
 *
 * Every tick asks the API to detect due work in every brokerage and advance every run that is due.
 * Runs are leased and their steps are written as they finish, so a tick that overlaps another, or a
 * worker that restarts mid-tick, neither repeats nor loses work: the next tick carries on.
 */
export type SweepResult = { started: number; advanced: number };

export function httpSweeper(config: { apiBaseUrl: string; internalKey: string; timeoutMs: number }): () => Promise<SweepResult> {
  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(new URL("/internal/workflows/sweep", config.apiBaseUrl), {
        method: "POST",
        headers: { "x-asap-internal-key": config.internalKey },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`the API answered ${res.status}`);
      const body = (await res.json()) as Partial<SweepResult>;
      return { started: body.started ?? 0, advanced: body.advanced ?? 0 };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** One tick. Never throws: a failed sweep is logged loudly and the next tick tries again. */
export async function sweepOnce(sweep: () => Promise<SweepResult>, logger: Logger): Promise<SweepResult | null> {
  try {
    const out = await sweep();
    if (out.started || out.advanced) logger.info(out, "workflow sweep");
    return out;
  } catch (e) {
    logger.error({ err: e }, "the workflow sweep failed; the next tick tries again");
    return null;
  }
}
