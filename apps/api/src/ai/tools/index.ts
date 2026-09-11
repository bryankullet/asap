import {
  CLIENT_COLUMNS,
  POLICY_COLUMNS,
  POLICY_PERIOD_COLUMNS,
  RUN_COLUMNS,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
  type AiToolDeclaration,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapDatabaseError } from "../../errors.js";

/**
 * The declared tools — the only way a model reaches brokerage data (§45 rule 6: no unrestricted
 * SQL, only declared tools).
 *
 * Four rules hold for every tool here, and they are why this file can be short:
 *
 *  1. **Read-only.** Nothing in this file writes. A model proposes actions from the finite verb
 *     vocabulary and a person approves them through the engine; it never reaches a write path.
 *  2. **Under the caller's own session.** Each tool takes the request-scoped `db`, so RLS decides
 *     what exists. A tool cannot see a row its caller could not, and a model cannot widen that by
 *     asking differently.
 *  3. **Arguments are validated before execution.** Every tool parses its own input with Zod. An
 *     argument that does not parse is an error returned to the model, not a query.
 *  4. **Results are rows, not prose.** What comes back is what the database said. The model may
 *     decide which of them to show; it never supplies the values (§45 rule 9).
 */

export type ToolContext = { db: SupabaseClient; organizationId: string };

export type DeclaredTool = {
  declaration: AiToolDeclaration;
  /** Parses its own arguments and runs the query. Throws only on a database error. */
  run(args: unknown, ctx: ToolContext): Promise<unknown>;
};

const uuid = z.string().uuid();

/** Rows, capped. A tool never hands back an unbounded result set (§42's simplicity constraints). */
const LIMIT = 20;

const findClients: DeclaredTool = {
  declaration: {
    name: "find_clients",
    description:
      "Find clients in this brokerage by name. Returns the client id, name, kind and the state of their due-diligence file. Use this to resolve a name a person used into a record before answering anything about them.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Part of the client's name." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(args);
    const { data, error } = await ctx.db
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .is("deleted_at", null)
      .ilike("name", `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      .limit(LIMIT);
    if (error) throw mapDatabaseError(error);
    return (data ?? []).map((c) => {
      const row = c as { id: string; name: string; kind: string; file_status: string };
      return { id: row.id, name: row.name, kind: row.kind, fileStatus: row.file_status };
    });
  },
};

const findWork: DeclaredTool = {
  declaration: {
    name: "find_work",
    description:
      "Find work items in this brokerage by title, and optionally for one client. Returns each item's id, title, kind, task status, the step that is waiting, and the reason it is open. This is the record of what is being done; use it before saying anything about progress.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of the item's title. Omit to list open work." },
        clientId: { type: "string", description: "Restrict to one client." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const { query, clientId } = z
      .object({ query: z.string().max(200).optional(), clientId: uuid.optional() })
      .parse(args ?? {});
    let q = ctx.db
      .from("work_items")
      .select(WORK_ITEM_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .is("deleted_at", null);
    if (clientId) q = q.eq("client_id", clientId);
    if (query) q = q.ilike("title", `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(LIMIT);
    if (error) throw mapDatabaseError(error);
    return WorkItemRow.array()
      .parse(data ?? [])
      .map((i) => {
        const now = i.steps.find((s) => s.state === "now" || s.state === "blocked");
        return {
          id: i.id,
          title: i.title,
          kind: i.kind,
          taskStatus: i.task_status,
          taskParty: i.task_party,
          coverStatus: i.cover_status,
          moneyStatus: i.money_status,
          nowStep: now ? { id: now.id, label: now.label, actor: now.actor, state: now.state } : null,
          reason: i.reason,
          // What has actually been recorded. An answer that names a fact cites one of these.
          recorded: i.steps.flatMap((s) =>
            s.recorded.map((r) => ({ step: s.label, reference: r.reference, recordedAt: r.recordedAt })),
          ),
        };
      });
  },
};

const getPolicyPeriods: DeclaredTool = {
  declaration: {
    name: "get_policy_periods",
    description:
      "List a client's policies and their periods of cover — the class of business, the insurer, the policy number and the dates. A period is the client-policy-year: never merge two of them into one answer.",
    inputSchema: {
      type: "object",
      properties: { clientId: { type: "string" } },
      required: ["clientId"],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const { clientId } = z.object({ clientId: uuid }).parse(args);
    const { data: policies, error } = await ctx.db
      .from("policies")
      .select(POLICY_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .limit(LIMIT);
    if (error) throw mapDatabaseError(error);
    const rows = (policies ?? []) as {
      id: string;
      class_of_business: string;
      policy_number: string | null;
      insurer_id: string;
    }[];
    if (rows.length === 0) return [];
    const [periodsR, insurersR] = await Promise.all([
      ctx.db.from("policy_periods").select(POLICY_PERIOD_COLUMNS).in("policy_id", rows.map((p) => p.id)),
      ctx.db.from("insurers").select("id, name").eq("organization_id", ctx.organizationId),
    ]);
    if (periodsR.error) throw mapDatabaseError(periodsR.error);
    const insurers = (insurersR.data ?? []) as { id: string; name: string }[];
    const periods = (periodsR.data ?? []) as {
      id: string;
      policy_id: string;
      period_start: string;
      period_end: string;
    }[];
    return rows.map((p) => ({
      policyId: p.id,
      classOfBusiness: p.class_of_business,
      policyNumber: p.policy_number,
      insurerName: insurers.find((i) => i.id === p.insurer_id)?.name ?? null,
      periods: periods
        .filter((pe) => pe.policy_id === p.id)
        .map((pe) => ({ id: pe.id, start: pe.period_start, end: pe.period_end })),
    }));
  },
};

const getRecordEvidence: DeclaredTool = {
  declaration: {
    name: "get_record_evidence",
    description:
      "What has actually been recorded against one work item: every step, its state, and the references a person recorded against it. Use this to ground a claim. If the evidence for a claim is not here, say it is missing rather than inferring it.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const { recordId } = z.object({ recordId: uuid }).parse(args);
    const { data, error } = await ctx.db
      .from("work_items")
      .select(WORK_ITEM_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .eq("id", recordId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) return null;
    const item = WorkItemRow.parse(data);
    return {
      id: item.id,
      title: item.title,
      kind: item.kind,
      coverStatus: item.cover_status,
      moneyStatus: item.money_status,
      exception: item.exception,
      steps: item.steps.map((s) => ({
        id: s.id,
        label: s.label,
        state: s.state,
        actor: s.actor,
        party: s.party,
        blockedReason: s.reason,
        // What the step needs, and what is actually on file for it.
        requires: s.evidence.map((e) => e.label),
        recorded: s.recorded.map((r) => ({
          reference: r.reference,
          recordedBy: r.recordedBy,
          recordedAt: r.recordedAt,
        })),
      })),
    };
  },
};

const getRuns: DeclaredTool = {
  declaration: {
    name: "get_runs",
    description:
      "What ASAP has done on a record: each run, its status and what it could not finish. A finished run means ASAP produced an output; it never means a policy was renewed, cover confirmed, a claim accepted or money received.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
      additionalProperties: false,
    },
  },
  async run(args, ctx) {
    const { recordId } = z.object({ recordId: uuid }).parse(args);
    const { data, error } = await ctx.db
      .from("runs")
      .select(RUN_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .eq("work_item_id", recordId)
      .order("started_at", { ascending: false })
      .limit(LIMIT);
    if (error) throw mapDatabaseError(error);
    return (data ?? []).map((r) => {
      const row = r as { id: string; title: string; status: string; next_step: string | null; started_at: string };
      return { id: row.id, title: row.title, status: row.status, nextStep: row.next_step, startedAt: row.started_at };
    });
  },
};

/** Every tool the model may be told about. Nothing outside this list is reachable. */
export const DECLARED_TOOLS: readonly DeclaredTool[] = [
  findClients,
  findWork,
  getPolicyPeriods,
  getRecordEvidence,
  getRuns,
];

export const TOOL_DECLARATIONS: AiToolDeclaration[] = DECLARED_TOOLS.map((t) => t.declaration);

export function toolByName(name: string): DeclaredTool | undefined {
  return DECLARED_TOOLS.find((t) => t.declaration.name === name);
}
