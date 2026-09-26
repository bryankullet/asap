import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { PlacementAction } from "@asap/schema";
import { placementSpace, type PlacementDraft } from "../live/placement-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * One client's placement (4B-4).
 *
 * Every consequential step goes to the server as a typed action, and the screen always shows what
 * the server answered — including a refusal, with its reason. Nothing here decides whether a
 * request was approved, sent or confirmed; the only state kept in the browser is which form is
 * open, and an idempotency key per submission attempt so a double click records once.
 */
export function PlacementSpace() {
  const { placementId = "" } = useParams({ strict: false }) as { placementId?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tabs = useWorkspaceTabs(`/placements/${placementId}`);
  const [failure, setFailure] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<PlacementDraft>(null);
  /* One key per attempt to record a submission: a retry of the same attempt is the same write. */
  const submissionKey = useRef<string>(crypto.randomUUID());

  const live = useQuery({
    queryKey: ["placement", placementId],
    queryFn: () => api.placement(placementId),
    retry: false,
  });

  const act = useMutation({
    mutationFn: (input: PlacementAction) => api.placementAction(placementId, input),
    onSuccess: (res) => {
      if (res.placement) qc.setQueryData(["placement", placementId], res.placement);
      if (res.outcome === "blocked") {
        setFailure(res.reason);
        return;
      }
      setFailure(null);
      setDrafting(null);
      submissionKey.current = crypto.randomUUID();
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const title = live.data?.placement.title;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({
      spaceType: "placement",
      recordType: "placement",
      recordId: placementId,
      kind: "PLACEMENT",
      title,
      path: `/placements/${placementId}`,
    });
  }, [title, placementId]);

  const notFound = live.isError && live.error instanceof ApiRequestError && live.error.status === 404;
  const space = placementSpace(
    live.data,
    {
      loading: live.isPending,
      /* A refusal is shown where it happened, not as a broken screen: see `failure` below. */
      error: notFound ? null : live.isError ? describeApiError(live.error) : null,
      missing: notFound,
      busy: act.isPending,
    },
    placementId,
    drafting,
  );

  /* The server's refusal, in its own words, at the top of the page it refused. */
  if (failure !== null && space.state === "ready") {
    space.blocks.unshift({
      id: "refused",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "attention",
      title: "That was not recorded",
      text: failure,
    });
  }

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
        const values = (action as { values?: Record<string, string> }).values ?? {};
        const d = live.data;
        if (d === undefined) return;

        if (step === "prepare") {
          /*
           * A starting point a person edits, built from the frozen terms — never composed by a
           * model, and preparing it sends nothing.
           */
          const terms = d.basis.terms.map((t) => `- ${t.label}: ${t.value ?? ""}`).join("\n");
          act.mutate({
            action: "prepare_request",
            subject: `Placement instruction — ${d.client.name}`,
            body: `Dear Underwriter,\n\nOn our client's instruction, please place ${d.opportunity.classOfBusiness} cover for ${d.client.name} on the terms you quoted, from ${d.placement.requestedEffectiveAt.slice(0, 10)}.\n\nTerms accepted:\n${terms || "- As quoted"}\n\nPlease confirm cover in writing, with your reference.\n\nKind regards`,
            coverRequested: `${d.opportunity.classOfBusiness} for ${d.client.name}`,
            ...(d.instruction.clientConditions === null ? {} : { outstandingConditions: d.instruction.clientConditions }),
          });
          return;
        }
        if (step.startsWith("approve:")) {
          act.mutate({ action: "approve_request", placementRequestId: step.slice("approve:".length) });
          return;
        }
        if (step.startsWith("submit:")) {
          setFailure(null);
          setDrafting("submission");
          return;
        }
        if (step.startsWith("submit-form:")) {
          const sentAt = values["sentAt"] ? new Date(values["sentAt"]).toISOString() : "";
          act.mutate({
            action: "record_submission",
            placementRequestId: step.slice("submit-form:".length),
            method: (values["method"] ?? "recorded_manual_email") as "recorded_manual_email",
            recipient: values["recipient"] ?? "",
            sentAt,
            evidenceNote: values["evidenceNote"] ?? "",
            idempotencyKey: submissionKey.current,
          });
          return;
        }
        if (step === "respond") {
          setFailure(null);
          setDrafting("response");
          return;
        }
        if (step === "respond-form") {
          const outcome = (values["outcome"] ?? "confirmed_as_requested") as
            | "confirmed_as_requested"
            | "confirmed_with_changes"
            | "more_information_required"
            | "declined";
          const iso = (v: string | undefined) => (v ? new Date(v).toISOString() : undefined);
          const detail = values["detail"] ?? "";
          const effectiveAt = iso(values["effectiveAt"]);
          const expiryAt = iso(values["expiryAt"]);
          act.mutate({
            action: "record_insurer_response",
            outcome,
            receivedAt: new Date().toISOString(),
            ...(effectiveAt === undefined ? {} : { effectiveAt }),
            ...(expiryAt === undefined ? {} : { expiryAt }),
            ...(values["insurerReference"] ? { insurerReference: values["insurerReference"] } : {}),
            ...(outcome === "confirmed_with_changes" ? { changesNote: detail } : {}),
            ...(outcome === "more_information_required" ? { informationRequired: detail } : {}),
            ...(outcome === "declined" ? { declineReason: detail } : {}),
            evidenceNote: values["evidenceNote"] ?? "",
          });
          return;
        }
        if (step === "issuance") {
          act.mutate({ action: "prepare_issuance" });
        }
      }}
    />
  );
}
