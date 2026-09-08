import {
  acceptInvitationResponseSchema,
  apiErrorSchema,
  actResponseSchema,
  askResponseSchema,
  createWorkItemResponseSchema,
  markDraftCopiedResponseSchema,
  runEventsResponseSchema,
  workItemResponseSchema,
  createInvitationResponseSchema,
  createOrganizationResponseSchema,
  invitationPreviewSchema,
  invitationsResponseSchema,
  meResponseSchema,
  membersResponseSchema,
  rolesResponseSchema,
  type ActRequest,
  type CreateInvitationRequest,
  type CreateWorkItemRequest,
  type CreateOrganizationRequest,
  type UpdateMemberRequest,
} from "@asap/schema";
import type { z } from "zod";
import { env } from "../env.js";
import { supabase } from "./supabase.js";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "ApiRequestError";
  }
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<S extends z.ZodTypeAny>(
  method: string,
  path: string,
  schema: S | null,
  body?: unknown,
  opts: { auth?: boolean; allow?: number[] } = { auth: true },
): Promise<z.infer<S>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) {
    const token = await accessToken();
    if (!token) throw new ApiRequestError(401, "not_signed_in");
    headers["Authorization"] = `Bearer ${token}`;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(new URL(path, env.VITE_PUBLIC_API_BASE_URL), init);
  if (!res.ok && !opts.allow?.includes(res.status)) {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => ({})));
    throw new ApiRequestError(
      res.status,
      parsed.success ? parsed.data.error : "request_failed",
      parsed.success ? parsed.data.details : undefined,
    );
  }
  if (!schema || res.status === 204) return undefined as z.infer<S>;
  // Every response is validated against the shared contract: a drift fails here, not in a component.
  return schema.parse(await res.json());
}

export const api = {
  me: () => request("GET", "/me", meResponseSchema),
  ask: (q: string) => request("GET", `/ask?q=${encodeURIComponent(q)}`, askResponseSchema),
  createWorkItem: (input: CreateWorkItemRequest) =>
    request("POST", "/work-items", createWorkItemResponseSchema, input),
  workItem: (id: string) => request("GET", `/work-items/${id}`, workItemResponseSchema),
  act: (id: string, input: ActRequest) =>
    request("POST", `/work-items/${id}/actions`, actResponseSchema, input, {
      auth: true,
      allow: [409],
    }),
  markDraftCopied: (id: string) =>
    request("POST", `/drafts/${id}/copied`, markDraftCopiedResponseSchema, {}),
  runEvents: (id: string) => request("GET", `/runs/${id}/events`, runEventsResponseSchema),
  setActiveOrganization: (organization_id: string) =>
    request("POST", "/me/active-organization", null, { organization_id }),
  createOrganization: (input: CreateOrganizationRequest) =>
    request("POST", "/organizations", createOrganizationResponseSchema, input),
  roles: () => request("GET", "/organizations/current/roles", rolesResponseSchema),
  members: () => request("GET", "/organizations/current/members", membersResponseSchema),
  updateMember: (membershipId: string, input: UpdateMemberRequest) =>
    request("PATCH", `/organizations/current/members/${membershipId}`, null, input),
  invitations: () =>
    request("GET", "/organizations/current/invitations", invitationsResponseSchema),
  invite: (input: CreateInvitationRequest) =>
    request("POST", "/organizations/current/invitations", createInvitationResponseSchema, input),
  revokeInvitation: (id: string) =>
    request("POST", `/organizations/current/invitations/${id}/revoke`, null, {}),
  invitationPreview: (token: string) =>
    request("GET", `/invitations/${token}`, invitationPreviewSchema, undefined, { auth: false }),
  acceptInvitation: (token: string) =>
    request("POST", `/invitations/${token}/accept`, acceptInvitationResponseSchema, {}),
};

/** Human-readable text for the stable error codes the API returns. */
export function describeApiError(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return "Something went wrong. Please try again.";
  const messages: Record<string, string> = {
    not_signed_in: "Please sign in again.",
    invalid_session: "Your session has expired. Please sign in again.",
    permission_denied: "Your role does not allow this.",
    not_a_member: "You are not a member of that brokerage.",
    no_active_organization: "Choose a brokerage first.",
    already_a_member: "That person is already a member.",
    invitation_expired: "This invitation has expired. Ask your administrator for a new one.",
    invitation_revoked: "This invitation was withdrawn.",
    invitation_not_pending: "This invitation has already been used.",
    invitation_email_mismatch:
      "This invitation was sent to a different email address. Sign in with that address.",
    invitation_email_failed:
      "The invitation was recorded but the email could not be sent. Try again.",
    terms_not_accepted: "You must accept the terms to continue.",
    cannot_change_owner: "The owner's role and status cannot be changed here.",
    cannot_remove_self: "You cannot remove yourself.",
    validation_failed: "Please check the highlighted fields.",
    not_found: "Not found.",
    api_only: "The server is not configured to write work items. Ask your administrator.",
    version_stale: "This changed since you looked at it. Reload.",
    evidence_required: "Say where the evidence is.",
    already_sent: "This was already recorded as sent.",
    run_already_working: "ASAP is already working on this item.",
  };
  return messages[err.code] ?? `Request failed (${err.code}).`;
}

/** Opens the run's SSE stream with the session token; EventSource cannot send headers. */
export async function streamRun(
  runId: string,
  onEvent: (event: { kind: string; data: Record<string, unknown> }) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = await accessToken();
  if (!token) throw new ApiRequestError(401, "not_signed_in");
  const res = await fetch(new URL(`/runs/${runId}/stream`, env.VITE_PUBLIC_API_BASE_URL), {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new ApiRequestError(res.status, "stream_failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let kind = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) kind = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) {
        try {
          onEvent({ kind, data: JSON.parse(data) as Record<string, unknown> });
        } catch {
          // A malformed frame is dropped; the persisted events remain the record.
        }
      }
      if (kind === "done") return;
    }
  }
}
