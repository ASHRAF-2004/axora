import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "data/**",
    "output/**",
    "reports/**",
    "tmp/**",
    "workers/**/.wrangler/**",
    "workers/**/dist/**",
    "workers/**/worker-configuration.d.ts",
    "integrations/**/dist/**",
  ]),
]);
