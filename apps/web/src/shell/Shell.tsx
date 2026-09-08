import { Button, Select } from "@asap/ui";
import { useMutation } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../lib/api.js";
import { useInvalidateMe, useMe } from "../lib/me.js";
import { useRuns } from "../lib/queries.js";
import { supabase } from "../lib/supabase.js";
import { ActivityChip } from "./ActivityChip.js";
import { AskComposer } from "./AskComposer.js";
import { ShellNav } from "./ShellNav.js";

/**
 * The permanent shell (UI Build Spec v1 Part 1): a 224px sidebar with Today · Work · Automations,
 * Ask, the Activity chip, utilities, and the person and brokerage at the bottom. Under 900px the
 * destinations become a bottom bar and Ask stays reachable at the top.
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
  const activeMemberships = me.data?.memberships.filter((m) => m.status === "active") ?? [];

  const person = (
    <div className="flex flex-col gap-2 text-sm">
      {activeMemberships.length > 0 && (
        <Select
          aria-label="Active brokerage"
          value={org?.id ?? ""}
          disabled={switchOrg.isPending}
          onChange={(e) => switchOrg.mutate(e.target.value)}
        >
          {!org && <option value="">Choose a brokerage…</option>}
          {activeMemberships.map((m) => (
            <option key={m.organization.id} value={m.organization.id}>
              {m.organization.name}
            </option>
          ))}
        </Select>
      )}
      <span className="truncate text-ink-muted" title={me.data?.user.email}>
        {me.data?.user.full_name ?? me.data?.user.email}
      </span>
      <div className="flex gap-2">
        <Link to="/settings/members" className="text-ink-secondary hover:text-ink">
          Settings
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-wash min-[900px]:grid min-[900px]:grid-cols-[224px_1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-line-soft bg-paper p-4 min-[900px]:flex">
        <Link to="/today" className="font-heading text-xl font-semibold text-ink">
          ASAP
        </Link>
        <ShellNav />
        <AskComposer />
        <ActivityChip runs={runs.data ?? []} sessionStart={sessionStart} />
        <div className="flex gap-2 text-sm">
          <Link
            to="/work"
            search={{ view: "recent" }}
            className="text-ink-secondary hover:text-ink"
          >
            Search
          </Link>
          <span
            className="text-ink-muted"
            title="Creating records arrives with import in a later phase"
          >
            + New
          </span>
        </div>
        <div className="mt-auto">{person}</div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="flex items-center gap-3 border-b border-line-soft bg-paper px-4 py-2 min-[900px]:hidden">
          <Link to="/today" className="font-heading text-lg font-semibold text-ink">
            ASAP
          </Link>
          <div className="flex-1">
            <AskComposer />
          </div>
          <ActivityChip runs={runs.data ?? []} sessionStart={sessionStart} />
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-24 min-[900px]:px-8 min-[900px]:pb-8">
          <Outlet />
        </main>
        <footer className="fixed inset-x-0 bottom-0 border-t border-line-soft bg-paper p-2 min-[900px]:hidden">
          <ShellNav orientation="horizontal" />
        </footer>
      </div>
    </div>
  );
}
