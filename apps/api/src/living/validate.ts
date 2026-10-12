import { LIVING_BLOCK_PROPS, livingSurfaceSchema, type LivingSurface } from "@asap/schema";
import { validateAgainstSchema } from "../spaces/jsonschema.js";
import type { ComponentDefinition, ValidationFailure } from "../spaces/validate.js";

/**
 * The Living surface validator (D-156) — the same contract as the Space plan's (D-059), applied to
 * a surface. Every surface passes this before it reaches the browser, whoever composed it:
 *
 *  1. Shape        — parses as a `LivingSurface`, or nothing else is attempted.
 *  2. Component    — registered in `component_definitions` at that version, not deprecated, and
 *                    allowed in a Living surface. Nothing outside the registry renders.
 *  3. Properties   — validate against the stored JSON Schema *and* the Zod source, so a drift
 *                    between the two fails here rather than in the browser.
 *  4. Actions      — only "open" a governed place the shell knows, or "ask"; only on a block the
 *                    registry lets carry one. A surface never writes.
 *  5. Evidence     — a block the registry marks as requiring evidence carries a reference.
 *  6. Derived      — no block carries a percentage or a confidence anywhere in its props.
 *  7. Permissions  — a block whose required permissions the viewer lacks is removed before the
 *                    surface is sent (§34), not rendered and hidden.
 *
 * Rules 1–6 reject the whole surface: a surface someone repaired is not the one validated.
 */

/** The places a Living action may open — the shell's own workspace references. */
export const LIVING_OPENABLE = new Set(["renewal", "quote", "document", "workitem", "client", "policy"]);
const BANNED_KEYS = ["percent", "percentage", "confidence", "completion", "score", "ranking"];

function bannedKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => bannedKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [...(BANNED_KEYS.includes(k.toLowerCase()) ? [`${path}.${k}`] : []), ...bannedKeys(v, `${path}.${k}`)]);
  return [];
}

export type LivingValidateResult = { ok: true; surface: LivingSurface; removed: string[] } | { ok: false; failures: ValidationFailure[] };

export function validateSurface(input: { surface: unknown; definitions: ComponentDefinition[]; permissions: Set<string> }): LivingValidateResult {
  const parsed = livingSurfaceSchema.safeParse(input.surface);
  if (!parsed.success) return { ok: false, failures: parsed.error.issues.map((i) => ({ rule: "shape", detail: `${i.path.join(".")}: ${i.message}` })) };
  const surface = parsed.data;
  const failures: ValidationFailure[] = [];
  const seen = new Set<string>();
  const kept: LivingSurface["blocks"] = [];
  const removed: string[] = [];

  for (const b of surface.blocks) {
    const at = `block ${b.id}`;
    if (seen.has(b.id)) failures.push({ rule: "shape", detail: `${at}: duplicate block id` });
    seen.add(b.id);
    const def = input.definitions.find((d) => d.component_id === b.component && d.version === b.version);
    if (!def) { failures.push({ rule: "component", detail: `${at}: ${b.component}@${b.version} is not registered` }); continue; }
    if (def.deprecated_at) failures.push({ rule: "component", detail: `${at}: ${b.component}@${b.version} is deprecated` });
    if (!def.allowed_spaces.includes("living")) failures.push({ rule: "component", detail: `${at}: ${b.component} is not allowed in a Living surface` });
    for (const e of validateAgainstSchema(b.props, def.props_schema)) failures.push({ rule: "properties", detail: `${at}: ${e.path || "props"} ${e.message}` });
    const zod = LIVING_BLOCK_PROPS[b.component].safeParse(b.props);
    if (!zod.success) failures.push({ rule: "properties", detail: `${at}: ${zod.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
    if (b.actions.length && !def.can_contain_action) failures.push({ rule: "actions", detail: `${at}: ${b.component} may not carry an action` });
    for (const a of b.actions)
      if (a.kind === "open" && !LIVING_OPENABLE.has(String(a.ref["ws"]))) failures.push({ rule: "actions", detail: `${at}: cannot open "${String(a.ref["ws"])}"` });
    if (def.requires_evidence && b.evidence.length === 0) failures.push({ rule: "evidence", detail: `${at}: ${b.component} requires a source` });
    for (const k of bannedKeys(b.props)) failures.push({ rule: "derived", detail: `${at}: ${k} may not travel in a surface` });
    if (def.required_permissions.some((p) => !input.permissions.has(p))) removed.push(b.id);
    else kept.push(b);
  }
  if (failures.length) return { ok: false, failures };
  return { ok: true, surface: { ...surface, blocks: kept }, removed };
}
