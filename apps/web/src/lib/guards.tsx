import { Notice } from "@asap/ui";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth } from "./auth.js";
import { useMe } from "./me.js";

/**
 * Both guards redirect from an effect keyed on primitives, never through `<Navigate>` with inline
 * props: this router's `Navigate` re-navigates whenever its props object changes identity, and a
 * guard re-renders on every navigation (it reads the location), so the pair looped until the tab
 * ran out of memory. Found on the first staging deploy, reproduced headless on every guarded URL.
 */

/** Requires a session; sends visitors to sign-in and back again afterwards. */
export function RequireSession() {
  const { session, loading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const redirect = !loading && !session;
  // The path to come back to is the one the visitor asked for, read once when the redirect fires,
  // not the sign-in path the guard sees while the transition is still rendering it.
  const askedFor = useRef(pathname);
  if (!redirect) askedFor.current = pathname;
  useEffect(() => {
    if (redirect)
      void navigate({ to: "/sign-in", search: { next: askedFor.current }, replace: true });
  }, [redirect, navigate]);
  if (loading || redirect)
    return (
      <Notice tone="info" className="m-6">
        Loading…
      </Notice>
    );
  return <Outlet />;
}

/** Requires at least one active membership; otherwise the create-or-join screen. */
export function RequireMembership() {
  const me = useMe();
  const navigate = useNavigate();
  const noMembership = me.isSuccess && !me.data.memberships.some((m) => m.status === "active");
  useEffect(() => {
    if (noMembership) void navigate({ to: "/onboarding", replace: true });
  }, [noMembership, navigate]);
  if (me.isPending || noMembership)
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
  return <Outlet />;
}
