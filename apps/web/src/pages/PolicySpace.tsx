import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { policySpace } from "../live/policy-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * One policy and its periods (4C-1).
 *
 * Everything on the screen is the server's reading of the policy: cover state and its evidence,
 * which period is being read, each value's source, the Work and the actions. The browser keeps
 * only the period in the address — so a refresh reads the same period — and a receipt or refusal
 * the server just gave.
 */
export function PolicySpace() {
  const { policyId = "" } = useParams({ strict: false }) as { policyId?: string };
  const { period } = useSearch({ strict: false }) as { period?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tabs = useWorkspaceTabs(`/policies/${policyId}`);
  const [notice, setNotice] = useState<{ tone: "done" | "attention"; text: string } | null>(null);

  const live = useQuery({ queryKey: ["policy-space", policyId, period ?? null], queryFn: () => api.policySpace(policyId, period), retry: false });

  const renewal = useMutation({
    mutationFn: () => api.startPolicyRenewal(policyId),
    onSuccess: (r) => {
      setNotice(r.outcome === "blocked" ? { tone: "attention", text: r.reason ?? "The renewal could not be started." } : { tone: "done", text: r.receipt ?? "Done." });
      void qc.invalidateQueries({ queryKey: ["policy-space", policyId] });
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => setNotice({ tone: "attention", text: describeApiError(e) }),
  });
  const decide = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: "confirm" | "discard" }) => (verb === "confirm" ? api.confirmPreparedAction(id) : api.discardPreparedAction(id)),
    onSuccess: (res) => {
      setNotice(res.outcome === "refused" ? { tone: "attention", text: res.reason ?? "It was not run." } : { tone: "done", text: res.action?.receipt?.message ?? "Done." });
      void qc.invalidateQueries({ queryKey: ["policy-space", policyId] });
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => setNotice({ tone: "attention", text: describeApiError(e) }),
  });

  const title = live.data?.title;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({ spaceType: "policy", recordType: "policy", recordId: policyId, kind: "POLICY", title, path: `/policies/${policyId}` });
  }, [title, policyId]);

  const status = live.error instanceof ApiRequestError ? live.error.status : null;
  const space = policySpace(
    live.data,
    {
      loading: live.isPending,
      missing: status === 404,
      refused: status === 403 ? describeApiError(live.error) : null,
      error: live.isError && status !== 404 && status !== 403 ? describeApiError(live.error) : null,
      busy: renewal.isPending || decide.isPending,
    },
    policyId,
  );
  if (notice !== null && space.state === "ready") {
    space.blocks.unshift({ id: "notice", type: "note", label: null, evidence: [], actions: [], state: "ready", stateNote: null, tone: notice.tone, title: notice.tone === "done" ? "Recorded" : "That was not done", text: notice.text });
  }

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        if (renewal.isPending || decide.isPending) return;
        const step = action.stepId ?? "";
        if (step === "start-renewal") return renewal.mutate();
        if (step.startsWith("confirm:")) return decide.mutate({ id: step.slice("confirm:".length), verb: "confirm" });
        if (step.startsWith("discard:")) return decide.mutate({ id: step.slice("discard:".length), verb: "discard" });
      }}
    />
  );
}
