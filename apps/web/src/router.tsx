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
import { Today } from "./pages/Today.js";
import { DocumentViewer, Documents } from "./pages/Documents.js";
import { Email, EmailThread } from "./pages/Email.js";
import { JobDetail, Jobs } from "./pages/Jobs.js";
import { OpenNewSheet, StartWork } from "./pages/StartWork.js";
import { ImportBook } from "./pages/ImportBook.js";
import { Work } from "./pages/Work.js";
import { z } from "zod";
import { RequireMembership, RequireSession } from "./lib/guards.js";
import { AcceptInvitation } from "./pages/AcceptInvitation.js";
import { AuthCallback } from "./pages/AuthCallback.js";
import { ForgotPassword, ResetPassword } from "./pages/ResetPassword.js";
import { AgreementVersion } from "./pages/AgreementVersion.js";
import { Agreements } from "./pages/Agreements.js";
import { AutomationDetail, Automations } from "./pages/Automations.js";
import { ClientFile } from "./pages/ClientFile.js";
import { Files } from "./pages/Files.js";
import { Members } from "./pages/Members.js";
import { Onboarding } from "./pages/Onboarding.js";
import { Record } from "./pages/Record.js";
import { SignIn } from "./pages/SignIn.js";
import { SignUp } from "./pages/SignUp.js";
import { Search } from "./pages/Search.js";
import { Shell } from "./shell/Shell.js";
import { ClientSpace } from "./pages/ClientSpace.js";
import { ComparisonSpace } from "./pages/ComparisonSpace.js";
import { QuotationReading } from "./pages/QuotationReading.js";
import { OpportunitySpace, QuoteSpace } from "./pages/OpportunitySpace.js";

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
const shell = createRoute({ getParentRoute: () => member, id: "shell", component: Shell });

const index = createRoute({
  getParentRoute: () => shell,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/today", replace: true });
  },
});
/**
 * Today (D-074). D-060 had renamed it Discover; the rebuilt product calls it Today, and the
 * redirect below keeps every older link, bookmark and `?next=` value working in both directions
 * this project has used.
 */
const today = createRoute({
  getParentRoute: () => shell,
  path: "/today",
  component: Today,
  /** `?ask=` pre-fills the docked composer, so a Today card can open Ask on its own context. */
  validateSearch: z.object({ ask: z.string().max(200).optional().catch(undefined) }),
});
const legacyDiscover = createRoute({
  getParentRoute: () => shell,
  path: "/discover",
  beforeLoad: () => {
    throw redirect({ to: "/today", replace: true });
  },
});
const work = createRoute({
  getParentRoute: () => shell,
  path: "/work",
  component: Work,
  // The view ids are the API's and do not change; D-074 changed only what each is called on
  // screen. Old links carrying ?view=needs still land somewhere.
  validateSearch: z.object({
    /*
     * The API's own view names (D-075), plus `pinned`, which is a personal marker rather than a
     * view. The three legacy ids stay accepted so older links and bookmarks still land where the
     * person meant: the board maps them through LEGACY_WORK_FILTERS.
     */
    view: z
      .enum([
        "needs",
        "with",
        "progress",
        "done",
        "recent",
        "review",
        "pinned",
        "active",
        "waiting",
        "completed",
      ])
      .catch("needs"),
  }),
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
  component: Search,
  validateSearch: z.object({ q: z.string().max(200).optional().catch(undefined) }),
});
/* One client, by id. The tab is named after the client; there is no list page behind it. */
const clientSpace = createRoute({
  getParentRoute: () => shell,
  path: "/clients/$clientId",
  component: ClientSpace,
});
/* Quotation work, and one insurer's terms inside it. Each is its own tab, keyed by its own id. */
const opportunity = createRoute({
  getParentRoute: () => shell,
  path: "/opportunities/$opportunityId",
  component: OpportunitySpace,
});
/* The quotes beside each other. Its own address, so a comparison can be linked and reopened. */
const comparison = createRoute({
  getParentRoute: () => shell,
  path: "/opportunities/$opportunityId/comparison",
  component: ComparisonSpace,
  /* `?version=` opens the comparison a client was shown then, so it can be linked and reopened. */
  validateSearch: z.object({ version: z.coerce.number().int().min(1).optional().catch(undefined) }),
});
/* Reviewing what ASAP read from a quotation. Its own address, so it can be linked and reopened. */
const quotationReading = createRoute({
  getParentRoute: () => shell,
  path: "/documents/$documentId/quotation",
  component: QuotationReading,
});
const quote = createRoute({
  getParentRoute: () => shell,
  path: "/opportunities/$opportunityId/insurers/$opportunityInsurerId",
  component: QuoteSpace,
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
/**
 * Ask ASAP in full. **Not a destination** (D-074): it is not in the sidebar. The route exists so a
 * conversation has an address that can be linked, reopened and returned to, and because the docked
 * composer needs somewhere to open into when an answer outgrows it.
 */
const ask = createRoute({
  getParentRoute: () => shell,
  path: "/ask",
  component: Ask,
  validateSearch: z.object({ scenario: z.string().max(80).optional().catch(undefined) }),
});
/**
 * Jobs — what ASAP is processing. **Not a destination** (D-074): reached from the Activity chip,
 * from a run's own Work item, from an import or from automation history. Kept separate from Work,
 * which is what a person owns: a finished job means ASAP produced an output, never that a policy
 * renewed or money arrived.
 */
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
const newThing = createRoute({
  getParentRoute: () => shell,
  path: "/new",
  /*
   * `+ New` is a **sheet**, not a page: the shell opens it over whatever is on screen, so the
   * Space a person was reading stays mounted and stays in its tab. This route exists so the sheet
   * can be linked to and reopened; it renders Today underneath and asks the shell to open it.
   */
  component: OpenNewSheet,
});
/** One creation flow, as its own Space. `/new/client`, `/new/renewal`, and so on. */
const startWork = createRoute({
  getParentRoute: () => shell,
  path: "/new/$kind",
  component: StartWork,
});
const importBook = createRoute({
  getParentRoute: () => shell,
  path: "/import",
  component: ImportBook,
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
  forgotPassword,
  resetPassword,
  authCallback,
  invite,
  authed.addChildren([
    onboarding,
    onboardingCreate,
    member.addChildren([
      shell.addChildren([
        index,
        today,
        legacyDiscover,
        ask,
        jobs,
        jobDetail,
        newThing,
        startWork,
        importBook,
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
        clientSpace,
        opportunity,
        comparison,
        quotationReading,
        quote,
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
