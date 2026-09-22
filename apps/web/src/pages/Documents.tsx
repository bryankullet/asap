import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { SpaceFrameAction } from "@asap/schema";
import { documentListSpace, documentSpace } from "../live/ingestion-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { ApplyToRecord } from "../features/documents/ApplyToRecord.js";
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
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs("/documents");

  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; sent: number; total: number } | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  /** The last file chosen, so a failed transfer can be sent again without re-picking it. */
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const inFlight = useRef<XMLHttpRequest | null>(null);

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

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setLastFile(file);
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const contentSha256 = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const asked = await api.uploadDocument({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        contentSha256,
      });
      /* The same bytes in the same brokerage are the same document. Filing twice is not an upload. */
      if (asked.outcome === "already_on_file") return asked;

      /*
       * XHR rather than fetch, for two things fetch cannot do: report how many bytes have actually
       * gone, and be aborted mid-transfer.
       *
       * Retrying re-PUTs the same object path, so a retry cannot make a second document: the row
       * and its path were allocated once, before any byte moved.
       */
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        inFlight.current = xhr;
        xhr.open("PUT", asked.uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          // Only when the transport actually knows. `lengthComputable` false means no percentage.
          if (e.lengthComputable) setProgress({ name: file.name, sent: e.loaded, total: e.total });
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("The file store would not accept the file."));
        xhr.onerror = () => reject(new Error("The file store could not be reached."));
        xhr.onabort = () => reject(new Error("upload_cancelled"));
        xhr.send(bytes);
      }).finally(() => {
        inFlight.current = null;
        setProgress(null);
      });

      /*
       * The upload went straight to storage, so the API has not seen it and does not know it
       * finished. Telling it is what puts the document in the queue to be read.
       */
      const filed = await api.documentFiled(asked.document.id);
      return { ...asked, document: filed.document };
    },
    onMutate: () => {
      setError(null);
      setUploaded(null);
      setCanRetry(false);
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : describeApiError(e);
      /* A cancelled upload is neither a failure nor a success, and must not read as either. */
      const cancelled = message === "upload_cancelled";
      setError(cancelled ? "Upload cancelled. Nothing was filed." : `${message} Nothing was filed.`);
      // Only a failed transfer is retryable. A cancelled one was a decision, not a fault.
      setCanRetry(!cancelled);
    },
    onSuccess: (res) => {
      setUploaded(
        res.outcome === "already_on_file"
          ? `${res.document.filename} was already on file — nothing was filed twice.`
          : `${res.document.filename} is on file. ASAP reads it next; nothing is treated as known until you accept it.`,
      );
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const space = documentListSpace(live.data, {
    loading: live.isLoading,
    error: error ?? (live.isError ? describeApiError(live.error) : null),
    busy: upload.isPending,
    progress,
    uploaded,
    canRetry,
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
        if (step === "pick" && files[0] && !upload.isPending) upload.mutate(files[0]);
        if (step === "retry" && lastFile && !upload.isPending) upload.mutate(lastFile);
        if (step === "cancel") inFlight.current?.abort();
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
