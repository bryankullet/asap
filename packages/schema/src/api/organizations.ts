import { z } from "zod";
import { countryCodeSchema, currencyCodeSchema, timezoneSchema, uuidSchema } from "./common.js";

export const DEFAULT_ROLE_KEYS = [
  "brokerage_admin",
  "account_executive",
  "placement_officer",
  "policy_administrator",
  "claims_officer",
  "renewals_officer",
  "finance_officer",
  "manager",
  "read_only",
] as const;
export const roleKeySchema = z.enum(DEFAULT_ROLE_KEYS);
export type RoleKey = z.infer<typeof roleKeySchema>;

export const membershipStatusSchema = z.enum(["active", "suspended", "removed"]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const organizationSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  country: z.string(),
  currency: z.string(),
  timezone: z.string(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const roleSummarySchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_system: z.boolean(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const membershipSummarySchema = z.object({
  id: uuidSchema,
  organization: organizationSummarySchema,
  role: roleSummarySchema,
  is_owner: z.boolean(),
  status: membershipStatusSchema,
  joined_at: z.string(),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

/** GET /me */
export const meResponseSchema = z.object({
  user: z.object({
    id: uuidSchema,
    email: z.string(),
    full_name: z.string().nullable(),
    display_name: z.string().nullable(),
  }),
  memberships: z.array(membershipSummarySchema),
  /** Resolved server-side: null when the user has no active membership. */
  active_organization: organizationSummarySchema.nullable(),
  /** "object_type:verb" pairs for the active organization. Empty without one. */
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** POST /organizations — §7 Step 1 */
export const createOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legal_name: z.string().trim().max(200).optional(),
  country: countryCodeSchema,
  currency: currencyCodeSchema,
  timezone: timezoneSchema,
  accepted_terms: z.literal(true, {
    error: "You must accept the data-processing and security terms",
  }),
  /** One uuid per form mount. A repeat with the same key returns the same brokerage (0029). */
  request_key: uuidSchema,
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

export const createOrganizationResponseSchema = z.object({ organization_id: uuidSchema });
export type CreateOrganizationResponse = z.infer<typeof createOrganizationResponseSchema>;

/** POST /me/active-organization */
export const setActiveOrganizationRequestSchema = z.object({ organization_id: uuidSchema });
export type SetActiveOrganizationRequest = z.infer<typeof setActiveOrganizationRequestSchema>;

/** GET /organizations/current/members */
export const memberSchema = z.object({
  membership_id: uuidSchema,
  user: z.object({
    id: uuidSchema,
    email: z.string(),
    full_name: z.string().nullable(),
    display_name: z.string().nullable(),
    last_seen_at: z.string().nullable(),
  }),
  role: roleSummarySchema,
  is_owner: z.boolean(),
  status: membershipStatusSchema,
  joined_at: z.string(),
});
export type Member = z.infer<typeof memberSchema>;
export const membersResponseSchema = z.object({ members: z.array(memberSchema) });
export type MembersResponse = z.infer<typeof membersResponseSchema>;

/** PATCH /organizations/current/members/:membershipId */
export const updateMemberRequestSchema = z
  .object({
    role_id: uuidSchema.optional(),
    status: membershipStatusSchema.optional(),
  })
  .refine((v) => v.role_id !== undefined || v.status !== undefined, {
    message: "provide role_id or status",
  });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

/** GET /organizations/current/roles */
export const rolesResponseSchema = z.object({ roles: z.array(roleSummarySchema) });
export type RolesResponse = z.infer<typeof rolesResponseSchema>;
