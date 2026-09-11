import type { MeResponse } from "@asap/schema";
import { Button, Card, CardDescription, CardTitle, Notice } from "@asap/ui";
import { useMutation } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ApiRequestError, api, describeApiError } from "./api.js";
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
  if (me.isError) return <AccountLoadFailure error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data.active_organization) return <ChooseBrokerage memberships={active} />;
  return <Outlet />;
}

/**
 * Why the account could not be loaded, and what to do about it.
 *
 * "We could not load your account. Refresh, or sign in again." was the whole of this screen, and
 * it was wrong for four of the five things that actually cause it: refreshing does not fix a
 * service that is unreachable, and signing in again does not apply a missing migration. Each case
 * below names what failed, who can fix it, and whether the visitor can do anything at all.
 *
 * The detail shown is a failure class, never a hostname, a variable or a database message
 * (§45 rule 4).
 */
export function AccountLoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof ApiRequestError ? error.code : "unknown";
  const status = error instanceof ApiRequestError ? error.status : 0;

  const kind =
    code === "api_unreachable"
      ? "unreachable"
      : code === "schema_behind"
        ? "schema"
        : code === "response_unrecognised"
          ? "drift"
          : code === "profile_missing"
            ? "profile"
            : status === 401 || code === "invalid_session" || code === "not_signed_in"
              ? "session"
              : status === 403 || code === "permission_denied" || code === "not_a_member"
                ? "permission"
                : "unknown";

  type Copy = { title: string; body: string; retry: boolean; signIn: boolean };
  const COPY: Record<string, Copy | undefined> = {
    unreachable: {
      title: "We cannot reach the ASAP service",
      body: "Your sign-in is fine. The service is not answering this browser — it may be starting up, offline, or reachable only from another address. Nothing you did caused this, and no data has been affected.",
      retry: true,
      signIn: false,
    },
    session: {
      title: "Your session is no longer valid",
      body: "You are signed in to this browser, but the service will not accept the session. Signing in again fixes it.",
      retry: false,
      signIn: true,
    },
    permission: {
      title: "Your account cannot open this brokerage",
      body: "The service accepted your session but refused the request. Your membership may have been suspended or removed. An administrator of the brokerage can restore it.",
      retry: true,
      signIn: false,
    },
    schema: {
      title: "This deployment is part-upgraded",
      body: "The service is running ahead of its database: a migration it needs has not been applied. Signing in again will not help. Whoever administers this deployment needs to run the migrations.",
      retry: true,
      signIn: false,
    },
    drift: {
      title: "This page and the service are different builds",
      body: "The service answered in a shape this version of the application does not recognise. Reloading picks up a newer page if one has been deployed; otherwise whoever administers this deployment needs to redeploy them together.",
      retry: true,
      signIn: false,
    },
    profile: {
      title: "Your sign-in exists but your profile does not",
      body: "The account was created without its profile record, which the service cannot repair on its own. Whoever administers this deployment needs to look at it.",
      retry: true,
      signIn: false,
    },
    unknown: {
      title: "We could not load your account",
      body: "The service answered with something unexpected. Try again; if it keeps happening, tell whoever administers this deployment.",
      retry: true,
      signIn: true,
    },
  };
  const copy = COPY[kind] ?? {
    title: "We could not load your account",
    body: "The service answered with something unexpected. Try again; if it keeps happening, tell whoever administers this deployment.",
    retry: true,
    signIn: true,
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <Card className="flex flex-col gap-3">
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.body}</CardDescription>
        <div className="flex flex-wrap gap-2">
          {copy.retry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
          {copy.signIn && (
            <Link to="/sign-in" className="text-sm text-ink underline">
              Sign in again
            </Link>
          )}
        </div>
        {/* The failure class, so a report can name it. Never a host, a variable or a query. */}
        <p className="text-xs text-ink-muted">Reference: {code}</p>
      </Card>
    </div>
  );
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
                size="lg"
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
