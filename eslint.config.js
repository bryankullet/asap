// Root ESLint flat config. Each workspace runs `eslint .` against this file.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "docs/ui/prototype/**",
      "apps/extractor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // CLAUDE.md: no `any` without a comment explaining why.
      "@typescript-eslint/no-explicit-any": "error",
      // CLAUDE.md: no console.log in committed code — use the structured logger.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Scripts and the visual-parity harness are plain Node tooling; console output is their job.
    files: [
      "scripts/**/*.mjs",
      "**/scripts/**/*.mjs",
      "**/scripts/**/*.ts",
      "**/parity/**/*.mjs",
    ],
    rules: { "no-console": "off" },
  },
);
