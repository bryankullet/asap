import { WORK_VIEW_LABELS, WorkView } from "@asap/schema";
import { Link, useSearch } from "@tanstack/react-router";
import { chipVariants } from "@asap/ui";
import { WorkCard } from "../components/WorkCard.js";
import { EmptyState, ErrorState, LoadingList } from "../components/states.js";
import { useMe } from "../lib/me.js";
import { useWorkItems } from "../lib/queries.js";

/** Work's four views (H03 + S16). The view lives in the URL so a link to it is shareable. */
export function Work() {
  const { view } = useSearch({ strict: false }) as { view?: WorkView };
  const current: WorkView = WorkView.catch("needs").parse(view);
  const me = useMe();
  const org = me.data?.active_organization;
  const items = useWorkItems(org?.id, current);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Work views" className="mb-5 flex flex-wrap gap-2">
        {WorkView.options.map((v) => (
          <Link
            key={v}
            to="/work"
            search={{ view: v }}
            aria-current={v === current ? "page" : undefined}
            className={chipVariants({ selected: v === current })}
          >
            {WORK_VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      {!org ? (
        <EmptyState scope="your brokerage" freshness="Choose a brokerage from the switcher." />
      ) : items.isPending ? (
        <LoadingList label={`Loading ${WORK_VIEW_LABELS[current]}`} />
      ) : items.isError ? (
        <ErrorState what="Work could not load" retry={() => void items.refetch()} />
      ) : items.data.length === 0 ? (
        <EmptyState
          scope={`${WORK_VIEW_LABELS[current]} for ${org.name}`}
          freshness="Checked just now."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.data.map((item) => (
            <WorkCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
