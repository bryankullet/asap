import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { connectionsSpace } from "../live/connections-space.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";

/**
 * Data and connections, as a Space.
 *
 * Nothing here ever claims a mailbox is attached when it is not. "Connect" begins a real OAuth
 * flow at the provider's own page; until the provider sends the person back and a row exists, the
 * mailbox is honestly not connected, and there is no state in between.
 *
 * Reading is now real, and so every word about it comes from a row: "Syncing" means a run row
 * says `running`, "Sync stopped" means one failed and its reason is on it, and a last-synced time
 * means a pass finished cleanly. The browser infers none of it — which is what stops the word
 * appearing before the mechanism, and what stopped it appearing while there was none.
 */
export function Connections() {
  const me = useMe();
  const qc = useQueryClient();
  const tabs = useWorkspaceTabs("/settings/connections");
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  /* What is actually connected, from the brokerage's own rows. Never a token. */
  const live = useQuery({
    queryKey: ["mailboxes", me.data?.active_organization?.id],
    enabled: Boolean(me.data?.active_organization?.id),
    queryFn: () => api.mailboxes(),
  });

  const connect = useMutation({
    mutationFn: (provider: "gmail" | "microsoft") => api.connectMailbox(provider),
    onSuccess: (res) => {
      if (res.outcome === "authorise") {
        // The provider's own page. Nothing is connected until it sends the person back.
        window.location.assign(res.url);
        return;
      }
      setNotConfigured(res.reason);
    },
  });
  /*
   * Asking for a pass. It returns immediately: the reading is worker work, and what the screen
   * then shows is the run row, not a guess about how long it will take.
   */
  const sync = useMutation({
    mutationFn: (id: string) => api.syncMailbox(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mailboxes"] }),
    onError: (e) => setNotConfigured(describeApiError(e)),
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => api.disconnectMailbox(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mailboxes"] }),
  });

  useEffect(() => {
    tabs.open({
      spaceType: "route",
      recordType: "connections",
      recordId: "connections",
      kind: "CONNECTIONS",
      title: "Connections",
      path: "/settings/connections",
    });
  }, []);

  const space = connectionsSpace(
    live.data,
    { loading: live.isLoading, error: live.isError ? describeApiError(live.error) : null },
    notConfigured,
  );

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        /*
         * Both verbs go through the API. `prepare` starts the authorisation the server owns — the
         * state parameter is the server's and single-use — and `exception` removes the connection.
         * Neither is performed by the block that offered it.
         */
        const [what, id] = (action.stepId ?? "").split(":");
        if (what === "connect" && (id === "gmail" || id === "microsoft")) connect.mutate(id);
        if (what === "mailbox" && id !== undefined) disconnect.mutate(id);
        if (what === "sync" && id !== undefined) sync.mutate(id);
      }}
    />
  );
}
