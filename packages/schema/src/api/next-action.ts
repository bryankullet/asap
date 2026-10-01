import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * What must happen next on a piece of work — derived by the server from the record's own state,
 * never written by a person as free text and never by the model.
 *
 * One shape, read by Today, Work, Ask and the record's Space, so the four cannot contradict each
 * other. The server also writes it onto the work item (work_item_set_state, 0060), which is how
 * lists that only read work items see the same answer.
 */
export const nextActionSchema = z.object({
  /** In the broker's words: "Deliver the approved request to CIC and record how". */
  what: z.string().min(1).max(300),
  /** Who holds it: a person in the brokerage ("you" when it is the viewer) or an outside party. */
  holder: z.enum(["brokerage", "outside_party", "nobody"]),
  /** The outside party holding it, when holder is outside_party: "CIC General Insurance". */
  party: z.string().nullable(),
  /** Since when that party has held it. */
  since: z.string().nullable(),
  /** What is still missing before the work can move, in plain words. */
  missing: z.array(z.string()),
  /** When to look again: a due date or a next check. */
  checkAt: z.string().nullable(),
  /** Why it matters, in one sentence. */
  why: z.string().max(400),
  /** The record it belongs to. */
  record: z.object({ type: z.enum(["opportunity", "claim", "policy", "document", "work_item"]), id: uuidSchema, label: z.string() }),
  /**
   * The action the person can take now, as a server action name the Space and Ask both call —
   * or null when the next move is waiting on someone else.
   */
  action: z.object({ name: z.string(), label: z.string(), targetId: uuidSchema.nullable() }).nullable(),
  /** The workflow stage, for the status layer — never shown as raw text. */
  stage: z.string(),
});
export type NextAction = z.infer<typeof nextActionSchema>;
