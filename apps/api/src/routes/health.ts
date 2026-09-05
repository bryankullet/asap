import { healthResponseSchema, type HealthResponse } from "@asap/schema";
import { Hono } from "hono";
import type { BuildInfo } from "../build-info.js";

/** GET /health — unauthenticated liveness. Carries no tenant data. */
export function healthRoutes(build: BuildInfo) {
  const app = new Hono();
  app.get("/health", (c) => {
    // Validate our own output so the API cannot drift from the shared contract silently.
    const body: HealthResponse = healthResponseSchema.parse({
      status: "ok",
      version: build.version,
      commit: build.commit,
    });
    return c.json(body);
  });
  return app;
}
