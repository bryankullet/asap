import {
  apiErrorSchema,
  attentionResponseSchema,
  createClientResponseSchema,
  documentDetailSchema,
  experienceListResponseSchema,
  experienceResponseSchema,
  homeChangesResponseSchema,
  meResponseSchema,
  saveUiStateResponseSchema,
  workListResponseSchema,
  workflowActionResponseSchema,
  type ExperienceUiState,
  type SubjectRef,
} from "@asap/schema";
import { z } from "zod";
import { accessToken } from "./auth.js";
import { env } from "./env.js";

/**
 * The only way this application talks to ASAP: authenticated, validated against the shared
 * contracts, with a fixed list of endpoints. There is no generic `request(url)` export — a composed
 * action can reach only what is named here (ActionDispatcher maps each action kind to one of these).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly userMessage: string | null = null,
    readonly body: unknown = null,
  ) {
    super(`${status} ${code}`);
  }
}

async function request<S extends z.ZodTypeAny>(method: string, path: string, schema: S | null, body?: unknown, allow: number[] = []): Promise<z.infer<S>> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, "not_signed_in", "Sign in to continue.");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(new URL(path, env.VITE_PUBLIC_API_BASE_URL), { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ApiError(0, "api_unreachable", "ASAP could not be reached. Check the connection and try again.");
  }
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok && !allow.includes(res.status)) {
    const e = apiErrorSchema.safeParse(json);
    throw new ApiError(res.status, e.success ? e.data.error : "request_failed", e.success ? (e.data.message ?? null) : null, json);
  }
  if (!schema) return undefined as z.infer<S>;
  const parsed = schema.safeParse(json);
  // A response that does not match the contract is a different build, never something to render.
  if (!parsed.success) throw new ApiError(res.status, "contract_mismatch", "ASAP answered in a form this page does not understand. Reload to get the latest version.");
  return parsed.data;
}

const decideResponse = z.object({}).passthrough();

export const api = {
  me: () => request("GET", "/me", meResponseSchema),
  setActiveOrganization: (organizationId: string) => request("POST", "/me/active-organization", null, { organization_id: organizationId }),
  attention: () => request("GET", "/attention", attentionResponseSchema),
  handling: () => request("GET", "/work?view=progress&limit=5", workListResponseSchema),
  changes: () => request("GET", "/home/changes", homeChangesResponseSchema),

  experiences: () => request("GET", "/experiences", experienceListResponseSchema),
  startExperience: (text: string, subject: SubjectRef | null = null) => request("POST", "/experiences", experienceResponseSchema, { text, subject }),
  experience: (id: string) => request("GET", `/experiences/${encodeURIComponent(id)}`, experienceResponseSchema),
  ask: (id: string, text: string, baseRevision: number) => request("POST", `/experiences/${encodeURIComponent(id)}/ask`, experienceResponseSchema, { text, baseRevision }),
  event: (id: string, body: { kind: "action_result"; action: string; ref: SubjectRef | null; outcome: "done" | "already" | "blocked" | "refused" } | { kind: "select"; ref: SubjectRef } | { kind: "deselect" }) =>
    request("POST", `/experiences/${encodeURIComponent(id)}/events`, experienceResponseSchema, body),
  saveUi: (id: string, baseVersion: number, ui: ExperienceUiState) => request("PUT", `/experiences/${encodeURIComponent(id)}/state`, saveUiStateResponseSchema, { baseVersion, ui }, [409]),

  /* The governed business endpoints a composed action may reach — each checks permission again. */
  createClient: (input: { name: string; kind: "corporate" | "individual"; confirmNew: boolean; contact?: { fullName: string; roleLabel: string | null; email: string | null; phone: string | null } }) =>
    // 409 carries the duplicate review (possible_duplicates): an answer to show, not a failure.
    request("POST", "/clients", createClientResponseSchema, input, [409]),
  // Opens the renewal Work for the period and starts ASAP's renewal run; 409 carries "blocked" with its reason.
  startRenewal: (policyPeriodId: string) => request("POST", "/workflows/renewals", workflowActionResponseSchema, { policyPeriodId }, [409]),
  decideApproval: (approvalId: string, decision: "approve" | "reject", bundleSha256: string, note?: string) =>
    request("POST", `/workflow-approvals/${encodeURIComponent(approvalId)}/decide`, decideResponse, { decision, bundleSha256, ...(note ? { note } : {}) }),
  document: (documentId: string) => request("GET", `/documents/${encodeURIComponent(documentId)}`, documentDetailSchema),
};
