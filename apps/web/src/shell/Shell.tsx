import { useMutation } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../lib/api.js";
import { useInvalidateMe, useMe } from "../lib/me.js";
import { useRunList, useWorkList } from "../lib/queries.js";
import { supabase } from "../lib/supabase.js";
import { NAV } from "./nav.js";

import { ProfileMenu } from "./ProfileMenu.js";

/**
 * The permanent shell, ported from the approved demo (D-064).
 *
 * Structure and dimensions are the demo's, not an interpretation of it: a `228px 1fr` grid
 * filling the viewport. The sidebar is `#f1f4f0` with a
 * `#e0e5e0` right border; each destination is a 42px row with a 13px radius, and the active one is
 * a white pill with a 1px shadow. Under 900px the sidebar becomes a 58px bottom bar, as it does
 * there.
 *
 * The demo is a fixed-height application — its body does not scroll, the panes do — so `demo-body`
 * is applied to `document.body` while the shell is mounted and removed when it unmounts.
 *
 * What is *not* the demo's: routing, the session, the organization switcher and the data behind
 * every screen. Those stay.
 */
export function Shell() {
  const me = useMe();
  const invalidate = useInvalidateMe();
  const org = me.data?.active_organization;
  const path = useRouterState({ select: (s) => s.location.pathname });

  const switchOrg = useMutation({
    mutationFn: api.setActiveOrganization,
    onSuccess: () => void invalidate(),
  });

  // The demo's body rules: no page scroll, its own background and type. Scoped to the shell so
  // sign-in and the onboarding screens are untouched.
  useEffect(() => {
    document.body.classList.add("demo-body");
    return () => document.body.classList.remove("demo-body");
  }, []);

  const person = me.data?.user;
  const membershipRole = me.data?.memberships.find((m) => m.organization.id === org?.id)?.role.name;
  // The signed-in person and the role their membership actually carries.
  const displayName = person?.display_name ?? person?.full_name ?? person?.email ?? "";
  const subtitle = membershipRole ?? org?.name ?? "";
  const initials =
    displayName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "A";

  return (
    <div className="demo-root">
      <div className="app-shell no-bar">
        <aside className="sidebar">
          <Link to="/discover" className="brand">
            <span aria-hidden className="brand-mark">
              A
            </span>
            <span>ASAP</span>
          </Link>

          <nav aria-label="Main" className="side-nav">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-item${path.startsWith(item.to) ? " active" : ""}`}
              >
                <span aria-hidden className="ico">
                  {item.glyph}
                </span>
                <span>{item.label}</span>
                <NavCount to={item.to} />
              </Link>
            ))}
          </nav>

          <div className="side-bottom">
            <Link to="/search" search={{ q: "" }} className="nav-item">
              <span aria-hidden className="ico">
                ⌕
              </span>
              <span>Search</span>
              <kbd aria-hidden>⌘ K</kbd>
            </Link>
            <Link to="/new" className="nav-item">
              <span aria-hidden className="ico">
                ＋
              </span>
              <span>New</span>
            </Link>

            <div className="profile">
              <span aria-hidden className="avatar">
                {initials}
              </span>
              <span className="profile-text">
                <strong>{displayName || "Signed in"}</strong>
                {/* The original shows the person's role here, not the brokerage — that is in the
                    menu, beside the switcher. */}
                <small>{subtitle}</small>
              </span>
              <ProfileMenu
                me={me.data}
                switching={switchOrg.isPending}
                onSwitch={(id) => switchOrg.mutate(id)}
                onSignOut={() => void supabase.auth.signOut()}
              />
            </div>
          </div>
        </aside>

        <main className="product-view">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * The counts beside Work and Jobs — read from the same source the screen itself reads.
 *
 * It is the API, through the queries the boards already run, so the number in the sidebar and the
 * list behind it come from one answer and cannot disagree. A count nobody can reach the rows for
 * is worse than no count, so it shows nothing until it has one.
 */
function NavCount({ to }: { to: string }) {
  const me = useMe();
  const orgId = me.data?.active_organization?.id;
  // The same query keys the boards use, so this costs nothing extra when a board is open.
  const work = useWorkList(orgId, "needs");
  const jobs = useRunList(orgId, "all");

  const n =
    to === "/work"
      ? (work.data?.counts.needs ?? 0)
      : to === "/jobs"
        ? // What ASAP itself is still carrying. A job stopped for a person is on the board's Work
          // tab, where a person looks for it, not in the count of what is running.
          (jobs.data?.counts.running ?? 0) + (jobs.data?.counts.waiting ?? 0)
        : 0;
  if (n === 0) return null;
  return <span className="nav-count">{n}</span>;
}
