import { configDefaults, defineConfig } from "vitest/config";

/*
 * The connected lifecycle (test/connected) needs a disposable Postgres and PostgREST, started by
 * scripts/test-connected.sh. It runs there and only there — it is not skipped in the ordinary run,
 * it is not part of it.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: process.env["CONNECTED_POSTGREST_URL"]
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, "test/connected/**"],
  },
});
