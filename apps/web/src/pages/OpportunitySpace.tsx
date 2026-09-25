import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { OpportunityAction } from "@asap/schema";
import { opportunitySpace, quoteSpace } from "../live/opportunity-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Quotation work, and one insurer's terms inside it (D-084).
 *
 * Both read the same record, because they are two views of one piece of work. Each is its own tab,
 * keyed by its own id, so two opportunities — or two insurers' terms — never share a query, a
 * selection or a draft.
 */
function useOpportunity(opportunityId: string) {
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const live = useQuery({
    queryKey: ["opportunity", opportunityId],
    queryFn: () => api.opportunity(opportunityId),
    retry: false,
  });

  const act = useMutation({
    mutationFn: (input: OpportunityAction) => api.opportunityAction(opportunityId, input),
    onSuccess: (res) => {
      /* The server's answer is the truth, including when it refused and why. */
      if (res.opportunity) qc.setQueryData(["opportunity", opportunityId], res.opportunity);
      setFailure(res.outcome === "blocked" ? res.reason : null);
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const notFound = live.isError && live.error instanceof ApiRequestError && live.error.status === 404;
  return {
    live,
    act,
    failure,
    setFailure,
    state: {
      loading: live.isPending,
      error: notFound ? null : (failure ?? (live.isError ? describeApiError(live.error) : null)),
      missing: notFound,
      busy: act.isPending,
    },
  };
}

export function OpportunitySpace() {
  const { opportunityId = "" } = useParams({ strict: false }) as { opportunityId?: string };
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs(`/opportunities/${opportunityId}`);
  const { live, act, state } = useOpportunity(opportunityId);

  const title = live.data?.opportunity.title;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({
      spaceType: "placement",
      recordType: "opportunity",
      recordId: opportunityId,
      kind: "QUOTATION",
      title,
      path: `/opportunities/${opportunityId}`,
    });
  }, [title, opportunityId]);

  const space = opportunitySpace(live.data, state, opportunityId);

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
        const values = (action as { values?: Record<string, string> }).values;

        if (step === "add-insurer" && values?.["insurerId"]) {
          act.mutate({ action: "add_insurer", insurerId: values["insurerId"] });
          return;
        }
        if (step.startsWith("supply:")) {
          /*
           * Marking it supplied has to say what proves it. Without a document or an email to hand
           * this records the person's own note, which is what the contract requires.
           */
          act.mutate({
            action: "supply_requirement",
            requirementId: step.slice("supply:".length),
            note: "Confirmed by the person handling this quotation.",
          });
          return;
        }
        if (step.startsWith("prepare:")) {
          const id = step.slice("prepare:".length);
          const client = live.data?.client.name ?? "";
          act.mutate({
            action: "prepare_request",
            opportunityInsurerId: id,
            subject: `Quotation request — ${client}`,
            /*
             * A starting point a person edits, not a finished letter. Nothing here is composed by
             * a model, and preparing it sends nothing.
             */
            body: `Dear Underwriter,\n\nWe invite terms for ${live.data?.opportunity.classOfBusiness ?? "cover"} for ${client}.\n\n${live.data?.opportunity.riskSummary ?? ""}\n\nPlease state excesses as amounts and confirm the limits that apply.\n\nKind regards`,
          });
          return;
        }
        if (step.startsWith("approve:")) {
          act.mutate({ action: "approve_request", quoteRequestId: step.slice("approve:".length) });
          return;
        }
        if (step.startsWith("respond:")) {
          /* Recording an answer needs the insurer's own words, so it opens that insurer's page. */
          void navigate({
            to: "/opportunities/$opportunityId/insurers/$opportunityInsurerId",
            params: { opportunityId, opportunityInsurerId: step.slice("respond:".length) },
          });
        }
      }}
    />
  );
}

/** One insurer's terms, as its own tab. */
export function QuoteSpace() {
  const { opportunityId = "", opportunityInsurerId = "" } = useParams({ strict: false }) as {
    opportunityId?: string;
    opportunityInsurerId?: string;
  };
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs(`/opportunities/${opportunityId}/insurers/${opportunityInsurerId}`);
  const { live, state } = useOpportunity(opportunityId);

  const insurer = live.data?.insurers.find((i) => i.id === opportunityInsurerId);
  const name = insurer?.insurerName;
  useEffect(() => {
    if (name === undefined) return;
    tabs.open({
      spaceType: "placement",
      recordType: "insurer_response",
      recordId: opportunityInsurerId,
      kind: "TERMS",
      title: `${name} — terms`,
      path: `/opportunities/${opportunityId}/insurers/${opportunityInsurerId}`,
    });
  }, [name, opportunityId, opportunityInsurerId]);

  const space = quoteSpace(live.data, state, opportunityId, opportunityInsurerId);

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) void navigate({ to: action.to.path });
      }}
    />
  );
}
