import type { MembershipSummary, OrganizationSummary, RoleSummary } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, mapDatabaseError } from "./errors.js";

export type RequestContext = {
  profile: {
    id: string;
    email: string;
    full_name: string | null;
    display_name: string | null;
    active_organization_id: string | null;
  };
  memberships: MembershipSummary[];
  /** Null unless users.active_organization_id points at an organization with an ACTIVE membership. */
  activeOrganization: OrganizationSummary | null;
  activeMembership: MembershipSummary | null;
  /** "object_type:verb" for the active organization. */
  permissions: Set<string>;
};

type MembershipRow = {
  id: string;
  is_owner: boolean;
  status: "active" | "suspended" | "removed";
  joined_at: string;
  organization: OrganizationSummary | null;
  role: RoleSummary | null;
};

/**
 * §45 rule 5: organization, role and permissions are resolved here, from the session, on every
 * request. The browser never supplies them. A membership that is no longer active drops the
 * active organization to null immediately, whatever users.active_organization_id says.
 */
export async function resolveContext(db: SupabaseClient, userId: string): Promise<RequestContext> {
  const profileQ = db
    .from("users")
    .select("id, email, full_name, display_name, active_organization_id")
    .eq("id", userId)
    .maybeSingle();

  const membershipsQ = db
    .from("organization_memberships")
    .select(
      `id, is_owner, status, joined_at,
       organization:organizations ( id, name, country, currency, timezone ),
       role:roles ( id, key, name, description, is_system )`,
    )
    .eq("user_id", userId)
    .neq("status", "removed")
    .order("joined_at", { ascending: true });

  const [profileR, membershipsR] = await Promise.all([profileQ, membershipsQ]);
  if (profileR.error) throw mapDatabaseError(profileR.error);
  if (membershipsR.error) throw mapDatabaseError(membershipsR.error);
  if (!profileR.data) {
    // auth.users exists but the 0004 trigger has not produced a profile: treat as a server fault.
    throw new HttpError(500, "profile_missing");
  }

  const memberships: MembershipSummary[] = ((membershipsR.data ?? []) as unknown as MembershipRow[])
    .filter((m) => m.organization && m.role)
    .map((m) => ({
      id: m.id,
      organization: m.organization as OrganizationSummary,
      role: m.role as RoleSummary,
      is_owner: m.is_owner,
      status: m.status,
      joined_at: m.joined_at,
    }));

  const activeMembership =
    memberships.find(
      (m) => m.status === "active" && m.organization.id === profileR.data!.active_organization_id,
    ) ?? null;

  const permissions = new Set<string>();
  if (activeMembership) {
    const permsR = await db
      .from("role_permissions")
      .select("permission:permissions ( object_type, verb )")
      .eq("role_id", activeMembership.role.id);
    if (permsR.error) throw mapDatabaseError(permsR.error);
    for (const row of (permsR.data ?? []) as unknown as {
      permission: { object_type: string; verb: string } | null;
    }[]) {
      if (row.permission) permissions.add(`${row.permission.object_type}:${row.permission.verb}`);
    }
  }

  return {
    profile: profileR.data,
    memberships,
    activeOrganization: activeMembership?.organization ?? null,
    activeMembership,
    permissions,
  };
}

/** Throws 409 when the caller has no active organization. */
export function requireActiveOrganization(ctx: RequestContext): OrganizationSummary {
  if (!ctx.activeOrganization) throw new HttpError(409, "no_active_organization");
  return ctx.activeOrganization;
}

export function hasPermission(ctx: RequestContext, objectType: string, verb: string): boolean {
  return ctx.permissions.has(`${objectType}:${verb}`);
}
