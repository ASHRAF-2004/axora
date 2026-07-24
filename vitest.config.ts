import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,mjs}"],
    coverage: { reporter: ["text", "html"] },
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
