import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * Draft and send — UI Build Spec v1 Part 7.
 *
 * `copiedAt` advances nothing. `sentAt` may only exist together with `sentEvidence`; the refinement
 * below and the 0023 row constraint both refuse anything else, so no code path can set one
 * without the other. Nothing in ASAP sends this; a person does, and then records that they did.
 */
const isoDate = z.string().datetime({ offset: true });

export const DraftRow = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    work_item_id: uuidSchema,
    step_id: z.string().min(1),
    to_address: z.string(),
    subject: z.string(),
    body: z.string(),
    copied_at: isoDate.nullable(),
    sent_at: isoDate.nullable(),
    sent_evidence: z.string().nullable(),
    /** Set when the person recorded a send whose outcome they could not confirm (Part 7, last rule). */
    outcome_unknown: z.boolean(),
    created_by: uuidSchema.nullable(),
    created_at: isoDate,
    updated_at: isoDate,
  })
  .refine((d) => (d.sent_at === null) === (d.sent_evidence === null || d.sent_evidence === ""), {
    message: "sent_at requires sent_evidence, and evidence without a sent time is a defect",
    path: ["sent_at"],
  });
export type DraftRow = z.infer<typeof DraftRow>;

export const DRAFT_COLUMNS =
  "id, organization_id, work_item_id, step_id, to_address, subject, body, copied_at, sent_at, sent_evidence, outcome_unknown, created_by, created_at, updated_at";

/** The audit action written when a person records an external send (prototype checks.mjs line 21). */
export const EXTERNAL_SEND_AUDIT_ACTION = "External send recorded by human";
