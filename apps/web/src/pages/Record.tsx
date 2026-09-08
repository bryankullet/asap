import { useParams } from "@tanstack/react-router";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { useRun, useRunsForWorkItem, useWorkItem } from "../lib/queries.js";
import { RunView, WorkItemView } from "../views/RecordViews.js";

export function Record() {
  const { recordId = "" } = useParams({ strict: false }) as { recordId?: string };
  const item = useWorkItem(recordId);
  const runsForItem = useRunsForWorkItem(recordId);
  const run = useRun(recordId);

  if (item.isPending) return <LoadingList rows={2} label="Loading record" />;
  if (item.isError)
    return <ErrorState what="This record could not load" retry={() => void item.refetch()} />;
  if (item.data) return <WorkItemView item={item.data} runs={runsForItem.data ?? []} />;
  if (run.isPending) return <LoadingList rows={1} label="Loading record" />;
  if (run.data) return <RunView run={run.data} />;
  return (
    <MissingData
      what="No record with that id"
      why="It may not exist, or your role in this brokerage cannot see it. Nothing is hidden on purpose without saying so."
    />
  );
}
