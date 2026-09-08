import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

/**
 * Registers this process's API key with the database (0025). Only the sha256 leaves the process;
 * the key itself is never logged, never written, never returned. Runs before runs_recover and
 * before the first request, because every engine write depends on it.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export async function registerApiKey(
  service: SupabaseClient,
  key: string,
  logger: Logger,
): Promise<"registered" | "already_active" | "failed"> {
  const { data, error } = await service.rpc("api_key_register", { p_key_hash: hashApiKey(key) });
  if (error) {
    logger.error(
      { err: { code: error.code, message: error.message } },
      "api key registration failed; engine writes will be refused",
    );
    return "failed";
  }
  const registered = data === true;
  logger.info(
    { registered },
    registered ? "api key registered (previous keys revoked)" : "api key already active",
  );
  return registered ? "registered" : "already_active";
}
