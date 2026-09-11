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
import { PresenterBar } from "../demo/PresenterBar.js";
import { useDemo } from "../demo/state.js";

/**
 * The permanent shell, matching the approved demo (D-064): a 224px sidebar of white against the
 * wash carrying Discover · Ask ASAP · Work · Jobs · Automations, then Search and + New, then the
 * profile control (C01) — brokerage switcher, Members, Agreements, Client files, Sign out.
 *
 * Ask is both: a destination in the sidebar and the bar docked at the foot of every other screen,
 * so it is never more than one move away whatever a person is looking at. The Activity chip sits
 * on the dock's meta row. Under 900px the destinations become a bottom bar and the dock lifts
 * above it.
 */
export function Shell() {
  // The sidebar is fixed to the viewport; without this offset the presenter bar covers the brand.
  const { isDemo } = useDemo();
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
    <div className="min-h-screen bg-wash">
      <PresenterBar />
      <div className="min-[900px]:grid min-[900px]:grid-cols-[224px_1fr]">
      <aside
        className={`fixed bottom-0 left-0 z-20 hidden w-sidebar flex-col border-r border-line-soft bg-paper px-3.5 py-5 min-[900px]:flex ${
          isDemo ? "top-9" : "top-0"
        }`}
      >
        <div className="px-2 pb-5">{brand}</div>
        <ShellNav />
        <div className="mx-2 my-4 h-px bg-line-soft" />
        <div className="relative flex flex-col gap-0.5 px-2">
          <Link
            to="/search"
            className="rounded-compact px-2 py-2 text-sm font-semibold text-ink-secondary hover:bg-wash hover:text-ink"
          >
            Search
          </Link>
          <Link
            to="/new"
            className="rounded-compact px-2 py-2 text-sm font-semibold text-ink-secondary hover:bg-wash hover:text-ink"
          >
            + New
          </Link>
        </div>
        <div className="mt-auto">{profile}</div>
      </aside>

      <div className="flex min-h-screen flex-col min-[900px]:col-start-2">
        <header className={`sticky z-12 flex h-[58px] items-center gap-3 border-b border-line-soft bg-wash/90 px-4 backdrop-blur-md min-[900px]:hidden ${isDemo ? "top-9" : "top-0"}`}>
          {brand}
          <div className="ml-auto min-w-0 max-w-[60%]">{profile}</div>
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
    </div>
  );
}
