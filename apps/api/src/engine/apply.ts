import {
  GATE_MESSAGE,
  NO_AGREED_RATE,
  deriveTask,
  fileClearsPlacement,
  type ActRequest,
  type AgreedRate,
  type EvidenceRecord,
  type FileStatus,
  type GuardRef,
  type Step,
  type WorkItemRow,
} from "@asap/schema";

/**
 * The work item engine, pure (UI Build Spec v1 Part 5). One verb on one step produces either a
 * new set of steps plus the effects the route must perform (start a run, create a draft, record a
 * send), or a named guard with a plain-language reason. Nothing here touches a database, so the
 * guards are tested without one; the database re-checks version and evidence at execution.
 */

export type Ctx = { userId: string; now: Date; roleKey?: string | null | undefined };

/**
 * Facts the route loads before evaluating guards, so the engine stays pure. Null means "no such
 * thing on this item" (no client linked, no insurer/class), which is not the same as a passing fact.
 */
export type GuardFacts = {
  /** Effective client file state, or null when the item has no client. */
  clientFileState: FileStatus | null;
  /** The confirmed agreed rate for this item's insurer and class, null when none, undefined when not applicable. */
  agreedRate: AgreedRate | undefined;
  clientId?: string | null;
};
export const NO_FACTS: GuardFacts = { clientFileState: null, agreedRate: undefined };

export type Effects = {
  startRun?: { stepId: string; title: string };
  createDraft?: { stepId: string; to: string; subject: string; body: string };
  recordSend?: { draftId: string; evidence: string; outcomeUnknown: boolean };
  assign?: { ownerId: string };
  /** approve at X01 with the client file not cleared: the database re-checks, audits, and creates the principal's item. */
  approveWithOverride?: { reason: string };
  approve?: true;
};

export type Derived = {
  steps: Step[];
  task: {
    status: WorkItemRow["task_status"];
    party: string | null;
    since: string | null;
    nextCheck: string | null;
  };
  cover: WorkItemRow["cover_status"];
  money: WorkItemRow["money_status"];
  exception: WorkItemRow["exception"];
  completedAt: string | null;
};

export type ApplyResult =
  | { kind: "applied"; derived: Derived; effects: Effects; auditAction: string }
  | { kind: "blocked"; guard: string; reason: string };

/** How long to wait before checking on an outside party. A hypothesis, not a rule (OPERATOR-VALIDATION). */
export const DEFAULT_NEXT_CHECK_DAYS = 3;

const blocked = (guard: string, reason: string): ApplyResult => ({
  kind: "blocked",
  guard,
  reason,
});

function guardId(g: GuardRef): string {
  return typeof g === "string" ? g : g.id;
}

/**
 * Evaluates one guard for one action. Returns null when it passes. Guards the product cannot
 * evaluate yet block with a reason that says so; a guard never passes by omission.
 */
export function evaluateGuard(
  g: GuardRef,
  item: WorkItemRow,
  step: Step,
  req: ActRequest,
  facts: GuardFacts = NO_FACTS,
  ctx?: Ctx,
): { guard: string; reason: string } | null {
  const id = guardId(g);
  switch (id) {
    case "client_file_cleared": {
      if (facts.clientFileState && fileClearsPlacement(facts.clientFileState)) return null;
      if (req.override?.reason?.trim()) {
        if (ctx?.roleKey === "brokerage_admin") return null;
        return {
          guard: id,
          reason:
            "Only the principal officer (brokerage administrator) can override the client-file gate.",
        };
      }
      const state = facts.clientFileState
        ? facts.clientFileState.replaceAll("_", " ")
        : "not on record";
      const link = facts.clientId ? ` Open the client's file at /files/${facts.clientId}.` : "";
      return { guard: id, reason: `${GATE_MESSAGE} The file is ${state}.${link}` };
    }
    case "agreed_rate_exists": {
      if (facts.agreedRate === undefined)
        return { guard: id, reason: "No insurer and class on this item to look a rate up for." };
      if (facts.agreedRate === null) return { guard: id, reason: NO_AGREED_RATE };
      return null;
    }
    case "evidence_present": {
      if (req.verb === "complete") {
        const missing = item.steps.filter(
          (s) => s.evidence.length > 0 && s.recorded.length === 0 && s.id !== step.id,
        );
        if (missing.length > 0) {
          return {
            guard: id,
            reason: `Missing evidence: ${missing.map((s) => s.evidence.map((e) => e.label).join("; ")).join("; ")}.`,
          };
        }
        return null;
      }
      if (!req.evidence || req.evidence.trim().length === 0) {
        const wanted =
          step.evidence.map((e) => e.label).join("; ") || "a reference for what happened";
        return { guard: id, reason: `Record what you are relying on: ${wanted}.` };
      }
      return null;
    }
    case "version_current":
      if (req.version !== item.version) {
        return {
          guard: id,
          reason: "This item changed since you looked at it. Reload to see the current version.",
        };
      }
      return null;
    case "component_declared":
      // Vacuous until premium figures exist on a step (Phase 3): nothing undeclared can be compared.
      return null;
    case "no_duplicate_open":
      return null; // enforced atomically by work_item_create
    case "authority_sufficient":
    case "certificate_unissued":
    case "business_rule_exists":
    case "stock_available":
    case "screening_source_configured":
      return {
        guard: id,
        reason: `${id.replaceAll("_", " ")} cannot be checked yet, so this stays blocked rather than assumed.`,
      };
    default:
      return { guard: id, reason: `Unknown guard ${id}; blocked rather than assumed.` };
  }
}

function withStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/** Marks `id` done and the next todo step now. */
export function advance(steps: Step[], id: string): Step[] {
  const done = withStep(steps, id, { state: "done", reason: null });
  const idx = done.findIndex((s) => s.id === id);
  const next = done.findIndex((s, i) => i > idx && s.state === "todo");
  return next === -1 ? done : done.map((s, i) => (i === next ? { ...s, state: "now" } : s));
}

export function deriveFrom(
  item: WorkItemRow,
  steps: Step[],
  ctx: Ctx,
  over: Partial<Derived> = {},
): Derived {
  const task = deriveTask(steps);
  const nowStep = steps.find((s) => s.state === "now");
  const sinceKeeps =
    item.task_status === "with_party" &&
    task.status === "with_party" &&
    item.task_party === task.party;
  const since =
    task.status === "with_party" ? (sinceKeeps ? item.task_since : ctx.now.toISOString()) : null;
  const nextCheck =
    task.status === "with_party"
      ? sinceKeeps
        ? item.task_next_check
        : new Date(ctx.now.getTime() + DEFAULT_NEXT_CHECK_DAYS * 86_400_000).toISOString()
      : null;
  void nowStep;
  return {
    steps,
    task: { status: task.status, party: task.party, since, nextCheck },
    cover: item.cover_status,
    money: item.money_status,
    exception: item.exception,
    completedAt: task.status === "done" ? (item.completed_at ?? ctx.now.toISOString()) : null,
    ...over,
  };
}

/** Templates for the two drafts the renewal produces. Values come from the item, never a model. */
export function draftFor(
  item: WorkItemRow,
  step: Step,
  to: string,
): { to: string; subject: string; body: string } {
  const client = item.title.split(" — ")[0] ?? item.title;
  if (step.id === "present") {
    return {
      to,
      subject: `${client} — renewal options`,
      body: `Dear ${client},\n\nPlease find the renewal options for the coming period. The comparison is attached; we recommend discussing it before the expiry date.\n\nKind regards`,
    };
  }
  return {
    to,
    subject: `${client} — renewal terms request`,
    body: `Dear ${to || "Underwriter"},\n\nPlease provide renewal terms for ${client} for the coming period on the expiring basis, noting any changes we have listed.\n\nKind regards`,
  };
}

export function applyAction(
  item: WorkItemRow,
  req: ActRequest,
  ctx: Ctx,
  facts: GuardFacts = NO_FACTS,
): ApplyResult {
  if (item.task_status === "done" || item.exception) {
    return blocked(
      "version_current",
      "This item is closed. Open a new one if the work has started again.",
    );
  }
  const step = item.steps.find((s) => s.id === req.stepId);
  if (!step) return blocked("version_current", "That step no longer exists on this item. Reload.");
  const action = step.actions.find((a) => a.verb === req.verb);
  if (!action && req.verb !== "assign" && req.verb !== "open") {
    return blocked("version_current", `"${req.verb}" is not an action on this step.`);
  }
  if (
    step.state !== "now" &&
    step.state !== "blocked" &&
    req.verb !== "assign" &&
    req.verb !== "open"
  ) {
    return blocked("version_current", `${step.label} is not the current step.`);
  }
  // Every guard on the action and on the step, re-evaluated now (spec Part 5.3).
  const guards = [
    ...(action?.guards ?? []),
    ...(req.verb === "complete" || req.verb === "approve" ? step.guards : []),
  ];
  for (const g of new Set(guards.map((g) => JSON.stringify(g)))) {
    const fail = evaluateGuard(JSON.parse(g) as GuardRef, item, step, req, facts, ctx);
    if (fail) return blocked(fail.guard, fail.reason);
  }
  if (req.version !== item.version) {
    return blocked(
      "version_current",
      "This item changed since you looked at it. Reload to see the current version.",
    );
  }

  const evidence = (kind: EvidenceRecord["kind"]): EvidenceRecord => ({
    kind,
    reference: (req.evidence ?? "").trim(),
    recordedBy: ctx.userId,
    recordedAt: ctx.now.toISOString(),
  });

  switch (req.verb) {
    case "open":
      return blocked("version_current", "Open navigates; it changes nothing.");
    case "prepare": {
      const steps = withStep(item.steps, step.id, { state: "now", reason: null });
      return {
        kind: "applied",
        derived: deriveFrom(item, steps, ctx, {
          task: { status: "in_progress", party: null, since: null, nextCheck: null },
        }),
        effects: { startRun: { stepId: step.id, title: runTitleFor(step) } },
        auditAction: "work_item.prepare",
      };
    }
    case "draft": {
      const to = req.to?.trim() || step.party || "";
      return {
        kind: "applied",
        derived: deriveFrom(item, item.steps, ctx),
        effects: { createDraft: { stepId: step.id, ...draftFor(item, step, to) } },
        auditAction: "work_item.draft",
      };
    }
    case "record_send": {
      const steps = advance(
        withStep(item.steps, step.id, { recorded: [...step.recorded, evidence("record_send")] }),
        step.id,
      );
      const effects: Effects = {};
      if (req.draftId)
        effects.recordSend = {
          draftId: req.draftId,
          evidence: req.evidence!.trim(),
          outcomeUnknown: req.outcomeUnknown ?? false,
        };
      // The next step is with the party the send went to, if it names none itself.
      const next = steps.find((s) => s.state === "now");
      const named =
        next && next.actor !== "you" && next.actor !== "asap" && !next.party && req.party
          ? withStep(steps, next.id, { party: req.party.trim() })
          : steps;
      return {
        kind: "applied",
        derived: deriveFrom(item, named, ctx),
        effects,
        auditAction: "work_item.record_send",
      };
    }
    case "record_evidence": {
      const kind = step.evidence[0]?.kind ?? "document";
      const steps = advance(
        withStep(item.steps, step.id, { recorded: [...step.recorded, evidence(kind)] }),
        step.id,
      );
      // Cover moves to Confirmed only on the insurer's written confirmation (Part 6.2 step 5).
      const cover =
        step.id === "cover_confirmed" && item.kind === "placement"
          ? ("confirmed" as const)
          : item.cover_status;
      return {
        kind: "applied",
        derived: deriveFrom(item, steps, ctx, { cover }),
        effects: {},
        auditAction: "work_item.record_evidence",
      };
    }
    case "complete": {
      const steps = item.steps.map((s) => ({ ...s, state: "done" as const, reason: null }));
      return {
        kind: "applied",
        derived: deriveFrom(item, steps, ctx, { completedAt: ctx.now.toISOString() }),
        effects: {},
        auditAction: "work_item.completed",
      };
    }
    case "exception": {
      if (!req.exceptionKind || !req.reason?.trim()) {
        return blocked("evidence_present", "Name the kind of exception and type the reason.");
      }
      if (req.exceptionKind === "lapse" && !req.clientToldEvidence?.trim()) {
        return blocked(
          "evidence_present",
          "A lapse needs a record that the client was told in writing.",
        );
      }
      const steps = item.steps.map((s) =>
        s.state === "done"
          ? s
          : { ...s, state: "done" as const, reason: `Closed: ${req.exceptionKind}` },
      );
      return {
        kind: "applied",
        derived: deriveFrom(item, steps, ctx, {
          cover:
            req.exceptionKind === "lapse" || req.exceptionKind === "cancellation"
              ? req.exceptionKind === "lapse"
                ? "expired"
                : "cancelled"
              : item.cover_status,
          exception: {
            kind: req.exceptionKind,
            reason: req.reason.trim(),
            clientToldEvidence: req.clientToldEvidence?.trim() ?? null,
            recordedBy: ctx.userId,
            recordedAt: ctx.now.toISOString(),
          },
          completedAt: ctx.now.toISOString(),
        }),
        effects: {},
        auditAction: `work_item.exception.${req.exceptionKind}`,
      };
    }
    case "assign": {
      if (!req.assigneeId) return blocked("evidence_present", "Choose who this goes to.");
      return {
        kind: "applied",
        derived: deriveFrom(item, item.steps, ctx),
        effects: { assign: { ownerId: req.assigneeId } },
        auditAction: "work_item.assigned",
      };
    }
    case "approve": {
      const overriding =
        !(facts.clientFileState && fileClearsPlacement(facts.clientFileState)) &&
        Boolean(req.override?.reason?.trim());
      const steps = advance(
        withStep(item.steps, step.id, {
          recorded: [
            ...step.recorded,
            {
              kind: "approval",
              reference: overriding
                ? `Approved with client-file override: ${req.override!.reason.trim()}`
                : `Approved by ${ctx.userId}`,
              recordedBy: ctx.userId,
              recordedAt: ctx.now.toISOString(),
            },
          ],
        }),
        step.id,
      );
      const effects: Effects = overriding
        ? { approveWithOverride: { reason: req.override!.reason.trim() } }
        : { approve: true };
      return {
        kind: "applied",
        derived: deriveFrom(item, steps, ctx),
        effects,
        auditAction: overriding ? "placement.approved.override" : "placement.approved",
      };
    }
    case "resolve":
      return blocked("version_current", `${req.verb} is not part of any workflow in this phase.`);
  }
}

/** Run titles name the output (Part 8). The recipe supplies them; a step label is the fallback. */
export function runTitleFor(step: Step): string {
  const titles: Record<string, string> = {
    file_check: "Client file checked",
    review: "Renewal pack prepared",
    compare: "Term comparison prepared",
    prepare: "Placement prepared",
    documents: "Policy documents checked",
  };
  return titles[step.id] ?? step.label;
}
