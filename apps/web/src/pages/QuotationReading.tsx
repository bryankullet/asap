import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { QuotationReviewAction } from "@asap/schema";
import { quotationReadingSpace } from "../live/quotation-reading-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Reviewing what ASAP read from a quotation (4B-3A).
 *
 * The screen a person uses to turn a reading into a term, or to say it is not one. Every decision
 * goes to the server as a typed action; nothing is confirmed in the browser, and the reading
 * shown always comes back from the server afterwards.
 */
export function QuotationReading() {
  const { documentId = "" } = useParams({ strict: false }) as { documentId?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tabs = useWorkspaceTabs(`/documents/${documentId}/quotation`);
  const [failure, setFailure] = useState<string | null>(null);

  const live = useQuery({
    queryKey: ["quotation-reading", documentId],
    queryFn: () => api.quotationReading(documentId),
    retry: false,
  });

  const act = useMutation({
    mutationFn: (input: QuotationReviewAction) => api.quotationReview(documentId, input),
    onSuccess: (res) => {
      if (res.reading) qc.setQueryData(["quotation-reading", documentId], res.reading);
      /* Confirming a term changes the quote, so any comparison of it is behind. */
      void qc.invalidateQueries({ queryKey: ["comparison"] });
      void qc.invalidateQueries({ queryKey: ["opportunity"] });
      setFailure(res.outcome === "blocked" ? res.reason : null);
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  const filename = live.data?.document.filename;
  useEffect(() => {
    if (filename === undefined) return;
    tabs.open({
      spaceType: "document",
      recordType: "document",
      recordId: documentId,
      kind: "QUOTATION",
      title: filename,
      path: `/documents/${documentId}/quotation`,
    });
  }, [filename, documentId]);

  const notFound = live.isError && live.error instanceof ApiRequestError && live.error.status === 404;
  const space = quotationReadingSpace(
    live.data,
    {
      loading: live.isPending,
      error: notFound ? null : (failure ?? (live.isError ? describeApiError(live.error) : null)),
      missing: notFound,
      busy: act.isPending,
    },
    documentId,
  );

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        // One decision at a time, so a double click cannot review twice.
        if (act.isPending) return;
        const step = action.stepId ?? "";
        if (step.startsWith("accept:")) {
          act.mutate({ action: "accept_proposal", proposalId: step.slice("accept:".length) });
          return;
        }
        if (step.startsWith("reject:")) {
          act.mutate({ action: "reject_proposal", proposalId: step.slice("reject:".length) });
        }
      }}
    />
  );
}
