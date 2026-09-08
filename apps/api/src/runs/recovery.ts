import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

/**
 * Runs execute in-process (Part 8). A process that dies mid-run leaves the run `working` with
 * nobody driving it. Each run records the token of the process that started it; on boot the new
 * process asks the database to end every run started under another token as could_not_finish,
 * which creates or moves the work item to needs_you in the same transaction (0024, runs_recover).
 * This is the one admin path that uses the service client: there is no user session at boot.
 */
export function newBootToken(): string {
  return `${process.pid}-${randomUUID()}`;
}

export async function recoverOrphanedRuns(
  service: SupabaseClient,
  bootToken: string,
  logger: Logger,
): Promise<string[]> {
  const { data, error } = await service.rpc("runs_recover", { p_boot_token: bootToken });
  if (error) {
    logger.error(
      { err: error },
      "run recovery failed; runs from a previous process may still show as working",
    );
    return [];
  }
  const ids = (data ?? []) as string[];
  if (ids.length > 0)
    logger.warn(
      { run_ids: ids, count: ids.length },
      "recovered runs left working by a previous process",
    );
  else logger.info("no orphaned runs");
  return ids;
}
