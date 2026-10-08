import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("release-parity Playwright server isolation", () => {
  it.each([
    "playwright.config.ts",
    "playwright.visitor-recovery.config.ts",
  ])("does not reuse a retained mutable server in standalone mode (%s)", async (file) => {
    const config = await readFile(path.join(repositoryRoot, file), "utf8");

    expect(config).toContain("reuseExistingServer: !useStandalone && !process.env.CI");
  });

  it("retains failed demo browser evidence without weakening the quality gate", async () => {
    const workflow = await readFile(path.join(repositoryRoot, ".github/workflows/quality.yml"), "utf8");

    expect(workflow).toContain("id: browser_journeys");
    expect(workflow).toContain("run: npx playwright install --with-deps chromium && npm run test:e2e");
    expect(workflow).toContain("if: failure() && steps.browser_journeys.outcome == 'failure'");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    for (const directory of ["results", "report", "visitor-recovery-results", "visitor-recovery-report"]) {
      expect(workflow).toContain(`output/playwright/${directory}/`);
    }
    expect(workflow).toContain("include-hidden-files: false");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toContain("continue-on-error");
  });
});
