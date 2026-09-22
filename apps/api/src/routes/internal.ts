import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { fireAutomationsFor } from "../automations/runner.js";
import { extractDocument } from "../documents/extraction.js";
import { AlreadySyncing, syncMailbox } from "../mailbox/sync.js";
import type { MailboxProvider, SyncLimits } from "../mailbox/types.js";
import type { Extractor } from "../documents/extractor.js";
import { HttpError, sendError } from "../errors.js";

/**
 * The surface the worker tier calls, and nothing else.
 *
 * Workers read tenant data as `asap_worker` under RLS and hold no service key — that is stated in
 * their own environment schema and it is the right constraint. But the things that must happen
 * when an event lands are engine work: they are written here, tested here, and there must not be a
 * second implementation of them behind a different role. So the worker owns the scheduling —
 * claiming an event, ordering the work, recording what each consumer did — and calls this to run
 * the consumer itself.
 *
 * **This is not reachable from a browser.** It is mounted outside the session guard and demands a
 * shared secret that only the API and the worker hold. The organization is read from the event
 * row, never from the caller: a caller names an event, and the event says whose it is.
 */
export function internalRoutes(deps: {
  logger: Logger;
  service: () => SupabaseClient;
  internalKey: string;
  /** Null on a deployment with no extraction service: documents are filed, and say they are unread. */
  extractor: Extractor | null;
  bucket: string;
  /**
   * The mailbox adapters and how much one pass may read.
   *
   * Absent on a deployment with no provider credentials, in which case a sync request is skipped
   * with that said out loud — rather than failing, which would look like a broken mailbox.
   */
  mailbox?:
    | {
        providers: Partial<Record<"gmail" | "microsoft", MailboxProvider>>;
        limits: SyncLimits;
        encryptionKey: string;
      }
    | undefined;
}) {
  const app = new Hono();

  app.use("/internal/*", async (c, next) => {
    const offered = c.req.header("x-asap-internal-key");
    /*
     * Length-independent comparison. The key is a server secret and the timing of a mismatch
     * should not say how much of it was right.
     */
    if (!offered || !safeEqual(offered, deps.internalKey)) {
      throw new HttpError(401, "not_internal", "This endpoint is not reachable with a session.");
    }
    await next();
  });

  /**
   * Run the consumers for one event.
   *
   * Returns what each consumer did so the worker can record it. It does not mark the event
   * processed: that is the worker's bookkeeping, and doing it in both places is how an event ends
   * up half-delivered with nobody able to say which half.
   */
  app.post("/internal/events/:id/dispatch", async (c) => {
    const id = c.req.param("id");
    const db = deps.service();

    const { data, error } = await db
      .from("events")
      .select("id, organization_id, event_type, entity_type, entity_id, payload")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      deps.logger.error({ eventId: id, code: error.code }, "could not read the event to dispatch");
      throw new HttpError(503, "event_unreadable", "The event could not be read.");
    }
    if (!data) throw new HttpError(404, "not_found", "No event with that id");

    const event = data as {
      id: string;
      organization_id: string;
      event_type: string;
      entity_type: string | null;
      entity_id: string | null;
      payload: Record<string, unknown> | null;
    };

    const results: { consumer: string; result: "success" | "failure" | "skipped"; detail: string }[] =
      [];

    /*
     * Reading a filed document. This is the step that makes "ASAP reads it next" — which the
     * upload screen says — true. What it writes is proposed, never known: a person accepts each
     * field before any of it counts.
     */
    if (event.event_type === "document.received" && event.entity_type === "document" && event.entity_id) {
      const outcome = await extractDocument(
        db,
        deps.logger,
        deps.extractor,
        deps.bucket,
        event.entity_id,
      );
      results.push({
        consumer: "extraction",
        result:
          outcome.state === "extracted"
            ? "success"
            : outcome.state === "skipped"
              ? "skipped"
              : "failure",
        detail:
          outcome.state === "extracted"
            ? `${outcome.pages} pages read, ${outcome.fields} values proposed for review.`
            : outcome.reason,
      });
    }

    /*
     * Reading a mailbox. The pass is bounded, idempotent on the provider's own identities, and
     * writes its own run row — so "Syncing" is a fact, a failure says what it managed to save,
     * and a re-delivered event cannot read the same mail twice.
     */
    if (event.event_type === "mailbox.sync_requested" && event.entity_type === "mailbox" && event.entity_id) {
      if (!deps.mailbox) {
        results.push({
          consumer: "mailbox_sync",
          result: "skipped",
          detail: "This deployment has no mailbox provider configured, so nothing reads a mailbox.",
        });
      } else {
        const box = await db
          .from("mailboxes")
          .select("provider")
          .eq("id", event.entity_id)
          .maybeSingle();
        const providerId = (box.data as { provider: "gmail" | "microsoft" } | null)?.provider;
        const adapter = providerId ? deps.mailbox.providers[providerId] : undefined;
        if (!adapter) {
          results.push({
            consumer: "mailbox_sync",
            result: "skipped",
            detail: "No adapter is configured for that mailbox's provider.",
          });
        } else {
          const trigger =
            event.payload?.["trigger"] === "person"
              ? "person"
              : event.payload?.["trigger"] === "schedule"
                ? "schedule"
                : "first_connection";
          try {
            const outcome = await syncMailbox(
              {
                db,
                logger: deps.logger,
                provider: adapter,
                encryptionKey: deps.mailbox.encryptionKey,
                bucket: deps.bucket,
                limits: deps.mailbox.limits,
              },
              { mailboxId: event.entity_id, trigger },
            );
            results.push({
              consumer: "mailbox_sync",
              result: outcome.state === "succeeded" ? "success" : "failure",
              detail:
                outcome.state === "succeeded"
                  ? `${outcome.messagesSaved} messages and ${outcome.attachmentsSaved} attachments saved${outcome.moreWaiting ? "; more is waiting" : ""}${outcome.checkpointExpired ? "; the provider's checkpoint had expired, so the recent window was re-read" : ""}.`
                  : (outcome.error ?? "The mailbox could not be read."),
            });
          } catch (e) {
            /*
             * A pass already going is the right answer, not a failure: the thing the event asked
             * for is happening. Marking it failed would have the dispatcher retry into the same
             * refusal until it gave up.
             */
            results.push({
              consumer: "mailbox_sync",
              result: e instanceof AlreadySyncing ? "skipped" : "failure",
              detail:
                e instanceof AlreadySyncing
                  ? "A pass is already going for this mailbox."
                  : ((e as { message?: string } | null)?.message ?? "The mailbox could not be read."),
            });
          }
        }
      }
    }

    /*
     * Automations. They hang off a work item, so an event about something else — a document not
     * yet attached to any work — has nothing for them to run against and is skipped rather than
     * failed. "Skipped" and "failed" are different facts and the history shows which.
     */
    const workItemId =
      event.entity_type === "work_item"
        ? event.entity_id
        : typeof event.payload?.["workItemId"] === "string"
          ? (event.payload["workItemId"] as string)
          : null;

    if (!workItemId) {
      results.push({
        consumer: "automations",
        result: "skipped",
        detail: "The event does not belong to a piece of work, so no automation could run against it.",
      });
    } else {
      try {
        const fired = await fireAutomationsFor(db, deps.logger, {
          id: event.id,
          name: event.event_type,
          organizationId: event.organization_id,
          workItemId,
        });
        results.push({
          consumer: "automations",
          result: "success",
          detail:
            fired.length === 0
              ? "No automation is watching for this."
              : fired
                  .map((f) => `${f.outcome}${f.duplicate ? " (already handled)" : ""}`)
                  .join(", "),
        });
      } catch (e) {
        // Reported, never swallowed: an automation that did not run is invisible otherwise, and
        // §45 rule 15 does not allow a failure to disappear.
        results.push({
          consumer: "automations",
          result: "failure",
          detail: (e as { message?: string } | null)?.message ?? "The automations could not run.",
        });
      }
    }

    return c.json({ eventId: event.id, eventType: event.event_type, results });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}

/** Constant-time-ish comparison, so a mismatch does not leak where it diverged. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
