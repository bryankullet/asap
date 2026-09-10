import { RUN_COLUMNS, RunRow, WORK_ITEM_COLUMNS, WorkItemRow, type WorkView } from "@asap/schema";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase.js";
import { api } from "./api.js";

/**
 * Domain reads: supabase-js with the user's session, through RLS (UI Build Spec v1 Part 1.2).
 * Every key derives from the organization and record id so invalidation is mechanical. Rows are
 * validated against the shared contract before any component sees them.
 */

export const workKeys = {
  list: (orgId: string, view: WorkView | "today") => ["work_items", orgId, view] as const,
  one: (id: string) => ["work_item", id] as const,
};
export const attentionKeys = {
  today: (orgId: string) => ["attention", orgId] as const,
  work: (orgId: string, view: WorkView, limit: number) =>
    ["work_list", orgId, view, limit] as const,
};
export const runKeys = {
  list: (orgId: string) => ["runs", orgId] as const,
  one: (id: string) => ["run", id] as const,
};

async function unwrap<T>(
  p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  parse: (d: unknown) => T,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return parse(data);
}

export function useWorkItems(orgId: string | undefined, view: WorkView) {
  return useQuery({
    queryKey: workKeys.list(orgId ?? "none", view),
    enabled: Boolean(orgId),
    queryFn: () => {
      let q = supabase
        .from("work_items")
        .select(WORK_ITEM_COLUMNS)
        .eq("organization_id", orgId!)
        .is("deleted_at", null);
      if (view === "needs") q = q.eq("task_status", "needs_you");
      if (view === "with") q = q.eq("task_status", "with_party");
      if (view === "done") q = q.eq("task_status", "done");
      if (view === "recent") q = q.neq("task_status", "done");
      return unwrap(q.order("updated_at", { ascending: false }).limit(100), (d) =>
        WorkItemRow.array().parse(d),
      );
    },
  });
}

export function useWorkItem(id: string) {
  return useQuery({
    queryKey: workKeys.one(id),
    queryFn: () =>
      unwrap(
        supabase
          .from("work_items")
          .select(WORK_ITEM_COLUMNS)
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle(),
        (d) => (d === null ? null : WorkItemRow.parse(d)),
      ),
  });
}

export function useRuns(orgId: string | undefined) {
  return useQuery({
    queryKey: runKeys.list(orgId ?? "none"),
    enabled: Boolean(orgId),
    refetchInterval: 15_000,
    queryFn: () =>
      unwrap(
        supabase
          .from("runs")
          .select(RUN_COLUMNS)
          .eq("organization_id", orgId!)
          .order("started_at", { ascending: false })
          .limit(50),
        (d) => RunRow.array().parse(d),
      ),
  });
}

export function useRun(id: string) {
  return useQuery({
    queryKey: runKeys.one(id),
    queryFn: () =>
      unwrap(supabase.from("runs").select(RUN_COLUMNS).eq("id", id).maybeSingle(), (d) =>
        d === null ? null : RunRow.parse(d),
      ),
  });
}

export function useRunsForWorkItem(workItemId: string) {
  return useQuery({
    queryKey: [...runKeys.one(workItemId), "for_work_item"],
    queryFn: () =>
      unwrap(
        supabase
          .from("runs")
          .select(RUN_COLUMNS)
          .eq("work_item_id", workItemId)
          .order("started_at", { ascending: false }),
        (d) => RunRow.array().parse(d),
      ),
  });
}

/**
 * Today, from the API. The ranking, the cap, the reason and the "is this check due" decision are
 * all server-side now; the browser renders what comes back. It used to select up to 100 rows and
 * decide among them against its own clock.
 */
export function useAttention(orgId: string | undefined) {
  return useQuery({
    queryKey: attentionKeys.today(orgId ?? "none"),
    enabled: Boolean(orgId),
    refetchInterval: 60_000,
    queryFn: () => api.attention(),
  });
}

/** Work's four views, from the API, ranked and capped there. */
export function useWorkList(orgId: string | undefined, view: WorkView, limit = 50) {
  return useQuery({
    queryKey: attentionKeys.work(orgId ?? "none", view, limit),
    enabled: Boolean(orgId),
    queryFn: () => api.workList(view, limit),
  });
}
