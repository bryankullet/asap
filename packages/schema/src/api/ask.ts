import { z } from "zod";
import { UiIntent } from "../intent.js";
import { uuidSchema } from "./common.js";

/**
 * `GET /ask?q=` — Phase 1 Ask only searches (UI Build Spec v1 Part 12). The response is still a
 * UiIntent, so the surface does not change when a model sits behind it in Phase 2: today the
 * intent is computed deterministically from the result count.
 */
export const askQuerySchema = z.object({ q: z.string().trim().min(1).max(200) });
export type AskQuery = z.infer<typeof askQuerySchema>;

export const askResultSchema = z.object({
  id: uuidSchema,
  kind: z.literal("work_item"),
  title: z.string(),
  /** Route the result opens. Always a record route; never markup. */
  href: z.string().regex(/^\/r\/[0-9a-f-]{36}$/),
});
export type AskResult = z.infer<typeof askResultSchema>;

export const askResponseSchema = z.object({
  intent: UiIntent,
  results: z.array(askResultSchema).max(20),
  /** Deterministic in Phase 1; a model id once one is decided (spec Part 13 item 6). */
  source: z.literal("search"),
});
export type AskResponse = z.infer<typeof askResponseSchema>;
