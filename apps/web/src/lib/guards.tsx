import { Notice } from "@asap/ui";
import { Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useAuth } from "./auth.js";
import { useMe } from "./me.js";

/** Requires a session; sends visitors to sign-in and back again afterwards. */
export function RequireSession() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <Notice tone="info" className="m-6">
        Loading…
      </Notice>
    );
  if (!session) return <Navigate to="/sign-in" search={{ next: location.pathname }} replace />;
  return <Outlet />;
}

/** Requires at least one active membership; otherwise the create-or-join screen. */
export function RequireMembership() {
  const me = useMe();
  if (me.isPending)
    return (
      <Notice tone="info" className="m-6">
        Loading your workspace…
      </Notice>
    );
  if (me.isError)
    return (
      <Notice tone="error" className="m-6">
        We could not load your account. Refresh, or sign in again.
      </Notice>
    );
  const active = me.data.memberships.filter((m) => m.status === "active");
  if (active.length === 0) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
