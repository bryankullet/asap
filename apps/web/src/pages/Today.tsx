import { EmptyState, ErrorState, LoadingList } from "../components/states.js";
import { useMe } from "../lib/me.js";
import { useRuns, useWorkItems } from "../lib/queries.js";
import { TodayView } from "../views/TodayView.js";

export function Today() {
  const me = useMe();
  const org = me.data?.active_organization;
  const items = useWorkItems(org?.id, "recent");
  const runs = useRuns(org?.id);
  if (!org)
    return <EmptyState scope="your brokerage" freshness="Choose a brokerage from the switcher." />;
  if (items.isPending || runs.isPending) return <LoadingList label="Loading today" />;
  if (items.isError)
    return <ErrorState what="Today could not load" retry={() => void items.refetch()} />;
  return <TodayView items={items.data} runs={runs.data ?? []} orgName={org.name} />;
}
