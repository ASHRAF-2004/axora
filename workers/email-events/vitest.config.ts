import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          AXORA_EMAIL_EVENTS_WEBHOOK_SECRET:
            "test-only-email-events-webhook-secret-abcdefghijklmnopqrstuvwxyz",
        },
      },
    }),
  ],
});
