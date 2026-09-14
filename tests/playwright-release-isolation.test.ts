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
});
