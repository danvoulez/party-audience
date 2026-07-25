import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      // Prefixo _ marca parâmetro exigido por um contrato externo (ex.: o
      // construtor do Durable Object recebe state) mas não usado aqui.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Scripts de build e de verificação rodam no Node, fora do Worker.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  { ignores: ["node_modules", "public", ".wrangler", "test-results", "playwright-report", "reports"] },
);
