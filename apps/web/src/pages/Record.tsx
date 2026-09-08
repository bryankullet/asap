import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { ActionPanel } from "../features/work/ActionPanel.js";
import { api } from "../lib/api.js";
import { useRun } from "../lib/queries.js";
import { useRunStream } from "../lib/runStream.js";
import { RunView, WorkItemView } from "../views/RecordViews.js";

export function Record() {
  const { recordId = "" } = useParams({ strict: false }) as { recordId?: string };
  const full = useQuery({
    queryKey: ["work_item_full", recordId],
    queryFn: () => api.workItem(recordId),
    retry: false,
  });
  const run = useRun(recordId);
  const [liveRun, setLiveRun] = useState<string | null>(null);
  const working = full.data?.runs.find((r) => r.status === "working") ?? null;
  const stream = useRunStream(liveRun ?? working?.id ?? null, recordId);

  if (full.isPending) return <LoadingList rows={2} label="Loading record" />;
  if (full.isError && (full.error as { status?: number }).status !== 404) {
    return <ErrorState what="This record could not load" retry={() => void full.refetch()} />;
  }
  if (full.data) {
    const item = full.data.item;
    const now = item.steps.find((s) => s.state === "now" || s.state === "blocked");
    return (
      <WorkItemView
        item={item}
        runs={full.data.runs}
        live={
          stream.events.length > 0 && !stream.ended ? stream.events.map((e) => e.message) : null
        }
        actions={
          now ? (
            <ActionPanel
              item={item}
              step={now}
              drafts={full.data.drafts}
              onRunStarted={setLiveRun}
            />
          ) : null
        }
      />
    );
  }
  if (run.isPending) return <LoadingList rows={1} label="Loading record" />;
  if (run.data) return <RunView run={run.data} />;
  return (
    <MissingData
      what="No record with that id"
      why="It may not exist, or your role in this brokerage cannot see it. Nothing is hidden on purpose without saying so."
    />
  );
}
