import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { WorkView, type WorkListResponse } from "@asap/schema";
import { workSpace } from "../live/space-adapters.js";
import { can, useMe } from "../lib/me.js";
import { useWorkList } from "../lib/queries.js";
import { DEFAULT_WORK_FILTER, LEGACY_WORK_FILTERS, PINNED_VIEW } from "../shell/nav.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";
import { PinList } from "../components/PinButton.js";

/**
 * Work — what a *person* owns.
 *
 * Rendered through the one Space renderer, with no page frame of its own: `Page` and
 * `ScreenTitle` are gone from here, and the header, the filter pills and the rows are the Space
 * frame's own. A new shell around an old page design is not parity.
 *
 * The five main views are the task-status layer itself plus Recent (D-075) and they are **links**,
 * so choosing one changes what the server returns. A filter that hid rows the browser already had
 * would disagree with its own count the moment the cap bit, and would not survive a reload or a
 * tab switch.
 *
 * Two things sit beside the views rather than among them, because neither is a state work is in:
 * **Pinned**, a personal marker with its own endpoint, and **For review**, which is contextual and
 * earns its place only where review is genuinely the question.
 */
function viewFor(raw: string | undefined): string {
  if (!raw) return DEFAULT_WORK_FILTER;
  return LEGACY_WORK_FILTERS[raw] ?? raw;
}

export function Work() {
  const { view } = useSearch({ strict: false }) as { view?: string };
  const me = useMe();
  const navigate = useNavigate();
  const active = viewFor(view);
  const pinnedTab = active === PINNED_VIEW.id;

  const parsed = WorkView.safeParse(active);
  const requested: WorkView = parsed.success ? parsed.data : DEFAULT_WORK_FILTER;
  const live = useWorkList(me.data?.active_organization?.id, requested);
  const tabs = useWorkspaceTabs("/work");

  /*
   * Work is a Space, so it is a tab — one tab for Work, whichever view is showing. The view lives
   * in the URL, so switching tabs back to Work restores the view it was left on, and two tabs are
   * never two copies of the same board.
   */
  const ready = live.data !== undefined;
  useEffect(() => {
    if (!ready) return;
    tabs.open({
      spaceType: "work",
      recordType: "organization",
      recordId: "work",
      kind: "WORK",
      title: "All work",
      path: "/work",
    });
    /* Keyed on `ready` alone: re-opening an open tab is a no-op, so nothing else should re-run it. */
  }, [ready]);

  const canAssign = can(me.data, "work_item", "assign");
  const space = workSpace(
    pinnedTab ? undefined : live.data,
    {
      loading: !pinnedTab && live.isLoading,
      error: !pinnedTab && live.isError,
    },
    { canAssign, people: [] },
  );

  /*
   * Pinned is rendered by its own component over its own endpoint, because it is per-person state
   * rather than a view of the brokerage's work. It keeps the Space's header and pills above it so
   * the screen is one thing, not two.
   */
  if (pinnedTab) {
    return (
      <>
        <SpaceFrameView space={pinnedSpace(space, live.data)} />
        <div className="sp-blocks">
          <PinList />
        </div>
      </>
    );
  }

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        /*
         * Assignment happens in the item's own Space, where the guards and the evidence are. The
         * row's control takes a person there rather than writing from inside a list: a mutation in
         * a list is how a misclick reassigns the wrong item.
         */
        if (action.verb === "assign") {
          const row = (live.data?.items ?? []).find((r) => r.nowStep?.id === action.stepId);
          if (row) void navigate({ to: row.links.work });
        }
      }}
    />
  );
}

/** The Space header for the Pinned marker: the same frame, saying plainly what it is showing. */
function pinnedSpace(base: ReturnType<typeof workSpace>, data: WorkListResponse | undefined) {
  return {
    ...base,
    title: "Pinned",
    context: "A personal marker, not a state work is in. Only you see what you have pinned.",
    status: { label: "Yours", tone: "neutral" as const },
    filters: base.filters.map((f) => ({ ...f, active: false })),
    blocks: [],
    state: "ready" as const,
    degraded: data?.degraded ?? [],
  };
}
