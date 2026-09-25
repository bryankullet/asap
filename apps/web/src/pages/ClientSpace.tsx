import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clientSpace } from "../live/client-space.js";
import { ApiRequestError, api, describeApiError } from "../lib/api.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * One client, as its own tab (D-083).
 *
 * Keyed by the client's id, so opening the same client twice focuses the tab that is already
 * there — and two clients open at once are two tabs with two Spaces, two queries and two record
 * identities. Nothing is held in a module-level variable that a second client could overwrite.
 */
export function ClientSpace() {
  const { clientId = "" } = useParams({ strict: false }) as { clientId?: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs(`/clients/${clientId}`);
  const [failure, setFailure] = useState<string | null>(null);

  const live = useQuery({
    queryKey: ["client_space", clientId],
    queryFn: () => api.clientSpace(clientId),
    retry: false,
  });

  /* The tab is named after the client, once the name is known. Never "Client Space". */
  const name = live.data?.client.name;
  useEffect(() => {
    if (name === undefined) return;
    tabs.open({
      spaceType: "client",
      recordType: "client",
      recordId: clientId,
      kind: "CLIENT",
      title: name,
      path: `/clients/${clientId}`,
    });
  }, [name, clientId]);

  /*
   * Starting work goes through the same contract the rest of the product uses, with the client's
   * own id — never a name typed into a box, which is how two clients called Otieno become one.
   */
  /*
   * One request key for the life of this Space, so a double-clicked "Start a quotation" is one
   * opportunity however slow the first response is.
   */
  const [quotationKey] = useState(() => crypto.randomUUID());
  const startQuotation = useMutation({
    mutationFn: () =>
      api.createOpportunity({
        clientId,
        title: `${live.data?.client.name ?? "Client"} — quotation`,
        /* The class is the client's to say; the form on the opportunity asks for the rest. */
        classOfBusiness: "General",
        requestKey: quotationKey,
      }),
    onSuccess: (res) =>
      void navigate({ to: "/opportunities/$opportunityId", params: { opportunityId: res.opportunityId } }),
    onError: (e) => setFailure(describeApiError(e)),
  });

  const start = useMutation({
    mutationFn: () => api.createWorkItem({ kind: "renewal", clientId, insurers: [] }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["client_space", clientId] });
      if (res.outcome === "opened") {
        void navigate({ to: `/r/${res.item.id}` });
        return;
      }
      /*
       * Every other outcome is the server declining to guess, and it is reported in its own
       * words rather than smoothed into a success. `ambiguous` and `no_client` cannot happen
       * here — the client is named by id — but they are answered honestly if they ever do.
       */
      setFailure(
        res.outcome === "no_policy"
          ? "This client has no policy on file, so there is nothing to renew."
          : "ASAP could not start that without more detail. Open it from + New instead.",
      );
    },
    onError: (e) => setFailure(describeApiError(e)),
  });

  /*
   * "Not here" is a state, not an error. It is read from the status code rather than from the
   * message, so a reworded server sentence cannot turn a missing client into a red failure.
   */
  const notFound = live.isError && live.error instanceof ApiRequestError && live.error.status === 404;

  const space = clientSpace(
    live.data,
    {
      loading: live.isPending,
      error: notFound ? null : (failure ?? (live.isError ? describeApiError(live.error) : null)),
      missing: notFound,
      busy: start.isPending || startQuotation.isPending,
    },
    clientId,
  );

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        if (action.verb === "open" && action.to) {
          void navigate({ to: action.to.path });
          return;
        }
        // One thing at a time, so a double click cannot start two pieces of work.
        if (start.isPending) return;
        setFailure(null);
        const step = action.stepId ?? "";
        /*
         * A renewal needs only the client, so it starts here. A claim needs the incident and an
         * endorsement needs the request in the client's own words — neither of which this Space
         * knows, and neither of which it will invent — so those open the real creation form.
         */
        if (step === "start:quotation") startQuotation.mutate();
        if (step === "start:renewal") start.mutate();
        if (step === "start:claim") void navigate({ to: "/new/$kind", params: { kind: "claim" } });
        if (step === "start:endorsement") void navigate({ to: "/new/$kind", params: { kind: "endorsement" } });
        /* A gap action is disabled and carries its reason; pressing it does nothing by design. */
      }}
    />
  );
}
