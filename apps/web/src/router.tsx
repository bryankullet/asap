import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { z } from "zod";
import { AsapApp } from "./asap/AsapApp.js";
import { RequireMembership, RequireSession } from "./lib/guards.js";
import { AcceptInvitation } from "./pages/AcceptInvitation.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { ForgotPassword, ResetPassword } from "./pages/ResetPassword.js";
import { Onboarding } from "./pages/Onboarding.js";
import { SignIn } from "./pages/SignIn.js";
import { SignUp } from "./pages/SignUp.js";

/**
 * The approved ASAP interface is one application with its own workspaces and tabs, so it owns a
 * single address. Sign-in, sign-up, password reset, invitations and creating a brokerage stay as
 * routes because they happen before there is a session or a brokerage to open it over.
 */
const rootRoute = createRootRoute({ component: Outlet });

const nextSearch = z.object({ next: z.string().startsWith("/").optional().catch(undefined) });

const signIn = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignIn,
  validateSearch: nextSearch,
});
const signUp = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-up",
  component: SignUp,
  validateSearch: z.object({
    email: z.string().optional().catch(undefined),
    next: z.string().startsWith("/").optional().catch(undefined),
  }),
});
/** Forgetting a password, and choosing a new one (D-068). Public, like sign-in. */
const forgotPassword = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPassword,
});
const resetPassword = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPassword,
});
const authCallback = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  component: AuthCallback,
  validateSearch: nextSearch,
});
const invite = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: AcceptInvitation,
});

/**
 * The demo-mode boundary (D-065).
 *
 * Every destination sits under both guards: a live Supabase session, then a resolved brokerage
 * membership. Neither is optional and neither has a bypass — there is no unauthenticated route
 * into the application beyond sign-in, sign-up and password reset.
 */
const authed = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  component: RequireSession,
});
const onboarding = createRoute({
  getParentRoute: () => authed,
  path: "/onboarding",
  component: Onboarding,
});
/*
 * The old create-a-brokerage form. Creating one is now the first step of onboarding, in the same
 * Space renderer as everything else, so this address redirects rather than offering a second
 * creation screen — two ways to create a brokerage is one more than a brokerage needs.
 */
const onboardingCreate = createRoute({
  getParentRoute: () => authed,
  path: "/onboarding/create",
  beforeLoad: () => {
    throw redirect({ to: "/onboarding", replace: true });
  },
  component: Onboarding,
});

const member = createRoute({
  getParentRoute: () => authed,
  id: "member",
  component: RequireMembership,
});

/*
 * The application owns every address under the guards (D-155): `/`, `/work`, `/automations`,
 * `/activity`, `/ask/…` and `/s/…` are surfaces of the one adaptive shell, which reads the address
 * itself. One layout route renders it, so moving between surfaces never remounts the application;
 * older addresses (/today, /clients/…) open Home inside it rather than a dead page.
 */
const app = createRoute({ getParentRoute: () => member, id: "app", component: AsapApp });
const index = createRoute({ getParentRoute: () => app, path: "/", component: () => null });
const everything = createRoute({ getParentRoute: () => app, path: "$", component: () => null });

const routeTree = rootRoute.addChildren([
  signIn,
  signUp,
  forgotPassword,
  resetPassword,
  authCallback,
  invite,
  authed.addChildren([onboarding, onboardingCreate, member.addChildren([app.addChildren([index, everything])])]),
]);

/**
 * The application's route tree, as a factory so a test can drive it with a memory history and
 * assert what a real visit does against the routes the browser actually gets.
 */
export function createAppRouter(options: { history?: RouterHistory } = {}) {
  return createRouter({ routeTree, ...options });
}

export const router = createAppRouter();
