import {
  agreedRateSchema,
  effectiveFileStatus,
  ClientRow,
  CLIENT_COLUMNS,
  type WorkItemRow,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuardFacts } from "./engine/apply.js";
import { mapDatabaseError } from "./errors.js";
import { loadClaimDetail, loadEndorsementDetail } from "./servicing.js";

/** Loads the facts guards need for one item, under the caller's session (RLS applies). */
export async function loadGuardFacts(db: SupabaseClient, item: WorkItemRow): Promise<GuardFacts> {
  let clientFileState: GuardFacts["clientFileState"] = null;
  if (item.client_id) {
    const { data, error } = await db
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("id", item.client_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (data) clientFileState = effectiveFileStatus(ClientRow.parse(data));
  }
  let agreedRate: GuardFacts["agreedRate"] = undefined;
  if (item.insurer_id && item.class_of_business) {
    const { data, error } = await db.rpc("agreed_rate", {
      p_insurer_id: item.insurer_id,
      p_class: item.class_of_business,
    });
    if (error) throw mapDatabaseError(error);
    const rows = (data ?? []) as unknown[];
    agreedRate = rows.length > 0 ? agreedRateSchema.parse(rows[0]) : null;
  }
  const facts: GuardFacts = { clientFileState, agreedRate, clientId: item.client_id };
  if (item.kind === "claim") facts.claim = await loadClaimDetail(db, item.id);
  if (item.kind === "endorsement") facts.endorsement = await loadEndorsementDetail(db, item.id);
  return facts;
}
