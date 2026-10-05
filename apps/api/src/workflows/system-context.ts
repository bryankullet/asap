import type { RequestContext } from "../context.js";

/**
 * A read-only context for a workflow step that reuses a view built for a person (D-141): no
 * permissions, so every "can this person…" in the view reads false, and nothing in it acts. Steps
 * never use it to authorise a write — their writes go through the shared service functions.
 */
export function systemReadContext(organizationId: string): RequestContext {
  return {
    profile: { id: "00000000-0000-4000-8000-000000000000", email: "asap@system.invalid", full_name: "ASAP", display_name: "ASAP", active_organization_id: organizationId },
    memberships: [],
    activeOrganization: null,
    activeMembership: null,
    permissions: new Set<string>(),
  } as unknown as RequestContext;
}
