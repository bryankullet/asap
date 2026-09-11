import type { AutomationCondition, ConditionResult, WorkItemRow } from "@asap/schema";

/**
 * Condition evaluation.
 *
 * Deterministic, small, and entirely ours. No model decides whether a condition holds, and no
 * expression language is accepted from configuration — a standing instruction a broker cannot read
 * aloud and check by hand is not one they can be responsible for.
 *
 * Every evaluation returns *why*, not just whether. "Nothing happened" with no explanation is the
 * failure mode that makes people stop trusting automations.
 */

const DAY = 86_400_000;

/** Reads one named fact off the record. Names, not columns: configuration never sees the schema. */
function factOf(
  fact: AutomationCondition["fact"],
  item: WorkItemRow,
  context: { clientFileStatus?: string | null; insurerName?: string | null; periodEnd?: string | null },
): string | null {
  switch (fact) {
    case "task_status":
      return item.task_status;
    case "cover_status":
      return item.cover_status;
    case "money_status":
      return item.money_status;
    case "kind":
      return item.kind;
    case "class_of_business":
      return item.class_of_business;
    case "insurer_name":
      return context.insurerName ?? null;
    case "client_file_status":
      return context.clientFileStatus ?? null;
    case "period_end":
      return context.periodEnd ?? null;
    case "last_touched":
      return item.updated_at;
    case "exception":
      return item.exception?.kind ?? null;
  }
}

function daysBetween(from: string, to: number): number | null {
  const at = Date.parse(from);
  return Number.isNaN(at) ? null : Math.round((at - to) / DAY);
}

export function evaluateConditions(
  conditions: AutomationCondition[],
  item: WorkItemRow,
  context: { clientFileStatus?: string | null; insurerName?: string | null; periodEnd?: string | null },
  now: number,
): { held: boolean; results: ConditionResult[] } {
  const results = conditions.map<ConditionResult>((condition) => {
    const actual = factOf(condition.fact, item, context);
    const expected = condition.value;
    let held = false;

    switch (condition.operator) {
      case "equals":
        held = actual !== null && String(expected) === actual;
        break;
      case "not_equals":
        held = String(expected) !== actual;
        break;
      case "is_one_of":
        held = Array.isArray(expected) && actual !== null && expected.includes(actual);
        break;
      case "is_empty":
        held = actual === null || actual === "";
        break;
      case "is_not_empty":
        held = actual !== null && actual !== "";
        break;
      case "days_until_less_than": {
        // A date that will not parse is not "soon"; it is unknown, and an unknown does not hold.
        const days = actual === null ? null : daysBetween(actual, now);
        held = days !== null && typeof expected === "number" && days < expected;
        break;
      }
      case "days_since_more_than": {
        const days = actual === null ? null : daysBetween(actual, now);
        held = days !== null && typeof expected === "number" && -days > expected;
        break;
      }
    }

    return { fact: condition.fact, operator: condition.operator, expected, actual, held };
  });

  // Every condition must hold. There is no `any` mode: a standing instruction that fires when one
  // of several things is true is two instructions, and reads more clearly as two.
  return { held: results.every((r) => r.held), results };
}
