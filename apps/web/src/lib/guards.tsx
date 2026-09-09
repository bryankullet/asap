import type { MeResponse } from "@asap/schema";
import { Button, Card, CardDescription, CardTitle, Notice } from "@asap/ui";
import { useMutation } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { api, describeApiError } from "./api.js";
import { useAuth } from "./auth.js";
import { useInvalidateMe, useMe } from "./me.js";

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

export function activeMemberships(me: MeResponse | undefined): MeResponse["memberships"] {
  return me?.memberships.filter((m) => m.status === "active") ?? [];
}

/**
 * Requires an active brokerage (D-055). Zero memberships: the create-or-join screen. Exactly one:
 * the server sets it on `/me`, so nothing is asked here. More than one and none chosen: the
 * chooser, which is the only time a person is asked which brokerage they mean.
 */
export function RequireMembership() {
  const me = useMe();
  const navigate = useNavigate();
  const active = activeMemberships(me.data);
  const noMembership = me.isSuccess && active.length === 0;
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
  if (!me.data.active_organization) return <ChooseBrokerage memberships={active} />;
  return <Outlet />;
}

/** Shown only when a person belongs to more than one brokerage and has not chosen one yet. */
export function ChooseBrokerage({ memberships }: { memberships: MeResponse["memberships"] }) {
  const invalidate = useInvalidateMe();
  const choose = useMutation({
    mutationFn: api.setActiveOrganization,
    onSuccess: () => void invalidate(),
  });
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Card className="flex flex-col gap-3">
        <CardTitle>Which brokerage are you working in?</CardTitle>
        <CardDescription>
          You belong to {memberships.length} brokerages. Choose one to start; you can switch at any
          time from the profile control.
        </CardDescription>
        <ul className="flex flex-col gap-2" aria-label="Your brokerages">
          {memberships.map((m) => (
            <li key={m.organization.id}>
              <Button
                variant="outline"
                className="w-full justify-between"
                disabled={choose.isPending}
                onClick={() => choose.mutate(m.organization.id)}
              >
                <span>{m.organization.name}</span>
                <span className="text-xs text-ink-muted">{m.role.name}</span>
              </Button>
            </li>
          ))}
        </ul>
        {choose.isError && <Notice tone="error">{describeApiError(choose.error)}</Notice>}
      </Card>
    </div>
  );
}
