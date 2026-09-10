import { ErrorState, LoadingList, PermissionNotice } from "../components/states.js";
import { EmptyState } from "../components/states.js";
import { useMe } from "../lib/me.js";
import { useAttention } from "../lib/queries.js";
import { DiscoverView } from "../views/DiscoverView.js";
import { ApiRequestError } from "../lib/api.js";

/**
 * Discover (D-060) — the first destination, and the renamed Today. Every state it owes is here:
 * no brokerage, loading, a role that cannot read work, an error with a way back, and the answer.
 * Partial success and empty live inside the view, because they carry data with them.
 */
export function Discover() {
  const me = useMe();
  const org = me.data?.active_organization;
  const attention = useAttention(org?.id);
  if (!org)
    return <EmptyState scope="your brokerage" freshness="Choose a brokerage from the switcher." />;
  if (attention.isPending) return <LoadingList label="Loading Discover" />;
  if (attention.isError) {
    const err = attention.error;
    // A role without work:view is told so by name, not shown an empty list (ui-contract).
    if (err instanceof ApiRequestError && (err.status === 403 || err.code === "forbidden")) {
      const role = me.data?.memberships.find((m) => m.organization.id === org.id)?.role.name;
      return <PermissionNotice what="Discover" role={role} />;
    }
    return <ErrorState what="Discover could not load" retry={() => void attention.refetch()} />;
  }
  return <DiscoverView data={attention.data} />;
}
