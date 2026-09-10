import { EmptyState, ErrorState, LoadingList } from "../components/states.js";
import { useMe } from "../lib/me.js";
import { useAttention } from "../lib/queries.js";
import { TodayView } from "../views/TodayView.js";

export function Today() {
  const me = useMe();
  const org = me.data?.active_organization;
  const attention = useAttention(org?.id);
  if (!org)
    return <EmptyState scope="your brokerage" freshness="Choose a brokerage from the switcher." />;
  if (attention.isPending) return <LoadingList label="Loading today" />;
  if (attention.isError)
    return <ErrorState what="Today could not load" retry={() => void attention.refetch()} />;
  return <TodayView data={attention.data} />;
}
