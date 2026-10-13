import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // §45 rule 4: the browser gets the anon key only. scripts/check-bundle.mjs checks the artefact.
  envPrefix: "VITE_PUBLIC_",
  envDir: "../..",
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: { sourcemap: false },
});
