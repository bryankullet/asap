import type { ASAPExperienceSpec } from "@asap/schema";

/**
 * Reconciling a new composition with the one on screen (D-172), by stable instance identity.
 *
 * - An older revision never replaces a newer one (out-of-order responses are dropped).
 * - An instance whose content hash is unchanged is the same instance: React keeps it mounted by its
 *   key, so its local state (drafts, selection, scroll, open disclosures) survives.
 * - Changed and new instances are marked, so the change is visible without moving focus.
 * - An action the person started that the new composition no longer offers is reported with the
 *   reason, never silently turned into a different action.
 */
export type Reconciled = {
  spec: ASAPExperienceSpec;
  stale: boolean;
  changed: ReadonlySet<string>;
  added: ReadonlySet<string>;
  removed: readonly string[];
  withdrawnPending: readonly { action: string; reason: string }[];
};

export function reconcile(prev: ASAPExperienceSpec | null, next: ASAPExperienceSpec, pending: ReadonlySet<string> = new Set()): Reconciled {
  if (prev && prev.experienceId === next.experienceId && next.revision < prev.revision) {
    return { spec: prev, stale: true, changed: new Set(), added: new Set(), removed: [], withdrawnPending: [] };
  }
  const sameExperience = !!prev && prev.experienceId === next.experienceId;
  const before = new Map((sameExperience ? prev!.components : []).map((c) => [c.instance, c]));
  const changed = new Set<string>();
  const added = new Set<string>();
  for (const c of next.components) {
    const old = before.get(c.instance);
    if (!old) {
      if (sameExperience) added.add(c.instance);
    } else if (old.hash !== c.hash || old.component !== c.component) changed.add(c.instance);
  }
  const nextIds = new Set(next.components.map((c) => c.instance));
  const removed = sameExperience ? [...before.keys()].filter((id) => !nextIds.has(id)) : [];
  const offered = new Map(next.actions.map((a) => [a.id, a]));
  const withdrawnPending = [...pending]
    .filter((id) => !offered.has(id) || offered.get(id)!.disabledReason)
    .map((id) => ({
      action: id,
      reason: offered.get(id)?.disabledReason ?? next.withdrawn.find((w) => w.action === id)?.reason ?? "This step is no longer available: the records changed while it was open.",
    }));
  return { spec: next, stale: false, changed, added, removed, withdrawnPending };
}

/**
 * Orders concurrent requests: each gets a ticket; a response is applied only if no later request's
 * response has been applied already. Multiple pending requests may finish in any order.
 */
export class RequestSequencer {
  private issued = 0;
  private applied = 0;
  ticket(): number {
    return ++this.issued;
  }
  accept(ticket: number): boolean {
    if (ticket < this.applied) return false;
    this.applied = ticket;
    return true;
  }
  get pending(): number {
    return this.issued - this.applied;
  }
}
