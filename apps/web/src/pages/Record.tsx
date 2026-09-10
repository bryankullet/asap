import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { ActionPanel } from "../features/work/ActionPanel.js";
import { api, describeApiError } from "../lib/api.js";
import { Notice } from "@asap/ui";
import { useRun } from "../lib/queries.js";
import { useRunStream } from "../lib/runStream.js";
import { RunView, WorkItemView } from "../views/RecordViews.js";
import { DraftCard } from "../features/drafts/DraftCard.js";
import { ClaimPanel } from "../views/ClaimPanel.js";
import { EndorsementPanel } from "../views/EndorsementPanel.js";
import { PolicyView } from "../views/PolicyView.js";

export function Record() {
  const { recordId = "" } = useParams({ strict: false }) as { recordId?: string };
  // A link that already knows the id is a policy says so, so the page does not probe /work-items
  // first and log a 404 on the way to the answer. A pasted URL carries no hint and still probes.
  const { kind } = useSearch({ strict: false }) as { kind?: "policy" };
  const isPolicy = kind === "policy";
  const full = useQuery({
    queryKey: ["work_item_full", recordId],
    queryFn: () => api.workItem(recordId),
    retry: false,
    enabled: !isPolicy,
  });
  const run = useRun(recordId);
  const policy = useQuery({
    queryKey: ["policy", recordId],
    queryFn: () => api.policy(recordId),
    retry: false,
    enabled: isPolicy || full.isError,
  });
  const qc = useQueryClient();
  const claimAct = useMutation({
    mutationFn: (a: Parameters<typeof api.claimAct>[1]) =>
      api.claimAct(full.data!.claim!.claim.id, a),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["work_item_full", recordId] }),
  });
  const endorsementAct = useMutation({
    mutationFn: (a: Parameters<typeof api.endorsementAct>[1]) =>
      api.endorsementAct(full.data!.endorsement!.endorsement.id, a),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["work_item_full", recordId] }),
  });
  const [liveRun, setLiveRun] = useState<string | null>(null);
  const working = full.data?.runs.find((r) => r.status === "working") ?? null;
  const stream = useRunStream(liveRun ?? working?.id ?? null, recordId);

  if (isPolicy) {
    if (policy.isPending) return <LoadingList rows={1} label="Loading record" />;
    if (policy.data)
      return <PolicyView data={policy.data} today={new Date().toISOString().slice(0, 10)} />;
    return (
      <MissingData
        what="No policy with that id"
        why="It may not exist, or your role in this brokerage cannot see it. Nothing is hidden on purpose without saying so."
      />
    );
  }
  if (full.isPending) return <LoadingList rows={2} label="Loading record" />;
  if (full.isError && (full.error as { status?: number }).status !== 404) {
    return <ErrorState what="This record could not load" retry={() => void full.refetch()} />;
  }
  if (full.data) {
    const item = full.data.item;
    const now = item.steps.find((s) => s.state === "now" || s.state === "blocked");
    const servicing = full.data.claim ? (
      <ClaimPanel
        detail={full.data.claim}
        onAct={(a) => claimAct.mutate(a)}
        pending={claimAct.isPending}
      />
    ) : full.data.endorsement ? (
      <EndorsementPanel
        detail={full.data.endorsement}
        onAct={(a) => endorsementAct.mutate(a)}
        pending={endorsementAct.isPending}
      />
    ) : null;
    const stepDrafts = now ? full.data.drafts.filter((d) => d.step_id === now.id) : [];
    const servicingError = claimAct.isError
      ? claimAct.error
      : endorsementAct.isError
        ? endorsementAct.error
        : null;
    // Part 14: servicing is a section of the recipe, so it goes through `aside` and lands above
    // the record footer. Rendering it after <WorkItemView> put a claim's panels below the footer.
    const servicingSection =
      servicing || servicingError ? (
        <div className="flex flex-col gap-4">
          {servicingError && <Notice tone="error">{describeApiError(servicingError)}</Notice>}
          {servicing}
        </div>
      ) : null;
    return (
      <div className="space-y-4">
        <WorkItemView
          aside={servicingSection}
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
                hideDrafts
                candidatePeriods={full.data.claim?.candidatePeriods ?? []}
              />
            ) : null
          }
          drafts={
            stepDrafts.length > 0 ? (
              <div className="flex flex-col gap-3">
                {stepDrafts.map((d) => (
                  <DraftCard key={d.id} draft={d} item={item} step={now!} />
                ))}
              </div>
            ) : null
          }
        />
      </div>
    );
  }
  if (run.isPending) return <LoadingList rows={1} label="Loading record" />;
  if (run.data) return <RunView run={run.data} />;
  if (policy.isPending && full.isError) return <LoadingList rows={1} label="Loading record" />;
  if (policy.data)
    return <PolicyView data={policy.data} today={new Date().toISOString().slice(0, 10)} />;
  return (
    <MissingData
      what="No record with that id"
      why="It may not exist, or your role in this brokerage cannot see it. Nothing is hidden on purpose without saying so."
    />
  );
}
