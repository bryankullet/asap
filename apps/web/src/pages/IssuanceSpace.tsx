import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ApplyPreview, IssuanceAction } from "@asap/schema";
import { issuanceSpace, type IssuanceDraft } from "../live/issuance-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Policy issuance for one placement (4B-5).
 *
 * Every step goes to the server as a typed issuance action, and the screen shows what the server
 * answered — a refusal in its own words, a receipt when something was written. The browser keeps
 * which form is open, the preview the server generated, and one idempotency key per attempt so a
 * double click records once. It decides nothing about the policy.
 */
export function IssuanceSpace() {
  const { placementId = "" } = useParams({ strict: false }) as { placementId?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tabs = useWorkspaceTabs(`/placements/${placementId}/issuance`);
  const [failure, setFailure] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<IssuanceDraft>(null);
  const [preview, setPreview] = useState<{ view: ApplyPreview; mode: "create" | "update"; policyId?: string; periodId?: string; premiumBasis?: "gross" | "total_payable" } | null>(null);
  const attempt = useRef<string>(crypto.randomUUID());

  const live = useQuery({ queryKey: ["issuance", placementId], queryFn: () => api.issuance(placementId), retry: false });

  const act = useMutation({
    mutationFn: (input: IssuanceAction) => api.issuanceAction(placementId, input),
    onSuccess: (res) => {
      if (res.issuance) qc.setQueryData(["issuance", placementId], res.issuance);
      if (res.outcome === "blocked") {
        setFailure(res.reason);
        return;
      }
      setFailure(null);
      setReceipt(res.receipt?.message ?? null);
      setDrafting(null);
      setPreview(null);
      attempt.current = crypto.randomUUID();
      void qc.invalidateQueries({ queryKey: ["placement", placementId] });
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => setFailure(describeApiError(e)),
  });
  const previewing = useMutation({
    mutationFn: (input: { mode: "create" | "update"; policyId?: string; periodId?: string; premiumBasis?: "gross" | "total_payable" }) =>
      api.issuancePreview(placementId, input).then((view) => ({ view, ...input })),
    onSuccess: (p) => {
      setFailure(null);
      setPreview(p);
    },
    onError: (e) => setFailure(describeApiError(e)),
  });
  const decide = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: "confirm" | "discard" }) => (verb === "confirm" ? api.confirmPreparedAction(id) : api.discardPreparedAction(id)),
    onSuccess: (res) => {
      setFailure(res.outcome === "refused" ? res.reason : null);
      setReceipt(res.outcome === "refused" ? null : (res.action?.receipt?.message ?? null));
      void qc.invalidateQueries({ queryKey: ["issuance", placementId] });
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const title = live.data?.placement.title;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({ spaceType: "placement", recordType: "issuance", recordId: placementId, kind: "POLICY ISSUANCE", title: `Policy issuance — ${title}`, path: `/placements/${placementId}/issuance` });
  }, [title, placementId]);

  const notFound = live.isError && live.error instanceof ApiRequestError && live.error.status === 404;
  const busy = act.isPending || previewing.isPending || decide.isPending;
  const space = issuanceSpace(
    live.data,
    { loading: live.isPending, error: notFound ? null : live.isError ? describeApiError(live.error) : null, missing: notFound, busy },
    placementId,
    drafting,
    preview?.view ?? null,
  );

  if (space.state === "ready") {
    if (receipt !== null) {
      space.blocks.unshift({ id: "done", type: "note", label: null, evidence: [], actions: [], state: "ready", stateNote: null, tone: "done", title: "Recorded", text: receipt });
    }
    if (failure !== null) {
      space.blocks.unshift({ id: "refused", type: "note", label: null, evidence: [], actions: [], state: "ready", stateNote: null, tone: "attention", title: "That was not recorded", text: failure });
    }
  }

  const iso = (v: string | undefined) => (v ? new Date(v).toISOString() : "");

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        if (busy) return;
        const step = action.stepId ?? "";
        const values = (action as { values?: Record<string, string> }).values ?? {};
        setReceipt(null);
        const openForm = (d: IssuanceDraft) => {
          setFailure(null);
          setDrafting(d);
        };

        if (step === "prepare") return act.mutate({ action: "prepare_issuance_request", requiredDocuments: ["Policy schedule"] });
        if (step.startsWith("approve:")) return act.mutate({ action: "approve_issuance_request", issuanceRequestId: step.slice("approve:".length) });
        if (step === "submit") return openForm("submission");
        if (step.startsWith("submit-form:")) {
          return act.mutate({
            action: "record_issuance_submission", issuanceRequestId: step.slice("submit-form:".length),
            method: (values["method"] ?? "recorded_manual_email") as "recorded_manual_email", recipient: values["recipient"] ?? "",
            sentAt: iso(values["sentAt"]), evidenceNote: values["evidenceNote"] ?? "", idempotencyKey: attempt.current,
          });
        }
        if (step === "document") return openForm("document");
        if (step === "document-form") return act.mutate({ action: "record_issued_policy_document", documentId: values["documentId"] ?? "", receivedAt: iso(values["receivedAt"]) });
        if (step.startsWith("field-accept:")) return act.mutate({ action: "review_issued_field", documentFieldId: step.slice("field-accept:".length), decision: "accept" });
        if (step.startsWith("field-reject:")) return act.mutate({ action: "review_issued_field", documentFieldId: step.slice("field-reject:".length), decision: "reject" });
        if (step.startsWith("correct:")) return openForm(step as IssuanceDraft);
        if (step.startsWith("correct-form:")) return act.mutate({ action: "review_issued_field", documentFieldId: step.slice("correct-form:".length), decision: "correct", correctedValue: values["value"] ?? "" });
        if (step.startsWith("term-accept:")) return act.mutate({ action: "review_issued_term", proposalId: step.slice("term-accept:".length), decision: "accept" });
        if (step.startsWith("term-reject:")) return act.mutate({ action: "review_issued_term", proposalId: step.slice("term-reject:".length), decision: "reject" });
        if (step === "check") return act.mutate({ action: "run_issued_policy_check" });
        if (step.startsWith("resolve:")) return openForm(step as IssuanceDraft);
        if (step.startsWith("resolve-form:")) {
          return act.mutate({
            action: "resolve_issued_policy_difference", itemId: step.slice("resolve-form:".length),
            resolution: (values["resolution"] ?? "client_accepted_issued_value") as "client_accepted_issued_value",
            reason: values["reason"] ?? "", resolvedAt: iso(values["resolvedAt"]), evidenceNote: values["evidenceNote"] ?? "",
          });
        }
        if (step === "apply-open") return openForm("apply");
        if (step === "preview-form") {
          const [mode, policyId, periodId] = (values["target"] ?? "").split(":");
          const premiumBasis = values["premiumBasis"] === "gross" || values["premiumBasis"] === "total_payable" ? values["premiumBasis"] : undefined;
          if (mode !== "create" && mode !== "update") return setFailure("Choose whether to create a new policy or update one this client already has.");
          return previewing.mutate({ mode, ...(policyId ? { policyId } : {}), ...(periodId ? { periodId } : {}), ...(premiumBasis ? { premiumBasis } : {}) });
        }
        if (step === "apply" && preview !== null) {
          return act.mutate({
            action: "apply_issued_policy", mode: preview.mode,
            ...(preview.policyId ? { policyId: preview.policyId, periodId: preview.periodId } : {}),
            ...(preview.mode === "update" ? { expected: preview.view.expected } : {}),
            ...(preview.premiumBasis ? { premiumBasis: preview.premiumBasis } : {}),
            idempotencyKey: attempt.current,
          });
        }
        if (step.startsWith("confirm:")) return decide.mutate({ id: step.slice("confirm:".length), verb: "confirm" });
        if (step.startsWith("discard:")) return decide.mutate({ id: step.slice("discard:".length), verb: "discard" });
      }}
    />
  );
}
