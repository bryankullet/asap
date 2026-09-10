import { useMutation } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { Page } from "@asap/ui";
import { api } from "../lib/api.js";
import { useInvalidateMe, useMe } from "../lib/me.js";
import { useRuns } from "../lib/queries.js";
import { supabase } from "../lib/supabase.js";
import { ActivityChip } from "./ActivityChip.js";
import { AskComposer } from "./AskComposer.js";
import { ProfileMenu } from "./ProfileMenu.js";
import { ShellNav } from "./ShellNav.js";

/**
 * The permanent shell (UI Build Spec v1 Part 1), in the v4 prototype's frame: a 224px sidebar of
 * white against the wash, Today · Work · Automations, Search and + New, and the profile control
 * (C01) at the bottom, which opens the brokerage switcher, Members, Agreements, Client files and
 * Sign out. Ask is the docked bar at the foot of the workspace, reachable from every screen; the
 * Activity chip sits on its meta row. Under 900px the destinations become a bottom bar and the
 * dock lifts above it.
 */
export function Shell() {
  const me = useMe();
  const invalidate = useInvalidateMe();
  const org = me.data?.active_organization;
  const runs = useRuns(org?.id);
  const [sessionStart] = useState(() => new Date());
  const switchOrg = useMutation({
    mutationFn: api.setActiveOrganization,
    onSuccess: () => void invalidate(),
  });

  const profile = (
    <ProfileMenu
      me={me.data}
      switching={switchOrg.isPending}
      onSwitch={(id) => switchOrg.mutate(id)}
      onSignOut={() => void supabase.auth.signOut()}
    />
  );

  const brand = (
    <Link
      to="/discover"
      className="flex items-center gap-2.5 font-heading text-base font-bold tracking-[0.15em] text-ink"
    >
      <span
        aria-hidden
        className="grid h-[34px] w-[34px] place-items-center rounded-compact bg-navy text-[#f0c75e]"
      >
        A
      </span>
      ASAP
    </Link>
  );

  return (
    <div className="min-h-screen bg-wash min-[900px]:grid min-[900px]:grid-cols-[224px_1fr]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-sidebar flex-col border-r border-line-soft bg-paper px-3.5 py-5 min-[900px]:flex">
        <div className="px-2 pb-5">{brand}</div>
        <ShellNav />
        <div className="mx-2 my-4 h-px bg-line-soft" />
        <div className="flex flex-col gap-0.5 px-2">
          <Link
            to="/work"
            search={{ view: "recent" }}
            className="rounded-compact px-2 py-2 text-sm font-semibold text-ink-secondary hover:bg-wash hover:text-ink"
          >
            Search
          </Link>
          <span
            className="rounded-compact px-2 py-2 text-sm font-semibold text-ink-muted"
            title="Creating records arrives with import in a later phase"
          >
            + New
          </span>
        </div>
        <div className="mt-auto">{profile}</div>
      </aside>

      <div className="flex min-h-screen flex-col min-[900px]:col-start-2">
        <header className="sticky top-0 z-12 flex h-[58px] items-center gap-3 border-b border-line-soft bg-wash/90 px-4 backdrop-blur-md min-[900px]:hidden">
          {brand}
          <div className="ml-auto">{profile}</div>
        </header>
        <main className="flex-1 pb-[190px] min-[900px]:pb-[210px]">
          <Page>
            <Outlet />
          </Page>
        </main>

        <div className="fixed bottom-[86px] left-1/2 z-25 w-[calc(100vw-1rem)] -translate-x-1/2 min-[900px]:bottom-4 min-[900px]:left-[calc(var(--spacing-sidebar)+(100vw-var(--spacing-sidebar))/2)] min-[900px]:w-[min(800px,calc(100vw-var(--spacing-sidebar)-3rem))]">
          <div className="mb-2 flex items-center justify-end gap-2">
            <ActivityChip runs={runs.data ?? []} sessionStart={sessionStart} />
          </div>
          <AskComposer />
        </div>

        <footer className="fixed inset-x-0 bottom-0 z-28 h-16 border-t border-line-strong bg-paper/95 p-1.5 backdrop-blur-sm min-[900px]:hidden">
          <ShellNav orientation="horizontal" />
        </footer>
      </div>
    </div>
  );
}
