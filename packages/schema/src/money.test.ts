import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Amount,
  CommissionAmount,
  CommissionFigure,
  PremiumComponent,
  comparable,
} from "./money.js";

const kes = (
  minor: number,
  component: Amount["component"],
  ruleVersion: string | null = null,
): Amount => ({
  minor,
  currency: "KES",
  component,
  ruleVersion,
});

describe("comparable()", () => {
  it("returns component_not_stated when either component is null", () => {
    expect(comparable(kes(100, null), kes(100, "base"))).toEqual({
      ok: false,
      reason: "component_not_stated",
    });
    expect(comparable(kes(100, "base"), kes(100, null))).toEqual({
      ok: false,
      reason: "component_not_stated",
    });
    expect(comparable(kes(100, null), kes(100, null))).toEqual({
      ok: false,
      reason: "component_not_stated",
    });
  });

  it("returns component_mismatch when the components differ", () => {
    expect(comparable(kes(100, "base"), kes(100, "gross_payable"))).toEqual({
      ok: false,
      reason: "component_mismatch",
    });
  });

  it("is ok only when both components are stated and equal — amounts themselves are not compared", () => {
    expect(comparable(kes(100, "base"), kes(999, "base"))).toEqual({ ok: true });
    expect(comparable(kes(100, "base", "levy-2026-01"), kes(100, "base", "levy-2025-07"))).toEqual({
      ok: true,
    });
  });
});

describe("Amount.parse", () => {
  it("rejects a float in minor units", () => {
    expect(() =>
      Amount.parse({ minor: 1296000.5, currency: "KES", component: "base", ruleVersion: null }),
    ).toThrow();
  });

  it("rejects a bare number (the prototype's `amount: 1296000` shape)", () => {
    expect(() => Amount.parse(1296000)).toThrow();
    expect(Amount.safeParse(1296000).success).toBe(false);
  });

  it("rejects a string of digits and a missing component key", () => {
    expect(
      Amount.safeParse({ minor: "1296000", currency: "KES", component: "base", ruleVersion: null })
        .success,
    ).toBe(false);
    expect(Amount.safeParse({ minor: 1296000, currency: "KES", ruleVersion: null }).success).toBe(
      false,
    );
  });

  it("rejects unknown keys and a non-KES currency", () => {
    expect(
      Amount.safeParse({ minor: 1, currency: "KES", component: null, ruleVersion: null, amount: 1 })
        .success,
    ).toBe(false);
    expect(
      Amount.safeParse({ minor: 1, currency: "USD", component: null, ruleVersion: null }).success,
    ).toBe(false);
  });

  it("accepts integer minor units with a null component", () => {
    expect(
      Amount.parse({ minor: 1296000, currency: "KES", component: null, ruleVersion: null }),
    ).toEqual(kes(1296000, null));
  });
});

describe("commission", () => {
  it("is exactly three figures and every commission amount carries one", () => {
    expect(CommissionFigure.options).toEqual(["gross", "wht", "net"]);
    expect(CommissionAmount.safeParse({ amount: kes(95000, "commission_basis") }).success).toBe(
      false,
    );
    expect(
      CommissionAmount.parse({ figure: "net", amount: kes(95000, "commission_basis") }).figure,
    ).toBe("net");
  });

  it("premium components are exactly the six from the spec", () => {
    expect(PremiumComponent.options).toEqual([
      "base",
      "training_levy",
      "pcf",
      "stamp_duty",
      "gross_payable",
      "commission_basis",
    ]);
  });
});

describe("no bare-number money anywhere in packages/schema", () => {
  it("no schema source declares a premium, amount or commission field as z.number()", () => {
    const dir = join(import.meta.dirname);
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
          const src = readFileSync(p, "utf8");
          const re =
            /\b(premium|amount|commission|levy|price|total)\w*\s*:\s*z\.(number|coerce\.number)\(/gi;
          for (const m of src.matchAll(re)) offenders.push(`${p}: ${m[0]}`);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
