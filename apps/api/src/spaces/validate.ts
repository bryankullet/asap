import {
  ActionVerb,
  SPACE_BLOCK_LIMIT,
  spacePlanSchema,
  type SpacePlan,
  type WorkItemRow,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDatabaseError } from "../errors.js";
import { validateAgainstSchema } from "./jsonschema.js";

/**
 * The server-side plan validator (D-059; UI Build Spec Part 4.2; Architecture §18).
 *
 * Every plan passes this before it reaches the browser — whether a recipe built it or, later, a
 * model returned it. A plan that fails any rule is **discarded**, not repaired: the Space shows a
 * state and the failure is logged with its reasons. The rules, in order:
 *
 *  1. Shape         — parses as a `SpacePlan`, or nothing else is attempted.
 *  2. Limit         — no more blocks than `SPACE_BLOCK_LIMIT`. Over the limit is a rejection, not
 *                     a truncation: a plan someone trimmed is not the plan that was validated.
 *  3. Component     — exists in `component_definitions` at the requested version, and is not
 *                     deprecated. Nothing outside the registry renders.
 *  4. Space type    — the component is allowed in this Space type.
 *  5. Properties    — validate against the *stored* JSON Schema, not a type in code.
 *  6. Record        — the plan's record resolved for this caller under RLS. A record the caller
 *                     cannot read is a fabrication, not a permission error: reject, and do not
 *                     reveal that it exists (Part 4.2 step 3).
 *  7. Actions       — a finite verb, on a step that exists on the record, only on a block the
 *                     registry lets carry one, and never enabled when the record's own step says
 *                     it is not. A model cannot invent an action or unblock a guard.
 *  8. Permissions   — the caller holds what the component requires, or the block never leaves the
 *                     server (§34: filter before sending, never render-then-hide).
 *  9. Evidence      — a block the registry marks as requiring evidence carries at least one
 *                     reference. Missing evidence renders as *no source on file*, never silently.
 * 10. Derived facts — no block may carry progress, a percentage, a confidence, or a cover or money
 *                     status. Those are derived from steps and columns and never travel in a plan
 *                     (§45 rules 9, 10; Screen Map v1 Part 1's two banned components).
 */

export type ValidationFailure = { rule: string; detail: string };

export type ComponentDefinition = {
  component_id: string;
  version: number;
  allowed_spaces: string[];
  required_permissions: string[];
  can_contain_action: boolean;
  requires_evidence: boolean;
  props_schema: unknown;
  deprecated_at: string | null;
};

/** Keys a plan may never carry, at any depth. Each is derived elsewhere or banned outright. */
const DERIVED_KEYS = [
  "progress",
  "percent",
  "percentage",
  "completion",
  "confidence",
  "score",
  "coverStatus",
  "cover_status",
  "moneyStatus",
  "money_status",
];

/** `coverStatus` on a PolicyCard is the record's own column, so the card declares it explicitly. */
const DERIVED_KEY_EXEMPTIONS: Record<string, string[]> = {
  PolicyCard: ["coverStatus"],
};

function findDerivedKeys(value: unknown, allowed: string[], path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findDerivedKeys(v, allowed, `${path}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
    if (DERIVED_KEYS.includes(key) && !allowed.includes(key)) out.push(path ? `${path}.${key}` : key);
    out.push(...findDerivedKeys(sub, allowed, path ? `${path}.${key}` : key));
  }
  return out;
}

/** Loads the registry rows a plan needs. One query, whatever the plan asks for. */
export async function loadDefinitions(
  db: SupabaseClient,
  wanted: { component: string; version: number }[],
): Promise<ComponentDefinition[]> {
  if (wanted.length === 0) return [];
  const { data, error } = await db
    .from("component_definitions")
    .select(
      "component_id, version, allowed_spaces, required_permissions, can_contain_action, requires_evidence, props_schema, deprecated_at",
    )
    .in("component_id", [...new Set(wanted.map((w) => w.component))]);
  if (error) throw mapDatabaseError(error);
  return (data ?? []) as ComponentDefinition[];
}

export type ValidateInput = {
  plan: unknown;
  /** The record, already read under the caller's RLS. Null means the caller cannot see it. */
  record: WorkItemRow | null;
  definitions: ComponentDefinition[];
  /** "object:verb" strings for the caller's active brokerage, resolved from the session. */
  permissions: Set<string>;
};

export type ValidateResult =
  | { ok: true; plan: SpacePlan }
  | { ok: false; failures: ValidationFailure[] };

export function validatePlan(input: ValidateInput): ValidateResult {
  const failures: ValidationFailure[] = [];

  // 1. Shape.
  const parsed = spacePlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return {
      ok: false,
      failures: parsed.error.issues.map((i) => ({
        rule: "shape",
        detail: `${i.path.join(".") || "plan"}: ${i.message}`,
      })),
    };
  }
  const plan = parsed.data;

  // 2. Limit.
  if (plan.blocks.length > SPACE_BLOCK_LIMIT) {
    failures.push({
      rule: "block_limit",
      detail: `${plan.blocks.length} blocks; the limit is ${SPACE_BLOCK_LIMIT}`,
    });
  }

  // 6. Record. Checked before the blocks, because nothing about an unreadable record is safe.
  if (!input.record) {
    return {
      ok: false,
      failures: [{ rule: "record_unreadable", detail: "the record does not resolve for this caller" }],
    };
  }
  if (input.record.id !== plan.recordId) {
    failures.push({ rule: "record_mismatch", detail: "the plan names a different record" });
  }
  const stepIds = new Set(input.record.steps.map((s) => s.id));

  for (const [i, block] of plan.blocks.entries()) {
    const at = `blocks[${i}] ${block.component}`;
    const def = input.definitions.find(
      (d) => d.component_id === block.component && d.version === block.version,
    );

    // 3. Component.
    if (!def) {
      failures.push({
        rule: "unknown_component",
        detail: `${at} v${block.version} is not in the registry`,
      });
      continue;
    }
    if (def.deprecated_at !== null) {
      failures.push({ rule: "deprecated_component", detail: `${at} was deprecated` });
    }

    // 4. Space type.
    if (!def.allowed_spaces.includes(plan.spaceType)) {
      failures.push({
        rule: "component_not_allowed_here",
        detail: `${at} is not allowed in a ${plan.spaceType} Space`,
      });
    }

    // 5. Properties, against the stored schema.
    for (const e of validateAgainstSchema(block.props, def.props_schema, "props")) {
      failures.push({ rule: "invalid_props", detail: `${at}: ${e.path} ${e.message}` });
    }

    // 7. Actions.
    if (block.actions.length > 0 && !def.can_contain_action) {
      failures.push({ rule: "action_not_allowed", detail: `${at} may not carry an action` });
    }
    for (const action of block.actions) {
      if (!ActionVerb.safeParse(action.verb).success) {
        failures.push({ rule: "unknown_verb", detail: `${at}: ${action.verb} is not a verb` });
        continue;
      }
      if (!stepIds.has(action.stepId)) {
        failures.push({
          rule: "unknown_step",
          detail: `${at}: no step ${action.stepId} on this record`,
        });
        continue;
      }
      const step = input.record.steps.find((s) => s.id === action.stepId)!;
      const onStep = step.actions.find((a) => a.verb === action.verb);
      if (!onStep) {
        failures.push({
          rule: "action_not_on_step",
          detail: `${at}: ${action.verb} is not offered on ${action.stepId}`,
        });
        continue;
      }
      // The step's own guard state decides availability. A plan may repeat it, never soften it.
      if (onStep.disabledReason !== null && action.disabledReason === null) {
        failures.push({
          rule: "action_unblocked",
          detail: `${at}: ${action.verb} is blocked on the record but offered as available`,
        });
      }
    }

    // 8. Permissions.
    const missing = def.required_permissions.filter((p) => !input.permissions.has(p));
    if (missing.length > 0) {
      failures.push({
        rule: "permission_missing",
        detail: `${at} requires ${missing.join(", ")}`,
      });
    }

    // 9. Evidence.
    if (def.requires_evidence && block.evidence.length === 0) {
      failures.push({ rule: "evidence_missing", detail: `${at} must cite at least one source` });
    }

    // 10. Derived facts.
    const derived = findDerivedKeys(block.props, DERIVED_KEY_EXEMPTIONS[block.component] ?? []);
    if (derived.length > 0) {
      failures.push({
        rule: "derived_fact_in_plan",
        detail: `${at}: ${derived.join(", ")} is derived and never travels in a plan`,
      });
    }
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, plan };
}
