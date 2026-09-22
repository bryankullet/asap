import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import type { SpaceFrameAction } from "@asap/schema";
import { documentListSpace, documentSpace } from "../live/ingestion-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { ApplyToRecord } from "../features/documents/ApplyToRecord.js";
import { useDocumentUpload } from "../features/documents/upload.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Documents, through the one Space renderer.
 *
 * The upload is unchanged and deliberately so: a hash first, so the same bytes are never filed
 * twice; a row allocated before any byte moves, so a file in storage always has a record
 * explaining it; XHR rather than fetch, because a person uploading a 30MB scan on a mobile
 * connection needs real byte progress and a way to stop; and `documentFiled` afterwards, because
 * the transfer goes straight to storage and the API cannot otherwise know it finished.
 */
export function Documents() {
  const me = useMe();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs("/documents");

  const upload = useDocumentUpload();

  const live = useQuery({
    queryKey: ["documents", me.data?.active_organization?.id],
    queryFn: () => api.documents(),
    enabled: Boolean(me.data?.active_organization?.id),
    retry: false,
  });

  useEffect(() => {
    tabs.open({
      spaceType: "document",
      recordType: "organization",
      recordId: "documents",
      kind: "DOCUMENTS",
      title: "Documents",
      path: "/documents",
    });
  }, []);

  const space = documentListSpace(live.data, {
    loading: live.isLoading,
    error: upload.error ?? (live.isError ? describeApiError(live.error) : null),
    busy: upload.busy,
    progress: upload.progress,
    uploaded: upload.uploaded,
    canRetry: upload.canRetry,
  });

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        const step = action.stepId ?? "";
        const files = (action as SpaceFrameAction & { files?: File[] }).files ?? [];
        if (step === "pick" && files[0]) upload.send(files[0]);
        if (step === "retry") upload.retry();
        if (step === "cancel") upload.cancel();
      }}
    />
  );
}

/**
 * One document, as its own tab.
 *
 * Keyed by the document's id, so opening the same document twice focuses the tab that is already
 * there rather than making a second one.
 */
/**
 * One document, as its own tab.
 *
 * Keyed by the document's id, so opening the same document twice focuses the tab that is already
 * there rather than making a second one.
 *
 * Applying keeps its own component. `ApplyToRecord` carries per-field ticking and per-field
 * correction before a write — a person may apply the policy number and not the premium, and may
 * fix a misread digit on the way — and no registered block expresses either. Rebuilding it out of
 * blocks would have cost those capabilities, so it sits below the Space rather than inside it, and
 * that is a known piece of unfinished conversion rather than a claim that it is done.
 */
export function DocumentViewer() {
  const { documentId = "" } = useParams({ strict: false }) as { documentId?: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs(`/documents/${documentId}`);

  const detail = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.document(documentId),
    retry: false,
  });

  const title = detail.data?.document.filename;
  useEffect(() => {
    if (title === undefined) return;
    tabs.open({
      spaceType: "document",
      recordType: "document",
      recordId: documentId,
      kind: "DOCUMENT",
      title,
      path: `/documents/${documentId}`,
    });
  }, [title, documentId]);

  const review = useMutation({
    mutationFn: (input: { fieldId: string; decision: "accept" | "correct" | "reject"; value: string | null }) =>
      api.reviewDocumentField(documentId, input.fieldId, {
        decision: input.decision,
        value: input.value,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["document", documentId] }),
  });

  const retry = useMutation({
    mutationFn: () => api.retryExtraction(documentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["document", documentId] }),
  });

  const space = documentSpace(
    detail.data,
    {
      loading: detail.isPending,
      error: detail.isError ? describeApiError(detail.error) : null,
      missing: !detail.isPending && !detail.isError && detail.data === undefined,
      busy: review.isPending || retry.isPending,
    },
    documentId,
  );

  return (
    <>
      <SpaceFrameView
        space={space}
        onAct={(action) => {
          if (action.verb === "open" && action.to) {
            /* The original file is a signed URL, not a route: it opens rather than navigates. */
            if (action.to.path.startsWith("http")) window.open(action.to.path, "_blank", "noopener");
            else void navigate({ to: action.to.path });
            return;
          }
          const step = action.stepId ?? "";
          // One decision at a time, so a double click cannot record two.
          if (review.isPending || retry.isPending) return;

          if (step === "retry") {
            retry.mutate();
            return;
          }
          if (step.startsWith("accept:")) {
            review.mutate({ fieldId: step.slice("accept:".length), decision: "accept", value: null });
            return;
          }
          if (step.startsWith("reject:")) {
            review.mutate({ fieldId: step.slice("reject:".length), decision: "reject", value: null });
            return;
          }
          if (step.startsWith("correct:")) {
            const fieldId = step.slice("correct:".length);
            const field = detail.data?.fields.find((f) => f.id === fieldId);
            const typed = window.prompt(
              "What should this value be? ASAP keeps what it read as well as what you say.",
              field?.correctedValue ?? field?.proposedValue ?? "",
            );
            if (typed !== null && typed.trim() !== "") {
              review.mutate({ fieldId, decision: "correct", value: typed.trim() });
            }
          }
        }}
      />
      {detail.data && (
        <div className="sp-blocks">
          <ApplyToRecord documentId={documentId} />
        </div>
      )}
    </>
  );
}
