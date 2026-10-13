import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    passWithNoTests: true,
    // Throwaway local values: the public env is validated at module load.
    env: {
      VITE_PUBLIC_APP_ENV: "local",
      VITE_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      VITE_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      VITE_PUBLIC_API_BASE_URL: "http://localhost:8787",
    },
  },
});
