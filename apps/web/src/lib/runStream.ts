import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { streamRun } from "./api.js";

export type StreamEvent = {
  kind: string;
  message: string;
  status?: string;
  next_step?: string | null;
};

/** Follows a run over SSE and invalidates the item, runs and the Activity chip when it ends. */
export function useRunStream(runId: string | null, workItemId: string | null) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setEnded(false);
    const controller = new AbortController();
    void streamRun(
      runId,
      (e) => {
        if (e.kind === "done") {
          setEnded(true);
          void qc.invalidateQueries({ queryKey: ["runs"] });
          if (workItemId) void qc.invalidateQueries({ queryKey: ["work_item_full", workItemId] });
          return;
        }
        const next: StreamEvent = { kind: e.kind, message: String(e.data["message"] ?? "") };
        const status = e.data["status"];
        if (typeof status === "string") next.status = status;
        setEvents((prev) => [...prev, next]);
      },
      controller.signal,
    ).catch(() => setEnded(true));
    return () => controller.abort();
  }, [runId, workItemId, qc]);
  return { events, ended };
}
