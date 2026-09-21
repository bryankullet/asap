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
 * What this Space also does is name the gap: authorising records the connection, and **nothing
 * reads the mailbox yet** — there is no endpoint, no worker job, and nothing writes
 * `last_synced_at`. A "Syncing" badge would be a word with no mechanism behind it.
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
      }}
    />
  );
}
