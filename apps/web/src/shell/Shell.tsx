import { useMutation } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../lib/api.js";
import { useInvalidateMe, useMe } from "../lib/me.js";
import { supabase } from "../lib/supabase.js";
import { PresenterBar } from "../demo/PresenterBar.js";
import { useDemo } from "../demo/state.js";
import { NAV } from "./nav.js";

/** The demo's own operator, from the approved fixtures. */
const DEMO_PERSON = { name: "Grace Wanjiku", role: "Operations Manager", initials: "GW" };
import { ProfileMenu } from "./ProfileMenu.js";

/**
 * The permanent shell, ported from the approved demo (D-064).
 *
 * Structure and dimensions are the demo's, not an interpretation of it: a 44px presenter bar, then
 * a `228px 1fr` grid filling exactly `calc(100vh - 44px)`. The sidebar is `#f1f4f0` with a
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
  const { isDemo } = useDemo();
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
  // In demo mode the sidebar shows the fictional brokerage's own person, as the approved demo does.
  // Outside it, the signed-in person and their real role.
  const demoPerson = DEMO_PERSON;
  const displayName = isDemo
    ? demoPerson.name
    : (person?.display_name ?? person?.full_name ?? person?.email ?? "");
  const subtitle = isDemo ? demoPerson.role : (membershipRole ?? org?.name ?? "");
  const initials = isDemo
    ? demoPerson.initials
    : displayName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "A";

  return (
    <div className="demo-root">
      <PresenterBar />
      <div className={`app-shell${isDemo ? "" : " no-bar"}`}>
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

/** The counts the demo shows beside Work and Jobs. Read from the same state the screens use. */
function NavCount({ to }: { to: string }) {
  const { work, jobs } = useDemo();
  const n =
    to === "/work"
      ? // The demo counts everything a person owns here, which is what its Work grid opens on.
        work.length
      : to === "/jobs"
        ? jobs.filter(
            (j) => j.state === "running" || j.state === "waiting" || j.state === "needs_human",
          ).length
        : 0;
  if (n === 0) return null;
  return <span className="nav-count">{n}</span>;
}
