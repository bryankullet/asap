import { Badge, Button, Select } from "@asap/ui";
import { useMutation } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router";
import { api } from "../lib/api.js";
import { useInvalidateMe, useMe } from "../lib/me.js";
import { supabase } from "../lib/supabase.js";

/**
 * Phase 1 shell: plain layout with the organization switcher and the signed-in user.
 * The permanent Discover · Spaces · Jobs · Automations shell arrives in Phase 4 — do not add
 * entity navigation here (§45 rule 16).
 */
export function Shell() {
  const me = useMe();
  const invalidate = useInvalidateMe();
  const switchOrg = useMutation({
    mutationFn: api.setActiveOrganization,
    onSuccess: () => void invalidate(),
  });

  const activeMemberships = me.data?.memberships.filter((m) => m.status === "active") ?? [];

  return (
    <div className="min-h-screen bg-wash">
      <header className="border-b border-line-soft bg-paper">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-3">
          <Link to="/" className="font-heading text-xl font-semibold text-ink">
            ASAP
          </Link>

          {activeMemberships.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink-secondary">
              <span className="sr-only">Brokerage</span>
              <Select
                aria-label="Active brokerage"
                className="w-auto min-w-48"
                value={me.data?.active_organization?.id ?? ""}
                disabled={switchOrg.isPending}
                onChange={(e) => switchOrg.mutate(e.target.value)}
              >
                {!me.data?.active_organization && <option value="">Choose a brokerage…</option>}
                {activeMemberships.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </Select>
              {me.data?.active_organization && (
                <Badge tone="active">
                  {
                    activeMemberships.find(
                      (m) => m.organization.id === me.data?.active_organization?.id,
                    )?.role.name
                  }
                </Badge>
              )}
            </label>
          )}

          <nav className="ml-auto flex items-center gap-3 text-sm">
            <NavLink
              to="/members"
              className={({ isActive }) =>
                isActive ? "font-medium text-ink" : "text-ink-secondary hover:text-ink"
              }
            >
              Members
            </NavLink>
            <span className="text-ink-muted" title={me.data?.user.email}>
              {me.data?.user.full_name ?? me.data?.user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
