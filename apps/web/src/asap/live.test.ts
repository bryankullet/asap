import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Live mode over a brokerage's records, with the API answered in the shapes its Zod contracts
 * define. What is asserted is what a person would see: real rows, cover only when the server
 * verified it, and honest refusals where the API does not reach yet.
 */
const ORG = "10000000-0000-4000-8000-00000000000a";
const ME = "20000000-0000-4000-8000-000000000001";
const CLIENT = "30000000-0000-4000-8000-000000000001";
const POL_OK = "40000000-0000-4000-8000-000000000001";
const POL_UNVERIFIED = "40000000-0000-4000-8000-000000000002";
const PER_OK = "50000000-0000-4000-8000-000000000001";
const PER_UNVERIFIED = "50000000-0000-4000-8000-000000000002";
const WORK = "60000000-0000-4000-8000-000000000001";
const AUTO = "70000000-0000-4000-8000-000000000001";

const setAutomationEnabled = vi.fn(async () => ({}));

vi.mock("../lib/supabase.js", () => ({ supabase: { auth: { signOut: async () => ({}) } } }));
vi.mock("../lib/api.js", () => ({
  describeApiError: (e: unknown) => (e instanceof Error ? e.message : "failed"),
  api: {
    members: async () => ({
      members: [{ membership_id: ME, user: { id: ME, email: "wanjiru@example.test", full_name: "Wanjiru Kamau", display_name: null, last_seen_at: null }, role: { id: ME, key: "owner", name: "Owner" }, is_owner: true, status: "active", joined_at: "2026-09-01" }],
    }),
    mailboxes: async () => ({ mailboxes: [], providers: [] }),
    automations: async () => ({
      automations: [{ id: AUTO, organization_id: ORG, name: "Renewal preparation", description: "Prepare the renewal pack", trigger_event: "renewal.approaching", conditions: [], skill: "renewal.prepare", prepared_verb: "prepare", approval: "always", sends_externally: false, enabled: false, created_by: ME, created_at: "2026-09-01", updated_at: "2026-09-01" }],
    }),
    audit: async () => ({ recordId: null, entries: [{ id: "a1", actorType: "user", actorName: "Wanjiru Kamau", action: "client.created", objectType: "client", objectId: CLIENT, result: "success", failureReason: null, changed: [], evidence: [], occurredAt: "2026-09-02T09:00:00Z" }], visible: 1, returned: 1 }),
    opportunities: async () => ({ opportunities: [] }),
    workList: async (view: string) => ({
      items:
        view === "needs"
          ? [{ rank: 1, reason: "Renewal is 30 days away and no terms are in.", priority: "high", item: { id: WORK, organization_id: ORG, title: "Renew Tausi Hauliers motor fleet", kind: "renewal", client_id: CLIENT, policy_period_id: PER_OK, insurer_id: null, class_of_business: "Motor", owner_id: ME, task_status: "needs_you", task_party: null, task_since: "2026-09-20", task_next_check: null, cover_status: null, cover_inception_at: null, money_status: null, reason: null, steps: [], exception: null, version: 1 } }]
          : [],
    }),
    clientFiles: async (view: string) => ({
      view,
      counts: {},
      items: view === "cleared" ? [{ client: { id: CLIENT, organization_id: ORG, name: "Tausi Hauliers Ltd", kind: "corporate", source: "manual", file_status: "cleared", file_owner_id: null, file_decided_by: null, file_decided_at: null, file_decision_reason: null, refresh_interval_days: null, refresh_due_at: null, created_at: "2026-09-01", updated_at: "2026-09-01", deleted_at: null }, effective_status: "cleared", blocking: [], in_state_since: "2026-09-01", documents_held: 0 }] : [],
    }),
    clientSpace: async () => ({
      client: { id: CLIENT, name: "Tausi Hauliers Ltd", kind: "corporate", fileStatus: "cleared", createdAt: "2026-09-01" },
      contacts: [{ id: "c1", fullName: "Otieno Were", roleLabel: "Finance", email: "otieno@example.test", phone: null, isPrimary: true }],
      policies: [
        { id: POL_OK, policyNumber: "TH-MTR-001", classOfBusiness: "Motor", insurerName: "First Insurer", periods: [{ id: PER_OK, periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: "1200000.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: null, premiumSource: "document", premiumVerifiedAt: "2026-01-02", premiumEvidenceDocumentId: null, current: true }] },
        { id: POL_UNVERIFIED, policyNumber: null, classOfBusiness: "Fire", insurerName: null, periods: [{ id: PER_UNVERIFIED, periodStart: "2026-02-01", periodEnd: "2027-01-31", premiumAmount: null, premiumCurrency: null, premiumBasis: null, commissionAmount: null, premiumSource: "manual", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: true }] },
      ],
      work: [], claims: [], endorsements: [], documents: [], threads: [], fileMissing: [], mailboxConnected: false,
      permissions: { canEditContacts: true, canUploadDocuments: true, canStartWork: true },
    }),
    policySpace: async (id: string) => ({
      selectedPeriodId: id === POL_OK ? PER_OK : PER_UNVERIFIED,
      cover:
        id === POL_OK
          ? { state: "active", label: "Active cover", reason: "Insurer confirmation on file.", verified: true, evidence: [{ label: "Insurer confirmation, 20 Dec 2025", documentId: null, recordedAt: "2025-12-20" }], asOf: "2026-09-29" }
          : { state: null, label: "Cover not verified", reason: "No insurer confirmation is on file.", verified: false, evidence: [], asOf: "2026-09-29" },
    }),
    setAutomationEnabled,
  },
}));

const me = {
  user: { id: ME, email: "wanjiru@example.test", full_name: "Wanjiru Kamau", display_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Tausi Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  permissions: ["placement:approve", "organization:edit"],
};

async function live() {
  const { loadLiveAdapters } = await import("./live.js");
  return (await loadLiveAdapters({ me, switchToDemo: () => {} })) as {
    records: { actor(): { name: string }; act(t: string, p: unknown, id?: string): unknown; demo: boolean; sel: { clients(): { name: string }[] } };
    ai: { workspace(ref: unknown): { title: string; statusLabel: string; blocks: unknown[] }; route(t: string, c: unknown): { lead?: string; ref?: { ws: string } } };
    greetingChips: string[];
  };
}

const text = (v: unknown) => JSON.stringify(v);

describe("live mode", () => {
  beforeEach(() => setAutomationEnabled.mockClear());

  it("reads the brokerage's own people, clients and work — and no demo records", async () => {
    const A = await live();
    expect(A.records.demo).toBe(false);
    expect(A.records.actor().name).toBe("Wanjiru Kamau");
    expect(A.records.sel.clients().map((c) => c.name)).toEqual(["Tausi Hauliers Ltd"]);
    const today = A.ai.workspace({ ws: "today" });
    expect(text(today)).toContain("Renew Tausi Hauliers motor fleet");
    expect(text(today) + text(A.greetingChips)).not.toMatch(/Acme|KDN|Karibu|Bluewave|GreenCare|Mara Foods/);
  });

  it("says Active cover only where the server verified it", async () => {
    const A = await live();
    const client = text(A.ai.workspace({ ws: "client", clientId: CLIENT }));
    expect(client).toContain("TH-MTR-001");
    const ok = A.ai.workspace({ ws: "policy", clientId: CLIENT, policyYearId: PER_OK });
    expect(ok.statusLabel).toBe("Active cover");
    const unverified = A.ai.workspace({ ws: "policy", clientId: CLIENT, policyYearId: PER_UNVERIFIED });
    expect(unverified.statusLabel).toBe("Cover not verified");
    expect(text(unverified)).not.toContain("KES 0");
  });

  it("shows what is not connected instead of example content", async () => {
    const A = await live();
    for (const ws of ["quote", "compare", "money", "reconciliation", "commission", "renewal"]) {
      const w = A.ai.workspace({ ws, clientId: CLIENT });
      expect(w.statusLabel).toBe("Not connected");
      expect(text(w)).not.toMatch(/APA|CIC|Jubilee/);
    }
    const r = A.ai.route("Get Tausi's quote ready", { clientId: CLIENT });
    if (r.ref && ["quote", "compare"].includes(r.ref.ws)) expect(r.lead).toMatch(/not connected/);
  });

  it("writes through the API, and refuses what it cannot do without changing anything", async () => {
    const A = await live();
    const toggled = (await A.records.act("automation.toggle", { id: AUTO }, "t1")) as { ok: boolean };
    expect(toggled.ok).toBe(true);
    expect(setAutomationEnabled).toHaveBeenCalledWith(AUTO, true);
    const refused = (await A.records.act("payment.match", { invoiceId: "x" }, "t2")) as { ok: boolean; error: string };
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/not connected/);
  });
});
