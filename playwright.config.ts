import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "output/playwright/results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Every project shares one Next development server. Serial workers avoid
  // Turbopack route-compilation races while still exercising concurrent work
  // inside the application/unit/database suites and the production build.
  workers: 1,
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "output/playwright/report" }],
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
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_BASE_URL: baseURL,
      DEMO_MODE: "true",
      DEMO_EMAIL: "owner@axora.e2e",
      DEMO_PASSWORD: "public-e2e-fixture-password",
      SESSION_SECRET: "public-e2e-session-key-not-for-production-0001",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
