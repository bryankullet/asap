import { healthResponseSchema, type HealthResponse } from "@asap/schema";
import { env } from "./env.js";

/** Typed client for GET /health. Parses the response, so a contract drift fails here, not in the UI. */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(new URL("/health", env.VITE_PUBLIC_API_BASE_URL));
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}
