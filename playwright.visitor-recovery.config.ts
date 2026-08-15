import { defineConfig, devices } from "@playwright/test";

const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;
const useStandalone = Boolean(process.env.CI)
  || process.env.AXORA_PLAYWRIGHT_STANDALONE === "true";

export default defineConfig({
  testDir: "./e2e-visitor-recovery",
  outputDir: "output/playwright/visitor-recovery-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["line"],
    [
      "html",
      {
        open: "never",
        outputFolder: "output/playwright/visitor-recovery-report",
      },
    ],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: useStandalone
      ? "node output/standalone/server.js"
      : `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_BASE_URL: baseURL,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: useStandalone ? "production" : "development",
      DEMO_MODE: "true",
      DEMO_EMAIL: "owner@axora.e2e",
      DEMO_PASSWORD: "public-e2e-fixture-password",
      SESSION_SECRET: "public-e2e-session-key-not-for-production-0001",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
