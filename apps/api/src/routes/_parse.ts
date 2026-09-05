import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "../errors.js";

/** Parse and validate a JSON body. A validation failure is a 422 with the field issues. */
export async function parseBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const err = new HttpError(422, "validation_failed");
    (err as HttpError & { details?: unknown }).details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw err;
  }
  return result.data as z.infer<S>;
}
