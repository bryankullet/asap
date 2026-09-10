/**
 * A small JSON Schema checker for the subset `component_definitions.props_schema` uses.
 *
 * Why not a library: the schemas in the registry are ours, generated from Zod with
 * `z.toJSONSchema`, so the subset they use is known and closed — object/array/string/number/
 * boolean/null, `properties`, `required`, `additionalProperties: false`, `enum`, `const`,
 * `anyOf`, `items`, and the length bounds. Supporting exactly that, in one reviewable file, is
 * preferable to taking a dependency whose surface is far larger than the contract.
 *
 * Anything the checker does not understand is a **rejection**, never a pass: an unknown keyword
 * combination means the plan is not proven valid, and an unproven plan does not render (D-059).
 */

export type SchemaError = { path: string; message: string };

type Json = unknown;
type Schema = Record<string, Json>;

const typeOf = (v: Json): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v;

const join = (path: string, key: string | number): string =>
  typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;

/** Validates `value` against `schema`, returning every problem found. Empty means valid. */
export function validateAgainstSchema(value: Json, schema: Json, path = ""): SchemaError[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return [{ path, message: "the stored property schema is not an object" }];
  }
  const s = schema as Schema;
  const errors: SchemaError[] = [];

  if (Array.isArray(s["anyOf"])) {
    const branches = s["anyOf"] as Json[];
    const ok = branches.some((b) => validateAgainstSchema(value, b, path).length === 0);
    if (!ok) errors.push({ path, message: "matches none of the allowed shapes" });
    return errors;
  }

  if ("const" in s && value !== s["const"]) {
    return [{ path, message: `must be ${JSON.stringify(s["const"])}` }];
  }

  if (Array.isArray(s["enum"])) {
    const allowed = s["enum"] as Json[];
    if (!allowed.some((a) => a === value)) {
      return [{ path, message: `must be one of ${allowed.map((a) => JSON.stringify(a)).join(", ")}` }];
    }
  }

  const expected = s["type"];
  const actual = typeOf(value);
  if (typeof expected === "string" && expected !== actual) {
    // JSON Schema allows an integer where the value is a whole number.
    if (!(expected === "integer" && actual === "number" && Number.isInteger(value))) {
      return [{ path, message: `must be ${expected}, not ${actual}` }];
    }
  }
  if (Array.isArray(expected) && !(expected as Json[]).includes(actual)) {
    return [{ path, message: `must be one of ${(expected as string[]).join(", ")}, not ${actual}` }];
  }

  if (actual === "string") {
    const str = value as string;
    const min = s["minLength"];
    const max = s["maxLength"];
    if (typeof min === "number" && str.length < min)
      errors.push({ path, message: `must be at least ${min} characters` });
    if (typeof max === "number" && str.length > max)
      errors.push({ path, message: `must be at most ${max} characters` });
  }

  if (actual === "number") {
    const n = value as number;
    if (typeof s["minimum"] === "number" && n < (s["minimum"] as number))
      errors.push({ path, message: `must be at least ${s["minimum"] as number}` });
    if (typeof s["maximum"] === "number" && n > (s["maximum"] as number))
      errors.push({ path, message: `must be at most ${s["maximum"] as number}` });
  }

  if (actual === "array") {
    const arr = value as Json[];
    if (typeof s["maxItems"] === "number" && arr.length > (s["maxItems"] as number))
      errors.push({ path, message: `must have at most ${s["maxItems"] as number} entries` });
    if (typeof s["minItems"] === "number" && arr.length < (s["minItems"] as number))
      errors.push({ path, message: `must have at least ${s["minItems"] as number} entries` });
    if (s["items"] !== undefined) {
      arr.forEach((v, i) => errors.push(...validateAgainstSchema(v, s["items"], join(path, i))));
    }
  }

  if (actual === "object") {
    const obj = value as Record<string, Json>;
    const properties = (s["properties"] ?? {}) as Record<string, Json>;
    const required = (s["required"] ?? []) as string[];
    for (const key of required) {
      if (!(key in obj)) errors.push({ path: join(path, key), message: "is required" });
    }
    // additionalProperties: false is how the registry says "these keys and no others". An extra
    // key is a rejection, because it is the shape a model would use to smuggle a value in.
    if (s["additionalProperties"] === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) errors.push({ path: join(path, key), message: "is not allowed" });
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in obj) errors.push(...validateAgainstSchema(obj[key], sub, join(path, key)));
    }
  }

  return errors;
}
