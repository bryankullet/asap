import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ComparisonAction, RecordInstructionRequest } from "@asap/schema";
import { comparisonSpace } from "../live/comparison-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * The quotes, beside each other (4B-3).
 *
 * Its own tab, keyed by the opportunity, so two quotations never share a reading. Everything on
 * screen — the columns, the absences, the recommendation, whether the comparison still holds —
 * comes from the server's answer; nothing is derived here.
 */
export function ComparisonSpace() {
  const { opportunityId = "" } = useParams({ strict: false }) as { opportunityId?: string };
  /* Reading an earlier version is a different address, so it can be linked and reopened. */
  const { version } = useSearch({ strict: false }) as { version?: number };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tabs = useWorkspaceTabs(`/opportunities/${opportunityId}/comparison`);
  const [failure, setFailure] = useState<string | null>(null);
  const [recordingInstruction, setRecordingInstruction] = useState(false);

  /* The client's instruction creates the placement, which then opens as its own tab. */
  const instruct = useMutation({
    mutationFn: (input: RecordInstructionRequest) => api.recordInstruction(opportunityId, input),
    onSuccess: (res) => {
      if (res.outcome === "blocked" || res.placementId === null) {
        setFailure(res.reason ?? "The instruction was not recorded.");
        return;
      }
      setFailure(null);
      setRecordingInstruction(false);
      void navigate({ to: "/placements/$placementId", params: { placementId: res.placementId } });
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const live = useQuery({
    queryKey: ["comparison", opportunityId, version ?? null],
    queryFn: () => api.comparison(opportunityId, version),
    retry: false,
  });

  const act = useMutation({
    mutationFn: (input: ComparisonAction) => api.comparisonAction(opportunityId, input),
    onSuccess: (res) => {
      if (res.comparison) qc.setQueryData(["comparison", opportunityId, version ?? null], res.comparison);
      /* The opportunity's own reading is now behind: a comparison is generated from its rows. */
      void qc.invalidateQueries({ queryKey: ["opportunity", opportunityId] });
      setFailure(res.outcome === "blocked" ? res.reason : null);
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const title = live.data?.opportunity.title;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({
      spaceType: "placement",
      recordType: "opportunity",
      recordId: opportunityId,
      kind: "COMPARISON",
      title: `${title} — comparison`,
      path: `/opportunities/${opportunityId}/comparison`,
    });
  }, [title, opportunityId]);

  const notFound = live.isError && live.error instanceof ApiRequestError && live.error.status === 404;
  const space = comparisonSpace(live.data, {
    loading: live.isPending,
    error: notFound ? null : (failure ?? (live.isError ? describeApiError(live.error) : null)),
    missing: notFound,
    busy: act.isPending || instruct.isPending,
  }, opportunityId, recordingInstruction);

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        // One change at a time, so a double click cannot write twice.
        if (act.isPending) return;
        const step = action.stepId ?? "";
        if (step === "instruct") {
          setRecordingInstruction(true);
          return;
        }
        if (step === "instruction-form") {
          if (instruct.isPending) return;
          const values = (action as { values?: Record<string, string> }).values ?? {};
          const iso = (v: string | undefined) => (v ? new Date(v).toISOString() : "");
          instruct.mutate({
            insurerResponseId: values["insurerResponseId"] ?? "",
            source: (values["source"] ?? "telephone") as RecordInstructionRequest["source"],
            evidenceNote: values["evidenceNote"] ?? "",
            ...(values["clientConditions"] ? { clientConditions: values["clientConditions"] } : {}),
            instructedAt: iso(values["instructedAt"]),
            requestedEffectiveAt: iso(values["requestedEffectiveAt"]),
          });
          return;
        }
        if (step === "generate") {
          act.mutate({ action: "generate_comparison" });
          return;
        }
        if (step.startsWith("present:")) {
          act.mutate({ action: "present_comparison", comparisonId: step.slice("present:".length) });
        }
      }}
    />
  );
}
