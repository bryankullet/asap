import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, describeApiError } from "../../lib/api.js";

/**
 * Filing a document, once.
 *
 * One implementation, used by the Documents Space and by first-use onboarding. It is a hook
 * rather than a copied block because every property that makes it safe is in the order of its
 * steps, and two copies of that order drift:
 *
 *  - the content hash first, so the same bytes in the same brokerage are the same document;
 *  - the row and its storage path allocated before any byte moves, so a file in the bucket
 *    always has a record explaining it, and a retry re-PUTs the same path rather than making a
 *    second document;
 *  - XHR rather than fetch, for the two things fetch cannot do — report how many bytes have
 *    actually gone, and be aborted mid-transfer;
 *  - and `documentFiled` afterwards, because the transfer goes straight to storage and the API
 *    cannot otherwise know it finished.
 *
 * A cancelled upload is neither a success nor a failure, and reads as neither.
 */
export function useDocumentUpload() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; sent: number; total: number } | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  /** The last file chosen, so a failed transfer can be sent again without re-picking it. */
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const inFlight = useRef<XMLHttpRequest | null>(null);

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

  return {
    error,
    progress,
    uploaded,
    canRetry,
    busy: upload.isPending,
    /** Send this file. Ignored while one is already going, so one press is one upload. */
    send: (file: File) => {
      if (!upload.isPending) upload.mutate(file);
    },
    /** Send the last one again. A retry cannot make a second document. */
    retry: () => {
      if (lastFile && !upload.isPending) upload.mutate(lastFile);
    },
    /** Stop the transfer itself, not merely stop watching it. */
    cancel: () => inFlight.current?.abort(),
  };
}
