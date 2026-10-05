import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";

/**
 * Recording that something happened, so the rest of the system can react to it.
 *
 * **Semantic events, not table events** (§29). `quote.received`, never `insurer_quotes.insert`: a
 * consumer should not have to know which table moved, and the name should survive a schema change
 * that means the same thing.
 *
 * Emitting is deliberately separate from dispatching. This writes one row and returns; the worker
 * tier picks it up, runs the consumers and records what each one did. So a business action never
 * waits on an automation, and an automation that fails never rolls back the action that triggered
 * it — the two are related by a row, not by a call stack.
 *
 * **An event is never the system of record.** It says something happened and points at the record
 * it happened to; what is true lives on that record.
 */

export type EmittedEvent = {
  organizationId: string;
  /** The semantic name. Matches `AutomationTrigger` where an automation can wait for it. */
  eventType: string;
  entityType: string;
  entityId: string;
  actor: "user" | "ai" | "automation" | "system";
  actorUserId: string | null;
  /**
   * What a consumer needs in order to decide, and nothing more. Never a document's contents, never
   * a credential, and never a figure a consumer should read from the record itself.
   */
  payload?: Record<string, unknown>;
  /**
   * Names the fact, so it is recorded once however many times it is reported (0066, D-140): the
   * record that became true, or the item and date of an overdue check. Omitted for events that may
   * legitimately repeat.
   */
  dedupeKey?: string;
};

/**
 * Write the event.
 *
 * Never throws. An event that could not be recorded is a missed automation, which is worth a loud
 * log — but the business action it followed has already happened, and must not be undone because
 * the dispatch log was unavailable.
 */
export async function emitEvent(
  db: SupabaseClient,
  logger: Logger | null,
  event: EmittedEvent,
): Promise<"emitted" | "already" | "failed"> {
  const { error } = await db.from("events").insert({
    organization_id: event.organizationId,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId,
    actor: event.actor,
    actor_user_id: event.actorUserId,
    payload: event.payload ?? {},
    ...(event.dedupeKey ? { dedupe_key: event.dedupeKey } : {}),
  });
  // The same fact reported again: already recorded, which is the point of the key.
  if (error && error.code === "23505" && event.dedupeKey) return "already";
  if (error) {
    logger?.error(
      { event: event.eventType, entity: event.entityType, code: error.code },
      "event not recorded: anything waiting for it will not fire",
    );
    return "failed";
  }
  return "emitted";
}
