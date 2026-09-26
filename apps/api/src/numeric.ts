/**
 * Money and rates as they leave the database.
 *
 * PostgREST returns `numeric` columns as JSON numbers, so a premium of KES 5,310,000.00 arrives as
 * `5310000`. Everywhere else — the database's own digests (`numeric::text`), the API contracts and
 * the screen — it is the string `"5310000.00"`. Every value read from a `numeric(14,2)` or
 * `numeric(6,4)` column passes through here, so the two can never disagree: a digest computed in
 * TypeScript matches the one computed in SQL, and a contract that says "string" receives one.
 *
 * Found by the connected lifecycle test (4B-4B); the in-memory Supabase stand-in returned strings.
 */
export function pgMoney(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value.toFixed(2);
  return String(value);
}

export function pgRate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value.toFixed(4);
  return String(value);
}
