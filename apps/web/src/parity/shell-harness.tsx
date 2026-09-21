/**
 * A measuring harness for the permanent shell. Development only.
 *
 * Geometry parity needs a real browser: jsdom cannot tell you a sidebar is 228px wide. The
 * authenticated application cannot be reached from a measuring script without a real session, so
 * this page mounts the **shipping** `Shell` and the **shipping** stylesheets over a stubbed `/me`
 * and empty board responses, and measures that.
 *
 * What it proves: the shell's geometry, typography, colour and responsive behaviour are the
 * prototype's. What it does not prove, and must never be read as proving: authentication, RLS,
 * permissions, or that any business value is real — every value here is empty or a placeholder.
 *
 * It is not part of the production build. `index.html` is the only Rollup input, so nothing here
 * is emitted into `dist/`, and `scripts/check-bundle.mjs` would see it if that changed.
 */

if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

const json = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });

/*
 * A stand-in session, so the shell renders its signed-in state. The name is obviously a stand-in:
 * no fictional brokerage, client or policy belongs in this codebase, and a plausible-looking one
 * here would end up quoted as if it were real.
 */
/*
 * A stand-in brokerage, so the boards render with content in them and can be measured.
 *
 * Every id is a real uuid and every body is the endpoint's own shape, because `lib/api.ts`
 * validates each response — a fixture the API could not have produced would leave the board in
 * its loading state and the measurement would be of a skeleton. The names are obviously
 * placeholders: no fictional client, policy or claim belongs in this codebase, and a plausible
 * one here would end up quoted as though it were real.
 */
const ORG = "10000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const OWNER = "30000000-0000-4000-8000-0000000000aa";
const ORGANIZATION = {
  id: ORG,
  name: "Placeholder Brokerage",
  country: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
};

const params = new URLSearchParams(location.search);
/** `?rows=0` measures the empty state; anything else measures a board with content. */
const ROW_COUNT = Number.parseInt(params.get("rows") ?? "4", 10);
/** `?book=0` measures a brand-new brokerage rather than one that is merely up to date. */
const HAS_BOOK = params.get("book") !== "0";

const PARTIES = ["CIC", "client", "assessor"];

function row(i: number) {
  const id = `00000000-0000-4000-8000-00000000000${i + 1}`;
  const external = i % 3 === 1;
  return {
    id,
    organization_id: ORG,
    title: `Placeholder work item ${i + 1}`,
    kind: (["placement", "renewal", "claim", "endorsement"] as const)[i % 4]!,
    client_id: CLIENT,
    policy_period_id: null,
    insurer_id: null,
    class_of_business: null,
    owner_id: OWNER,
    task_status: external ? "with_party" : "needs_you",
    task_party: external ? PARTIES[i % PARTIES.length]! : null,
    task_since: "2026-08-12T00:00:00.000Z",
    task_next_check: external ? "2026-08-26T00:00:00.000Z" : null,
    cover_status: null,
    cover_inception_at: null,
    money_status: null,
    reason: "This is the reason the engine recorded against the row, shown behind one click.",
    steps: [],
    exception: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
  };
}

const ROWS = Array.from({ length: Math.max(0, ROW_COUNT) }, (_, i) => row(i));
const SIGNAL = {
  id: "cover_uncertain",
  because: "Cover was requested and no confirmation is recorded.",
  points: 48,
};
const context = (r: ReturnType<typeof row>) => ({
  client: { id: CLIENT, name: "Placeholder Client Ltd" },
  owner: { id: OWNER, name: "Placeholder Owner" },
  priority: "high" as const,
  period: null,
  facts: [],
  links: { work: `/r/${r.id}`, client: `/files/${CLIENT}`, policy: null, ask: r.title },
});

globalThis.fetch = (async (url: RequestInfo | URL) => {
  const u = String(url);
  if (u.includes("/me")) {
    return json({
      user: {
        id: "90000000-0000-4000-8000-000000000001",
        email: "harness@example.invalid",
        display_name: "Parity Harness",
        full_name: null,
      },
      memberships: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          organization: ORGANIZATION,
          role: {
            id: "70000000-0000-4000-8000-000000000001",
            key: "brokerage_admin",
            name: "Brokerage admin",
            description: null,
            is_system: true,
          },
          is_owner: true,
          status: "active",
          joined_at: "2026-01-04T00:00:00.000Z",
        },
      ],
      active_organization: ORGANIZATION,
      permissions: ["work_item:assign"],
    });
  }
  if (u.includes("/attention")) {
    return json({
      organization: { id: ORG, name: ORGANIZATION.name },
      generatedAt: "2026-08-20T09:00:00.000Z",
      items: ROWS.map((r, i) => ({
        section: "needs_you",
        rank: i + 1,
        score: 48,
        item: r,
        reason: r.reason,
        signals: [SIGNAL],
        nowStep: null,
        runFailure: null,
        ...context(r),
      })),
      sections: [
        {
          key: "needs_you",
          label: "What matters now",
          visible: ROWS.length,
          returned: ROWS.length,
        },
        { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
      ],
      orphanRuns: [],
      degraded: [],
      cap: 12,
      book: HAS_BOOK
        ? { clients: 12, policies: 20, work: ROWS.length }
        : { clients: 0, policies: 0, work: 0 },
    });
  }
  if (u.includes("/work")) {
    const view = new URL(u, location.origin).searchParams.get("view") ?? "needs";
    return json({
      organization: { id: ORG, name: ORGANIZATION.name },
      view,
      label: view,
      generatedAt: "2026-08-20T09:00:00.000Z",
      items: ROWS.map((r, i) => ({
        rank: i + 1,
        item:
          view === "done"
            ? { ...r, task_status: "done", completed_at: "2026-08-19T00:00:00.000Z" }
            : r,
        reason: r.reason,
        nowStep: { id: "confirm", label: "Confirm cover", actor: "insurer" },
        runFailure: null,
        signals: [SIGNAL],
        ...context(r),
      })),
      visible: ROWS.length,
      returned: ROWS.length,
      cap: 50,
      counts: { needs: ROWS.length, with: 2, progress: 1, review: 0, recent: 3, done: 5 },
      degraded: [],
    });
  }
  if (u.includes("/search")) {
    const q = new URL(u, location.origin).searchParams.get("q") ?? "";
    return json({
      query: q,
      results:
        q === ""
          ? []
          : [
              { id: CLIENT, kind: "client", title: "Placeholder Client Ltd", subtitle: "Corporate client", to: `/clients/${CLIENT}`, clientName: null },
              { id: "00000000-0000-4000-8000-000000000001", kind: "policy", title: "P-PLACEHOLDER-1", subtitle: "Commercial motor", to: "/r/00000000-0000-4000-8000-000000000001?kind=policy", clientName: "Placeholder Client Ltd" },
              { id: "00000000-0000-4000-8000-000000000002", kind: "document", title: "placeholder-schedule.pdf", subtitle: "Policy schedule · not read yet", to: "/documents/00000000-0000-4000-8000-000000000002", clientName: "Placeholder Client Ltd" },
              { id: "00000000-0000-4000-8000-000000000003", kind: "email", title: "Placeholder thread subject", subtitle: "Email thread", to: "/email?thread=x", clientName: "Placeholder Client Ltd" },
            ],
      degraded: [],
    });
  }
  if (u.includes("/runs")) return json({ runs: [] });
  if (u.includes("/pins")) return json({ pins: [] });
  return json({});
}) as typeof fetch;

/**
 * A signed-in session, written where `supabase-js` looks for one.
 *
 * `lib/api.ts` refuses to call anything without a token — which is the point of it — so a harness
 * that did not install one would measure five error states. The token is a placeholder and reaches
 * nothing: every request is answered by the stub above.
 */
function installSession(): void {
  const ref = new URL(import.meta.env["VITE_PUBLIC_SUPABASE_URL"] as string).hostname.split(".")[0];
  const session = {
    access_token: "parity-harness-token",
    refresh_token: "parity-harness-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "90000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "harness@example.invalid",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-04T00:00:00.000Z",
    },
  };
  try {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
  } catch {
    /* Without storage the harness still renders; it renders error states, and says so on screen. */
  }
}

installSession();

/*
 * The application is imported *after* the stub and the session are in place. A static import would
 * be hoisted above both, and the first `/me` would go out before either existed.
 */
await import("./harness-app.js");
