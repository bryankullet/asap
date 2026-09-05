import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // §45 rule 4: the browser gets the anon key only. Vite exposes just this prefix to
  // import.meta.env; scripts/check-bundle.mjs verifies the built output as a second line.
  envPrefix: "VITE_PUBLIC_",
  envDir: "../..",
  server: { port: 5173, strictPort: true },
  build: { sourcemap: false },
});
