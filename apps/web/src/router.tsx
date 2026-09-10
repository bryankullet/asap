import { K01View, WorkView } from "@asap/schema";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { RequireMembership, RequireSession } from "./lib/guards.js";
import { AcceptInvitation } from "./pages/AcceptInvitation.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { AgreementVersion } from "./pages/AgreementVersion.js";
import { Agreements } from "./pages/Agreements.js";
import { AutomationDetail, Automations } from "./pages/Automations.js";
import { ClientFile } from "./pages/ClientFile.js";
import { Files } from "./pages/Files.js";
import { CreateOrganization } from "./pages/CreateOrganization.js";
import { Members } from "./pages/Members.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Record } from "./pages/Record.js";
import { SignIn } from "./pages/SignIn.js";
import { SignUp } from "./pages/SignUp.js";
import { Discover } from "./pages/Discover.js";
import { Work } from "./pages/Work.js";
import { Shell } from "./shell/Shell.js";

/** Routes from UI Build Spec v1 Part 1.3. Every panel is a URL; nothing traps state in memory. */
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
const onboardingCreate = createRoute({
  getParentRoute: () => authed,
  path: "/onboarding/create",
  component: CreateOrganization,
});

const member = createRoute({
  getParentRoute: () => authed,
  id: "member",
  component: RequireMembership,
});
const shell = createRoute({ getParentRoute: () => member, id: "shell", component: Shell });

const index = createRoute({
  getParentRoute: () => shell,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/discover", replace: true });
  },
});
const discover = createRoute({
  getParentRoute: () => shell,
  path: "/discover",
  component: Discover,
  /** `?ask=` pre-fills the docked composer, so a Discover card can open Ask on its own context. */
  validateSearch: z.object({ ask: z.string().max(200).optional().catch(undefined) }),
});
/** D-060 renamed Today to Discover. Existing links, bookmarks and `?next=` values keep working. */
const legacyToday = createRoute({
  getParentRoute: () => shell,
  path: "/today",
  beforeLoad: () => {
    throw redirect({ to: "/discover", replace: true });
  },
});
const work = createRoute({
  getParentRoute: () => shell,
  path: "/work",
  component: Work,
  validateSearch: z.object({ view: WorkView.catch("needs") }),
});
const automations = createRoute({
  getParentRoute: () => shell,
  path: "/automations",
  component: Automations,
});
const automationDetail = createRoute({
  getParentRoute: () => shell,
  path: "/automations/$id",
  component: AutomationDetail,
});
const record = createRoute({
  getParentRoute: () => shell,
  path: "/r/$recordId",
  component: Record,
  validateSearch: z.object({
    panel: z.string().optional().catch(undefined),
    /** A link that already knows the id is a policy; the page then skips the work-item probe. */
    kind: z.literal("policy").optional().catch(undefined),
  }),
});
const files = createRoute({
  getParentRoute: () => shell,
  path: "/files",
  component: Files,
  validateSearch: z.object({ view: K01View.catch("blocking") }),
});
const clientFile = createRoute({
  getParentRoute: () => shell,
  path: "/files/$clientId",
  component: ClientFile,
});
const agreements = createRoute({
  getParentRoute: () => shell,
  path: "/settings/agreements",
  component: Agreements,
});
const agreementVersion = createRoute({
  getParentRoute: () => shell,
  path: "/settings/agreements/$agreementId",
  component: AgreementVersion,
});
const settingsMembers = createRoute({
  getParentRoute: () => shell,
  path: "/settings/members",
  component: Members,
});
const legacyMembers = createRoute({
  getParentRoute: () => shell,
  path: "/members",
  beforeLoad: () => {
    throw redirect({ to: "/settings/members", replace: true });
  },
});

export const routeTree = rootRoute.addChildren([
  signIn,
  signUp,
  authCallback,
  invite,
  authed.addChildren([
    onboarding,
    onboardingCreate,
    member.addChildren([
      shell.addChildren([
        index,
        discover,
        legacyToday,
        work,
        automations,
        automationDetail,
        record,
        files,
        clientFile,
        agreements,
        agreementVersion,
        settingsMembers,
        legacyMembers,
      ]),
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => (
    <p className="m-6 text-sm text-ink-secondary">There is nothing at this address.</p>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
