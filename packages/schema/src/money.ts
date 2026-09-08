import { z } from "zod";

/**
 * Money is never a number — UI Build Spec v1, Part 3.
 *
 * `number` is not an acceptable premium type anywhere in packages/schema. Every monetary value
 * is an Amount: integer minor units, a currency, the component of premium it is, and the levy
 * rule version that produced it. A component of `null` means the source genuinely did not say
 * what the figure is, and nothing may compare it until a person says.
 */

export const PremiumComponent = z.enum([
  "base",
  "training_levy",
  "pcf",
  "stamp_duty",
  "gross_payable",
  "commission_basis",
]);
export type PremiumComponent = z.infer<typeof PremiumComponent>;

export const Amount = z.strictObject({
  /** Minor units (cents). Never floats, never a bare number at the boundary. */
  minor: z.number().int(),
  currency: z.literal("KES"),
  /** null = genuinely not stated by the source. */
  component: PremiumComponent.nullable(),
  /** Which levy rule version produced it (company_rules, D-027). null = not derived from a rule. */
  ruleVersion: z.string().nullable(),
});
export type Amount = z.infer<typeof Amount>;

/** Commission is three figures. Any commission amount carries one; the UI renders it beside the number. */
export const CommissionFigure = z.enum(["gross", "wht", "net"]);
export type CommissionFigure = z.infer<typeof CommissionFigure>;

export const CommissionAmount = z.strictObject({
  figure: CommissionFigure,
  amount: Amount,
});
export type CommissionAmount = z.infer<typeof CommissionAmount>;

export type ComparableResult =
  { ok: true } | { ok: false; reason: "component_not_stated" | "component_mismatch" };

/**
 * The comparison guard (Part 3.2). Every reconciliation row, every variance, every "why did this
 * go up" runs through this. A `false` result produces an exception row — never a match and never
 * a mismatch.
 */
export function comparable(a: Amount, b: Amount): ComparableResult {
  if (a.component === null || b.component === null) {
    return { ok: false, reason: "component_not_stated" };
  }
  if (a.component !== b.component) return { ok: false, reason: "component_mismatch" };
  return { ok: true };
}
