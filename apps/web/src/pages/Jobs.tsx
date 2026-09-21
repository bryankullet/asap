import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import type { RunListFilter } from "@asap/schema";
import { activitySpace, runSpace } from "../live/connections-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useRunList } from "../lib/queries.js";
import { JOB_FILTERS } from "../shell/nav.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Activity — what *ASAP* is processing, as distinct from what a *person* owns.
 *
 * Not a destination in the sidebar (D-074): it opens from the Activity control beside Ask, from a
 * Space, from an import or from an automation's history. That is only safe because of the promise
 * the Space states in its first block — anything needing a person is in Work first, so Activity
 * can be ignored at no cost.
 *
 * The vocabulary is deliberately not Work's: **Working · Finished · Stopped**. A finished run
 * means ASAP produced an output, never that a policy renewed, a claim was accepted or money
 * arrived.
 */
export function Jobs() {
  const { filter } = useSearch({ strict: false }) as { filter?: string };
  const me = useMe();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs("/jobs");
  const active = (filter ?? "all") as RunListFilter;

  /*
   * Grouped, counted and capped by the API under the caller's session. Progress comes back derived
   * from the work's steps — never authored here, and null when there is nothing to derive it from.
   */
  const live = useRunList(me.data?.active_organization?.id, active);

  const ready = live.data !== undefined;
  useEffect(() => {
    if (!ready) return;
    tabs.open({
      spaceType: "activity",
      recordType: "organization",
      recordId: "activity",
      kind: "ACTIVITY",
      title: "What ASAP has been doing",
      path: "/jobs",
    });
  }, [ready]);

  const space = activitySpace(
    live.data,
    { loading: live.isLoading, error: live.isError ? describeApiError(live.error) : null },
    JOB_FILTERS,
    active,
  );

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) void navigate({ to: action.to.path });
      }}
    />
  );
}

/**
 * One run: the steps ASAP actually performed, its evidence, and the work it left for a person.
 *
 * Its own tab, keyed by the run's id, so two runs open as two tabs and reopening one focuses the
 * tab that is already there.
 */
export function JobDetail() {
  const { jobId = "" } = useParams({ strict: false }) as { jobId?: string };
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs(`/jobs/${jobId}`);
  const detail = useQuery({
    queryKey: ["run_detail", jobId],
    queryFn: () => api.run(jobId),
    retry: false,
  });

  const title = detail.data?.run.title;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({
      spaceType: "activity",
      recordType: "run",
      recordId: jobId,
      kind: "RUN",
      title,
      path: `/jobs/${jobId}`,
    });
  }, [title, jobId]);

  const space = runSpace(
    detail.data,
    {
      loading: detail.isPending,
      error: detail.isError ? describeApiError(detail.error) : null,
      missing: !detail.isPending && !detail.isError && detail.data === undefined,
    },
    jobId,
  );

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) void navigate({ to: action.to.path });
      }}
    />
  );
}
