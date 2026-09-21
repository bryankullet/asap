import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { todaySpace } from "../live/space-adapters.js";
import { can, useMe } from "../lib/me.js";
import { useAttention } from "../lib/queries.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";
import { useWorkspaceTabs } from "../shell/workspace-tabs.js";

/**
 * Today — "What matters now".
 *
 * There is no layout in this file, and that is the point: Today is a `SpaceFrame` produced by
 * `todaySpace()` from `GET /attention`, rendered by the one renderer every screen uses. The
 * legacy page frame — `Page`, `ScreenTitle`, their own header and content width — is gone from
 * here; a new shell around an old page design is not parity.
 *
 * Every row comes from the real attention API, ranked and scored on the server from the
 * brokerage's own rows, and opens the record-specific Space the server named in `links`. Nothing
 * on this screen is composed in React and nothing is written by a model.
 */
export function Today() {
  const me = useMe();
  const orgId = me.data?.active_organization?.id;
  const live = useAttention(orgId);
  const navigate = useNavigate();
  const tabs = useWorkspaceTabs("/today");

  /*
   * Today is a Space, so it is a tab: opening it puts it on the strip and in Recent, exactly as
   * opening a client does. It is registered once the API answers, so a tab never outlives a
   * Space that could not be read.
   */
  const ready = live.data !== undefined;
  useEffect(() => {
    if (!ready) return;
    tabs.open({
      spaceType: "today",
      recordType: "organization",
      recordId: "today",
      kind: "TODAY",
      title: "What matters now",
      path: "/today",
    });
    /*
     * Keyed on `ready` alone, deliberately. `open` is a stable callback over a module-level store
     * and re-opening an already-open tab is a no-op, so the only thing that should re-run this is
     * the Space becoming readable.
     */
  }, [ready]);

  const space = todaySpace(live.data, {
    loading: live.isLoading,
    error: live.isError,
  });

  return (
    <SpaceFrameView
      space={space}
      onAct={(action) => {
        /*
         * Today offers navigation only. Every business verb belongs to the record's own Space,
         * where the guards, the evidence and the frozen payload are — a list is the wrong place
         * to change anything, because a misclick there changes the wrong item.
         */
        if (action.verb === "open" && action.to) void navigate({ to: action.to.path });
      }}
    />
  );
}

/** Whether this person may change who owns work. Resolved from the session, never from the URL. */
export function useCanAssign(): boolean {
  const me = useMe();
  return can(me.data, "work_item", "assign");
}
