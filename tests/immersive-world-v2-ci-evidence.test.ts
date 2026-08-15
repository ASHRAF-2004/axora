import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Immersive World V2 reviewer evidence", () => {
  it("always uploads the complete review artifact and retains performance gates", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).toContain("retention-days: 14");
    expect(workflow).toContain("output/playwright");
    expect(workflow).toContain("output/lighthouse");
    expect(workflow).toContain("output/reports");
    expect(workflow).toContain("npm run evidence:report");
    expect(workflow).toContain("npm run evidence:validate");
    expect(workflow).toContain("npm run evidence:manifest");
    expect(workflow).toContain("npm run evidence:lighthouse");
    expect(workflow).toContain("npm run assets:validate");
    expect(workflow).toContain("npm run standalone:stage");
    expect(workflow).toContain("npm run standalone:validate");
    expect(workflow).toContain("NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3100 node server.js");
    expect(workflow).not.toContain("npm start --");
  });

  it("requires the interaction tour and every reviewed visual state", () => {
    const validator = readFileSync("scripts/evidence-contract.mjs", "utf8");
    for (const evidence of [
      "v2-homepage.png",
      "v2-how-it-works.png",
      "v2-procurement-process.png",
      "v2-solutions-by-role.png",
      "v2-security-and-privacy.png",
      "v2-about.png",
      "immersive-forced-colors-chromium.png",
      "v2-driver-map-operational-chromium.png",
      "v2-driver-map-unconfigured-chromium.png",
      "v2-available-job-pool-chromium.png",
      "interaction-tour.webm",
    ]) expect(validator).toContain(evidence);
  });
});
