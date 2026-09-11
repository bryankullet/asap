import {
  CLIENT_COLUMNS,
  INSURER_COLUMNS,
  POLICY_COLUMNS,
  POLICY_PERIOD_COLUMNS,
  type AttentionDegradation,
  type AttentionPeriod,
  type WorkItemRow,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysToEnd } from "./signals.js";

/**
 * The context a card needs to name what it is about: the client, and the period of cover.
 *
 * A work item carries `client_id` and `policy_period_id` and nothing else — no names, no dates —
 * because those belong to the client and the policy, not to the task. Every board that shows a
 * card therefore needs this, so it lives here rather than three times over.
 *
 * Two rules it keeps:
 *
 *  - **Read under the caller's session.** `db` is the request-scoped client, so RLS decides what
 *    exists. A client the caller may not see comes back as absent, never as an id.
 *  - **Degrade, never fail.** A read that errors adds a line to `degraded` and leaves the map
 *    empty, so the board renders what it has and says what it could not read (§36 partial
 *    success). A board that fails whole because one lookup failed is worse than one that is
 *    honest about the gap.
 */
export type RecordContext = {
  clientNames: Map<string, string>;
  clientFileStatus: Map<string, string>;
  periods: Map<string, AttentionPeriod>;
  degraded: AttentionDegradation[];
};

export async function loadRecordContext(
  db: SupabaseClient,
  orgId: string,
  items: WorkItemRow[],
  now: Date,
): Promise<RecordContext> {
  const degraded: AttentionDegradation[] = [];
  const clientNames = new Map<string, string>();
  const clientFileStatus = new Map<string, string>();
  const periods = new Map<string, AttentionPeriod>();

  const clientIds = [
    ...new Set(items.map((i) => i.client_id).filter((v): v is string => v !== null)),
  ];
  if (clientIds.length > 0) {
    const r = await db.from("clients").select(CLIENT_COLUMNS).in("id", clientIds);
    if (r.error) {
      degraded.push({ what: "Client names", because: "The client rows could not be read." });
    } else {
      for (const row of (r.data ?? []) as { id: string; name: string; file_status: string }[]) {
        clientNames.set(row.id, row.name);
        clientFileStatus.set(row.id, row.file_status);
      }
    }
  }

  const periodIds = [
    ...new Set(items.map((i) => i.policy_period_id).filter((v): v is string => v !== null)),
  ];
  if (periodIds.length > 0) {
    const pr = await db.from("policy_periods").select(POLICY_PERIOD_COLUMNS).in("id", periodIds);
    if (pr.error) {
      degraded.push({
        what: "Periods of cover",
        because: "The policy period rows could not be read.",
      });
    } else {
      const rows = (pr.data ?? []) as {
        id: string;
        policy_id: string;
        period_start: string;
        period_end: string;
      }[];
      const policyIds = [...new Set(rows.map((p) => p.policy_id))];
      const [polR, insR] = await Promise.all([
        db.from("policies").select(POLICY_COLUMNS).in("id", policyIds),
        db.from("insurers").select(INSURER_COLUMNS).eq("organization_id", orgId),
      ]);
      const policies = polR.error
        ? []
        : ((polR.data ?? []) as {
            id: string;
            class_of_business: string;
            policy_number: string | null;
            insurer_id: string;
          }[]);
      const insurers = insR.error ? [] : ((insR.data ?? []) as { id: string; name: string }[]);
      if (polR.error || insR.error) {
        degraded.push({
          what: "Policy details",
          because: "The policy or insurer rows could not be read.",
        });
      }
      for (const p of rows) {
        const policy = policies.find((x) => x.id === p.policy_id);
        periods.set(p.id, {
          id: p.id,
          classOfBusiness: policy?.class_of_business ?? "This policy",
          insurerName: insurers.find((i) => i.id === policy?.insurer_id)?.name ?? "the insurer",
          policyNumber: policy?.policy_number ?? null,
          periodStart: p.period_start,
          periodEnd: p.period_end,
          daysToEnd: daysToEnd(p.period_end, now),
        });
      }
    }
  }

  return { clientNames, clientFileStatus, periods, degraded };
}
