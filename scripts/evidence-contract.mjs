const immersiveSource = "e2e/immersive-public-experience.spec.ts";
const operationalSource = "e2e/immersive-world-v2-operational.spec.ts";

export const REQUIRED_REVIEW_EVIDENCE = [
  ["output/playwright/v2-homepage.png", immersiveSource],
  ["output/playwright/v2-how-it-works.png", immersiveSource],
  ["output/playwright/v2-procurement-process.png", immersiveSource],
  ["output/playwright/v2-solutions-by-role.png", immersiveSource],
  ["output/playwright/v2-security-and-privacy.png", immersiveSource],
  ["output/playwright/v2-about.png", immersiveSource],
  ...["request", "approve", "pay", "invoice", "prepare", "deliver", "track", "complete"].map((stage) => [`output/playwright/v2-home-stage-${stage}.png`, immersiveSource]),
  ["output/playwright/immersive-default-chromium.png", immersiveSource],
  ["output/playwright/immersive-theme-aurora-chromium.png", immersiveSource],
  ["output/playwright/immersive-theme-solar-chromium.png", immersiveSource],
  ["output/playwright/immersive-theme-ember-chromium.png", immersiveSource],
  ["output/playwright/immersive-theme-midnight-chromium.png", immersiveSource],
  ["output/playwright/immersive-mobile-mobile-chrome.png", immersiveSource],
  ["output/playwright/immersive-arabic-mobile-chrome.png", immersiveSource],
  ["output/playwright/immersive-malay-mobile-chrome.png", immersiveSource],
  ["output/playwright/immersive-reduced-motion-mobile-chrome.png", immersiveSource],
  ["output/playwright/immersive-forced-colors-chromium.png", immersiveSource],
  ["output/playwright/immersive-webgl-unavailable-chromium.png", immersiveSource],
  ["output/playwright/immersive-context-loss-chromium.png", immersiveSource],
  ["output/playwright/immersive-workflow-chromium.png", immersiveSource],
  ["output/playwright/immersive-login-chromium.png", immersiveSource],
  ["output/playwright/v2-visitor-choice-modal-chromium.png", "e2e/public-visitor-counter.spec.ts"],
  ["output/playwright/v2-visitor-claimed-counters-chromium.png", "e2e/public-visitor-counter.spec.ts"],
  ["output/playwright/v2-manage-drivers-chromium.png", operationalSource],
  ["output/playwright/v2-driver-detail-chromium.png", operationalSource],
  ["output/playwright/v2-driver-map-provider-fixture-chromium.png", operationalSource],
  ["output/playwright/v2-driver-map-unconfigured-chromium.png", operationalSource],
  ["output/playwright/v2-available-job-pool-chromium.png", operationalSource],
  ["output/playwright/v2-add-company-chromium.png", operationalSource],
  ["output/playwright/v2-catalogue-chromium.png", operationalSource],
  ["output/playwright/v2-staff-theme-chromium.png", operationalSource],
  ["output/playwright/v2-company-theme-precedence-chromium.png", operationalSource],
].map(([path, testSource]) => ({ path, kind: "image", testSource, minWidth: 640, minHeight: 300, minEntropy: 0.1 }));

REQUIRED_REVIEW_EVIDENCE.push({
  path: "output/playwright/interaction-tour.webm",
  kind: "video",
  testSource: immersiveSource,
  minBytes: 100_000,
  expectedWidth: 1280,
  expectedHeight: 800,
});

export const REQUIRED_REPORT_EVIDENCE = [
  ["output/playwright/report/index.html", "html", "playwright.config.ts"],
  ["output/playwright/visitor-recovery-report/index.html", "html", "playwright.visitor-recovery.config.ts"],
  ["output/playwright/asset-size-report.json", "json", "scripts/validate-third-party-assets.mjs"],
  ["output/lighthouse/mobile.report.json", "json", "scripts/validate-lighthouse-evidence.mjs"],
  ["output/lighthouse/mobile.report.html", "html", "Lighthouse 12.8.2"],
  ["output/lighthouse/desktop.report.json", "json", "scripts/validate-lighthouse-evidence.mjs"],
  ["output/lighthouse/desktop.report.html", "html", "Lighthouse 12.8.2"],
  ["output/reports/immersive-performance.json", "json", "scripts/report-immersive-performance.mjs"],
  ["output/reports/immersive-performance.md", "text", "scripts/report-immersive-performance.mjs"],
  ["output/reports/lighthouse-summary.json", "json", "scripts/validate-lighthouse-evidence.mjs"],
  ["output/reports/public-link-report.json", "json", "scripts/validate-public-links.mjs"],
  ["output/reports/standalone-stage.json", "json", "scripts/prepare-standalone.mjs"],
  ["output/reports/standalone-runtime.json", "json", "scripts/validate-standalone-runtime.mjs"],
  ["output/reports/production-server.log", "text", ".github/workflows/ci.yml"],
].map(([path, kind, testSource]) => ({ path, kind, testSource, minBytes: kind === "html" ? 1_000 : 1 }));

export const EVIDENCE_CONFIGURATION_PATHS = [
  ".github/workflows/ci.yml",
  "next.config.ts",
  "package-lock.json",
  "playwright.config.ts",
  "playwright.visitor-recovery.config.ts",
  "scripts/evidence-contract.mjs",
  "src/proxy.ts",
];

const exactSource = new Map([...REQUIRED_REVIEW_EVIDENCE, ...REQUIRED_REPORT_EVIDENCE].map((item) => [item.path, item.testSource]));

export function evidenceSourceForPath(path) {
  if (exactSource.has(path)) return exactSource.get(path);
  if (path.startsWith("output/playwright/report/")) return "playwright.config.ts";
  if (path.startsWith("output/playwright/visitor-recovery-report/")) return "playwright.visitor-recovery.config.ts";
  if (path.startsWith("output/playwright/results/") || path.startsWith("output/playwright/video/")) return "Playwright retained execution evidence";
  if (path.startsWith("output/lighthouse/")) return "Lighthouse 12.8.2";
  if (path.startsWith("output/reports/")) return ".github/workflows/ci.yml";
  return "repository verification suite";
}
