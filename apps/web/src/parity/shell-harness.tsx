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
  if (/\/runs\/[^/?]+$/.test(u.split("?")[0] ?? "")) {
    const runId = "50000000-0000-4000-8000-000000000001";
    return json({
      run: {
        id: runId,
        organization_id: ORG,
        work_item_id: ROWS[0]?.id ?? null,
        title: "Read the placeholder schedule",
        status: "could_not_finish",
        next_step: "Page 2 has no readable text.",
        started_by: null,
        boot_token: null,
        started_at: "2026-08-20T08:00:00.000Z",
        ended_at: "2026-08-20T08:04:00.000Z",
        created_at: "2026-08-20T08:00:00.000Z",
        updated_at: "2026-08-20T08:04:00.000Z",
      },
      events: [
        { id: 1, run_id: runId, seq: 1, kind: "step", message: "Opened the document", created_at: "2026-08-20T08:01:00.000Z" },
        { id: 2, run_id: runId, seq: 2, kind: "step", message: "Read pages 1 of 2", created_at: "2026-08-20T08:02:00.000Z" },
        { id: 3, run_id: runId, seq: 3, kind: "error", message: "Page 2 has no readable text", created_at: "2026-08-20T08:04:00.000Z" },
      ],
      relatedWork: ROWS[0]
        ? { id: ROWS[0].id, title: ROWS[0].title, taskStatus: "needs_you", nowStep: "Confirm the sum insured" }
        : null,
      evidence: [{ label: "Uploaded file", reference: "placeholder-schedule.pdf", recordedBy: "Placeholder Owner", recordedAt: null }],
      waitingFor: null,
      recovery: [
        { kind: "open_work", label: "Open the work", disabledReason: null },
        { kind: "retry", label: "Read it again", disabledReason: null },
      ],
    });
  }
  if (u.includes("/runs")) {
    const filter = new URL(u, location.origin).searchParams.get("filter") ?? "all";
    const runId = "50000000-0000-4000-8000-000000000001";
    const item = {
      run: {
        id: runId,
        organization_id: ORG,
        work_item_id: ROWS[0]?.id ?? null,
        title: "Read the placeholder schedule",
        status: "could_not_finish",
        next_step: "Page 2 has no readable text.",
        started_by: null,
        boot_token: null,
        started_at: "2026-08-20T08:00:00.000Z",
        ended_at: "2026-08-20T08:04:00.000Z",
        created_at: "2026-08-20T08:00:00.000Z",
        updated_at: "2026-08-20T08:04:00.000Z",
      },
      group: "work",
      progress: 40,
      lastEvent: "Page 2 has no readable text",
      waitingFor: null,
      needsPerson: true,
      work: ROWS[0] ? { id: ROWS[0].id, title: ROWS[0].title } : null,
      client: { id: CLIENT, name: "Placeholder Client Ltd" },
      period: null,
    };
    return json({
      organization: { id: ORG, name: ORGANIZATION.name },
      filter,
      label: filter,
      generatedAt: "2026-08-20T09:00:00.000Z",
      groups: ROWS.length === 0 ? [] : [{ key: "work", title: "ignored", items: [item] }],
      counts: { all: 1, running: 0, waiting: 0, work: 1, completed: 0 },
      visible: 1,
      returned: 1,
      cap: 50,
      degraded: [],
    });
  }
  if (u.includes("/mailboxes")) {
    return json({
      mailboxes: [
        {
          id: "70000000-0000-4000-8000-000000000001",
          provider: "gmail",
          emailAddress: "broking@example.invalid",
          displayName: null,
          status: "connected",
          statusReason: null,
          lastSyncedAt: null,
          connectedAt: "2026-08-01T00:00:00.000Z",
          sync: {
            state: "never",
            runId: null,
            lastSyncedAt: null,
            error: null,
            canStart: false,
            cannotStartReason: "Nothing reads a mailbox in this deployment yet.",
          },
        },
      ],
      providers: [
        { id: "gmail", label: "Gmail", available: true, unavailableReason: null },
        { id: "microsoft", label: "Microsoft 365", available: false, unavailableReason: "This deployment has no Microsoft credentials." },
      ],
    });
  }
  if (u.includes("/pins")) return json({ pins: [] });
  /*
   * One client, assembled. The shape of the client comes from the harness URL so the measuring
   * run can photograph a company with several policies, a person with one, and a client with
   * nothing — without a database and without inventing a brokerage.
   */
  if (u.includes("/space") && u.includes("/clients/")) {
    const q = new URLSearchParams(location.search);
    const shape = q.get("client") ?? "full";
    const bare = shape === "bare";
    const single = shape === "single";
    return json({
      client: {
        id: CLIENT,
        name: bare ? "Placeholder Individual" : single ? "Placeholder Person" : "Placeholder Company",
        kind: bare || single ? "individual" : "corporate",
        fileStatus: bare ? "not_started" : "in_review",
        createdAt: "2026-01-04T00:00:00.000Z",
      },
      contacts: bare
        ? []
        : [
            { id: "c1000000-0000-4000-8000-000000000001", fullName: "Placeholder Contact", roleLabel: "Finance", email: "placeholder@example.invalid", phone: null, isPrimary: true },
            ...(single ? [] : [{ id: "c1000000-0000-4000-8000-000000000002", fullName: "Second Contact", roleLabel: "Operations", email: null, phone: null, isPrimary: false }]),
          ],
      policies: bare
        ? []
        : [
            {
              id: "c2000000-0000-4000-8000-000000000001",
              policyNumber: "PLACEHOLDER-1",
              classOfBusiness: "Motor",
              insurerName: "Placeholder Insurer",
              periods: [
                { id: "c3000000-0000-4000-8000-000000000001", periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: "214500.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: "32175.00", premiumSource: "document", premiumVerifiedAt: "2026-02-01T00:00:00.000Z", premiumEvidenceDocumentId: "c6000000-0000-4000-8000-000000000001", current: true },
                ...(single ? [] : [{ id: "c3000000-0000-4000-8000-000000000002", periodStart: "2025-01-01", periodEnd: "2025-12-31", premiumAmount: "198000.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: null, premiumSource: "import", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: false }]),
              ],
            },
            ...(single
              ? []
              : [{ id: "c2000000-0000-4000-8000-000000000002", policyNumber: "PLACEHOLDER-2", classOfBusiness: "Fire", insurerName: "Placeholder Insurer", periods: [{ id: "c3000000-0000-4000-8000-000000000003", periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: null, premiumCurrency: null, premiumBasis: null, commissionAmount: null, premiumSource: "manual", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: true }] }]),
          ],
      work: bare
        ? []
        : [{ id: "c4000000-0000-4000-8000-000000000001", kind: "renewal", title: "Placeholder renewal", taskStatus: "with_party", taskParty: "Placeholder Insurer", taskSince: "2026-08-12T00:00:00.000Z", ownerName: "Parity Harness", completedAt: null }],
      claims: bare || single
        ? []
        : [{ id: "c5000000-0000-4000-8000-000000000001", workItemId: "c4000000-0000-4000-8000-000000000002", status: "registered", incidentOn: "2026-08-01", incidentSummary: "Placeholder incident", insurerReference: "REF-99", policyId: "c2000000-0000-4000-8000-000000000001" }],
      endorsements: [],
      documents: bare ? [] : [{ id: "c6000000-0000-4000-8000-000000000001", filename: "placeholder.pdf", kind: "policy_schedule", extractionState: "extracted", createdAt: "2026-02-01T00:00:00.000Z" }],
      threads: bare ? [] : [{ id: "c7000000-0000-4000-8000-000000000001", subject: "Placeholder thread", lastMessageAt: "2026-08-12T00:00:00.000Z", messageCount: 3 }],
      fileMissing: bare ? [] : ["KRA PIN certificate"],
      mailboxConnected: !bare,
      permissions: {
        canEditContacts: q.get("perms") !== "none",
        canUploadDocuments: q.get("perms") !== "none",
        canStartWork: q.get("perms") !== "none",
      },
      gaps: [
        { id: "quotation", label: "Start quotation work", reason: "Quotations are not built yet, so there is nothing to open.", gap: "4B-2" },
        { id: "money", label: "Premium and balance", reason: "Premiums are recorded against each period, but invoices and payments have no records yet, so ASAP cannot say what is outstanding.", gap: "4D" },
      ],
    });
  }
  /*
   * First-use onboarding. The step, and whether this deployment has Google credentials, come from
   * the harness URL — so every one of the four steps and the two Gmail answers can be photographed
   * without a live Google client and without pretending one connected.
   */
  if (u.includes("/onboarding")) {
    const q = new URLSearchParams(location.search);
    const step = Number(q.get("step") ?? "1");
    const gmail = q.get("gmail") !== "off";
    const joined = q.get("joined") === "1";
    const done = q.get("done") === "1";
    return json({
      onboarding: {
        step: Number.isInteger(step) && step >= 1 && step <= 4 ? step : 1,
        recordsChoice: q.get("records"),
        mailboxChoice: q.get("mailbox"),
        completedAt: done ? "2026-09-20T10:00:00.000Z" : null,
        company: q.get("company") === "none"
          ? null
          : {
              id: ORG,
              name: ORGANIZATION.name,
              country: ORGANIZATION.country,
              currency: ORGANIZATION.currency,
              timezone: ORGANIZATION.timezone,
              canEdit: !joined,
              createdByYou: !joined,
            },
        progress: {
          documents: Number(q.get("documents") ?? "0"),
          imports: Number(q.get("imports") ?? "0"),
          clients: Number(q.get("clients") ?? "0"),
          mailboxConnected: q.get("connected") === "1",
        },
        gmailConfigured: gmail,
        gmailUnavailableReason: gmail
          ? null
          : "Gmail connection is not configured. Whoever administers this deployment can add the Google credentials.",
      },
    });
  }
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
  /*
   * The storage key supabase-js reads is derived from the project ref. Without a configured URL
   * there is no ref to derive — which is a measuring machine's situation, not a fault — so the
   * harness falls back to a placeholder rather than throwing and rendering nothing at all.
   */
  let ref = "parity-harness";
  try {
    const configured = import.meta.env["VITE_PUBLIC_SUPABASE_URL"] as string | undefined;
    if (configured) ref = new URL(configured).hostname.split(".")[0] ?? ref;
  } catch {
    /* Not a URL. The placeholder above stands, and every request is answered by the stub anyway. */
  }
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
