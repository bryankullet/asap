import { z } from "zod";
import { uuidSchema } from "./api/common.js";
import { FileStatus } from "./status.js";

/**
 * Client files — Screen Map v3 Part 4.1 (K01–K03), UI Build Spec Part 6.8.
 * A client lands as not_started and is never assumed cleared; clearing is a named human decision
 * with a reason. Screening (K03) is parked: the file can be collected but not screened.
 */
const isoDate = z.string().datetime({ offset: true });

export const ClientKind = z.enum(["individual", "corporate"]);
export const ClientSource = z.enum(["imported", "manual", "seed"]);
export const DocumentKind = z.enum([
  "identity",
  "beneficial_ownership",
  "source_of_funds",
  "other",
]);

export const ClientRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string().min(1),
  kind: ClientKind,
  source: ClientSource,
  file_status: FileStatus,
  file_owner_id: uuidSchema.nullable(),
  file_decided_by: uuidSchema.nullable(),
  file_decided_at: isoDate.nullable(),
  file_decision_reason: z.string().nullable(),
  refresh_interval_days: z.number().int().nullable(),
  refresh_due_at: isoDate.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
  deleted_at: isoDate.nullable(),
});
export type ClientRow = z.infer<typeof ClientRow>;

export const ClientDocumentRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  client_id: uuidSchema,
  kind: DocumentKind,
  label: z.string(),
  /** What was actually received. Null means requested, not received. */
  reference: z.string().nullable(),
  requested_at: isoDate.nullable(),
  received_at: isoDate.nullable(),
  recorded_by: uuidSchema.nullable(),
  created_at: isoDate,
});
export type ClientDocumentRow = z.infer<typeof ClientDocumentRow>;

/** The effective file state: cleared past its refresh date reads as refresh_due. */
export function effectiveFileStatus(
  c: Pick<ClientRow, "file_status" | "refresh_due_at">,
  now = new Date(),
): FileStatus {
  if (c.file_status === "cleared" && c.refresh_due_at && new Date(c.refresh_due_at) <= now)
    return "refresh_due";
  return c.file_status;
}

/** The gate (Screen Map v3 Part 4.1): a placement cannot be approved unless the file is cleared. */
export function fileClearsPlacement(status: FileStatus): boolean {
  return status === "cleared";
}

export const GATE_MESSAGE = "We cannot instruct cover for a client whose file is not complete.";
export const SCREENING_PARKED_MESSAGE =
  "No screening list is connected. Files can be collected but not screened.";

export const K01_VIEWS = [
  "blocking",
  "incomplete",
  "refresh_due",
  "cleared",
  "not_started",
] as const;
export const K01View = z.enum(K01_VIEWS);
export type K01View = z.infer<typeof K01View>;
export const K01_VIEW_LABELS: Readonly<Record<K01View, string>> = {
  blocking: "Blocking live work",
  incomplete: "Incomplete",
  refresh_due: "Refresh due",
  cleared: "Cleared",
  not_started: "Not started",
};

export const CLIENT_COLUMNS =
  "id, organization_id, name, kind, source, file_status, file_owner_id, file_decided_by, file_decided_at, file_decision_reason, refresh_interval_days, refresh_due_at, created_at, updated_at, deleted_at";
export const CLIENT_DOCUMENT_COLUMNS =
  "id, organization_id, client_id, kind, label, reference, requested_at, received_at, recorded_by, created_at";
