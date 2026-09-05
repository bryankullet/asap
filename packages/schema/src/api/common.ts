import { z } from "zod";

export const uuidSchema = z.string().uuid();

/** ISO 3166-1 alpha-2, upper case. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "must be a two-letter ISO country code");

/** ISO 4217, upper case. */
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a three-letter ISO currency code");

/** IANA time zone name. Validated against pg_timezone_names server-side; shape only here. */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/, "must be an IANA time zone such as Africa/Nairobi");

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Stable machine-readable error body for every non-2xx API response. */
export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
