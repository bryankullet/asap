import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type {
  ImportCommitResponse,
  ImportPreviewResponse,
  PremiumBasis,
  SpaceFrameAction,
} from "@asap/schema";
import { importSpace } from "../live/ingestion-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Import, through the one Space renderer.
 *
 * The pipeline is unchanged and every step of it is still real: the bytes go to the server, the
 * server reads them, every row comes back with what it would do, a person leaves rows out or
 * answers which client an ambiguous one is, and only a confirmation writes anything.
 *
 * What changed is the presentation. `Page`, `ScreenTitle` and the old card system are gone; the
 * file, what was found, every row, what cannot be written and the confirmation are registered
 * blocks.
 */
export function ImportBook() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs("/import");

  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [receipt, setReceipt] = useState<ImportCommitResponse | null>(null);
  const [skipped, setSkipped] = useState<number[]>([]);
  /* What a premium column means. Asked, never inferred: gross and total payable differ by levies. */
  const [premiumBasis, setPremiumBasis] = useState<PremiumBasis | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* The server's own limits, so the picker can refuse a file before a person waits for it. */
  const documents = useQuery({
    queryKey: ["documents", me.data?.active_organization?.id],
    queryFn: () => api.documents(),
    enabled: Boolean(me.data?.active_organization?.id),
    retry: false,
  });

  useEffect(() => {
    tabs.open({
      spaceType: "route",
      recordType: "import",
      recordId: "import",
      kind: "IMPORT",
      title: "Bring records into ASAP",
      path: "/import",
    });
  }, []);

  const read = useMutation({
    mutationFn: (input: { filename: string; content: string; mimeType: string; premiumBasis: PremiumBasis | null }) =>
      api.previewImport(input),
    onMutate: () => {
      setError(null);
      setReceipt(null);
    },
    onError: (e) => setError(describeApiError(e)),
    onSuccess: (res) => {
      setPreview(res);
      setSkipped([]);
    },
  });

  /*
   * The write. `skipLineNumbers` carries what a person chose to leave out, and the batch id makes
   * a second commit of the same batch a repeat rather than a second import — which is what makes a
   * double click safe.
   */
  const commit = useMutation({
    mutationFn: () => api.commitImport(preview!.batch.id, { skipLineNumbers: skipped }),
    onMutate: () => setError(null),
    onError: (e) => setError(describeApiError(e)),
    onSuccess: (res) => {
      setReceipt(res);
      setPreview(null);
      void qc.invalidateQueries();
    },
  });

  /** The file's bytes, chunked so a few megabytes do not blow `String.fromCharCode`'s limit. */
  async function readFile(f: File) {
    setError(null);
    setPreview(null);
    setReceipt(null);
    try {
      const buffer = new Uint8Array(await f.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 8192) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
      }
      read.mutate({
        filename: f.name,
        content: btoa(binary),
        mimeType: f.type || "application/octet-stream",
        premiumBasis,
      });
    } catch {
      setError("That file could not be read from your computer. Try choosing it again.");
    }
  }

  const space = importSpace(preview ?? undefined, receipt ?? undefined, {
    busy: read.isPending || commit.isPending,
    error,
    limits: documents.data?.limits ?? null,
    skipped,
    premiumBasis,
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

        if (step === "pick" && files[0]) {
          void readFile(files[0]);
          return;
        }
        if (step === "commit") {
          // Disabled while in flight, so a second click cannot start a second write.
          if (!commit.isPending && preview) commit.mutate();
          return;
        }
        if (step.startsWith("skip:")) {
          const line = Number(step.slice("skip:".length));
          setSkipped((s) => (s.includes(line) ? s : [...s, line]));
          return;
        }
        if (step.startsWith("unskip:")) {
          const line = Number(step.slice("unskip:".length));
          setSkipped((s) => s.filter((n) => n !== line));
          return;
        }
        if (step === "basis") {
          const chosen = (action as SpaceFrameAction & { values?: Record<string, string> }).values
            ?.['premiumBasis'];
          setPremiumBasis(chosen === "gross" || chosen === "total_payable" ? chosen : null);
        }
      }}
    />
  );
}
