import { K01View, SpaceView } from "@asap/schema";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Ask } from "./pages/Ask.js";
import { AuditHistory } from "./pages/AuditHistory.js";
import { Connections } from "./pages/Connections.js";
import { DiscoverDemo } from "./pages/DiscoverDemo.js";
import { DocumentViewer, Documents } from "./pages/Documents.js";
import { Email, EmailThread } from "./pages/Email.js";
import { JobDetail, Jobs } from "./pages/Jobs.js";
import { NewThing } from "./pages/NewThing.js";
import { WorkDemo, WorkDetail } from "./pages/WorkDemo.js";
import { z } from "zod";
import { RequireMembership, RequireSession } from "./lib/guards.js";
import { DEMO_MODE } from "./demo/mode.js";
import { AcceptInvitation } from "./pages/AcceptInvitation.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { AgreementVersion } from "./pages/AgreementVersion.js";
import { Agreements } from "./pages/Agreements.js";
import { AutomationDemoDetail, AutomationsDemo } from "./pages/AutomationsDemo.js";
import { ClientFile } from "./pages/ClientFile.js";
import { Files } from "./pages/Files.js";
import { CreateOrganization } from "./pages/CreateOrganization.js";
import { Members } from "./pages/Members.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Record } from "./pages/Record.js";
import { SignIn } from "./pages/SignIn.js";
import { SignUp } from "./pages/SignUp.js";
import { SearchDemo } from "./pages/SearchDemo.js";
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

/**
 * The demo-mode boundary (D-065).
 *
 * The public demonstration is a different application: fixture-only, session-scoped, and reaching
 * nothing real. It therefore branches *here*, above the guards, rather than inside them — the
 * guards are not relaxed, they are simply not mounted. With the flag off, which is every real
 * deployment, both guards mount exactly as they did and production authentication is untouched.
 *
 * `Outlet` is the whole of the demo branch: no session lookup, no `/me`, no membership check, so
 * `/discover` renders for anyone, in any browser, with no cookie and no redirect to sign-in.
 */
const authed = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  component: DEMO_MODE ? Outlet : RequireSession,
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
  component: DEMO_MODE ? Outlet : RequireMembership,
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
  component: DiscoverDemo,
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
  component: WorkDemo,
  // The approved Work vocabulary (D-064). Old links carrying ?view=needs still land somewhere.
  validateSearch: z.object({
    view: z
      .enum(["active", "waiting", "review", "completed", "pinned", "recent"])
      .catch("active"),
  }),
});
const automations = createRoute({
  getParentRoute: () => shell,
  path: "/automations",
  component: AutomationsDemo,
});
const automationDetail = createRoute({
  getParentRoute: () => shell,
  path: "/automations/$id",
  component: AutomationDemoDetail,
});
const record = createRoute({
  getParentRoute: () => shell,
  path: "/r/$recordId",
  component: Record,
  validateSearch: z.object({
    panel: z.string().optional().catch(undefined),
    /**
     * A link that already knows what the id is, so the page reads it directly instead of probing
     * /work-items first and logging a 404 on the way to the answer. A pasted url carries no hint
     * and still falls back through every kind in turn.
     */
    kind: z.enum(["policy", "run"]).optional().catch(undefined),
    /**
     * Which blocks to open with. Ask sets it when an answer is about one side of a record — the
     * money, the documents, what is blocking — so the record opens on what was asked about
     * rather than on the summary. The plan behind each view is still built and validated
     * server-side; the search parameter only chooses which validated plan to request.
     */
    view: SpaceView.optional().catch(undefined),
  }),
});
/** H04. A real search over what the backend can actually search, with the query in the URL. */
const search = createRoute({
  getParentRoute: () => shell,
  path: "/search",
  component: SearchDemo,
  validateSearch: z.object({ q: z.string().max(200).optional().catch(undefined) }),
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

export 
/** Ask ASAP in full (D-064): a destination as well as the composer docked on every surface. */
const ask = createRoute({
  getParentRoute: () => shell,
  path: "/ask",
  component: Ask,
  validateSearch: z.object({ scenario: z.string().max(80).optional().catch(undefined) }),
});
/** Jobs — what ASAP is processing. Kept separate from Work, which is what a person owns. */
const jobs = createRoute({
  getParentRoute: () => shell,
  path: "/jobs",
  component: Jobs,
  validateSearch: z.object({
    filter: z.enum(["all", "running", "waiting", "work", "completed"]).catch("all"),
  }),
});
const jobDetail = createRoute({
  getParentRoute: () => shell,
  path: "/jobs/$jobId",
  component: JobDetail,
});
const workDetail = createRoute({
  getParentRoute: () => shell,
  path: "/work/$workId",
  component: WorkDetail,
});
const newThing = createRoute({
  getParentRoute: () => shell,
  path: "/new",
  component: NewThing,
  validateSearch: z.object({ kind: z.string().max(40).optional().catch(undefined) }),
});
const email = createRoute({ getParentRoute: () => shell, path: "/email", component: Email });
const emailThread = createRoute({
  getParentRoute: () => shell,
  path: "/email/$threadId",
  component: EmailThread,
  validateSearch: z.object({ scenario: z.string().max(80).optional().catch(undefined) }),
});
const documents = createRoute({
  getParentRoute: () => shell,
  path: "/documents",
  component: Documents,
});
const documentViewer = createRoute({
  getParentRoute: () => shell,
  path: "/documents/$documentId",
  component: DocumentViewer,
});
const audit = createRoute({
  getParentRoute: () => shell,
  path: "/audit",
  component: AuditHistory,
});
const connections = createRoute({
  getParentRoute: () => shell,
  path: "/settings/connections",
  component: Connections,
});

const routeTree = rootRoute.addChildren([
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
        ask,
        jobs,
        jobDetail,
        workDetail,
        newThing,
        email,
        emailThread,
        documents,
        documentViewer,
        connections,
        audit,
        search,
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

/**
 * The application's route tree, as a factory so a test can drive it with a memory history and
 * assert what a real visit does — whether `/discover` renders or lands on sign-in — against the
 * routes the browser actually gets, not a reconstruction of them.
 */
export function createAppRouter(options: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: () => (
      <p className="m-6 text-sm text-ink-secondary">There is nothing at this address.</p>
    ),
    ...options,
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
