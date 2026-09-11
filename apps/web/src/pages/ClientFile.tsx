import type { ClientFileAction } from "@asap/schema";
import { Notice } from "@asap/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { api, describeApiError } from "../lib/api.js";
import { Contacts } from "../features/contacts/Contacts.js";
import { ClientFileView } from "../views/ClientFileView.js";

export function ClientFile() {
  const { clientId = "" } = useParams({ strict: false }) as { clientId?: string };
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["client_file", clientId],
    queryFn: () => api.clientFile(clientId),
    retry: false,
  });
  const [blocked, setBlocked] = useState<{ guard: string; reason: string } | null>(null);
  const act = useMutation({
    mutationFn: (a: ClientFileAction) => api.clientFileAct(clientId, a),
    onSuccess: (res) => {
      setBlocked(res.outcome === "blocked" ? { guard: res.guard, reason: res.reason } : null);
      qc.setQueryData(["client_file", clientId], res.file);
      void qc.invalidateQueries({ queryKey: ["client_files"] });
    },
  });
  if (q.isPending) return <LoadingList rows={2} label="Loading client file" />;
  if (q.isError)
    return (q.error as { status?: number }).status === 404 ? (
      <MissingData
        what="No client with that id"
        why="It may not exist, or your role cannot see it."
      />
    ) : (
      <ErrorState what="The file could not load" retry={() => void q.refetch()} />
    );
  return (
    <>
      {act.isError && <Notice tone="error">{describeApiError(act.error)}</Notice>}
      {/* Who the brokerage actually writes to. Beside the file, because that is where a person
          looks for it and where the compliance work happens. */}
      <Contacts clientId={clientId} />
      <ClientFileView
        file={q.data}
        onAct={(a) => act.mutate(a)}
        pending={act.isPending}
        blocked={blocked}
      />
    </>
  );
}
