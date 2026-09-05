import {
  acceptInvitationResponseSchema,
  apiErrorSchema,
  createInvitationResponseSchema,
  createOrganizationResponseSchema,
  invitationPreviewSchema,
  invitationsResponseSchema,
  meResponseSchema,
  membersResponseSchema,
  rolesResponseSchema,
  type CreateInvitationRequest,
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
  opts: { auth?: boolean } = { auth: true },
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
  if (!res.ok) {
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
  };
  return messages[err.code] ?? `Request failed (${err.code}).`;
}
