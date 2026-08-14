import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("output/playwright");
const required = [
  "v2-homepage.png",
  "v2-how-it-works.png",
  "v2-procurement-process.png",
  "v2-solutions-by-role.png",
  "v2-security-and-privacy.png",
  "v2-about.png",
  "immersive-default-chromium.png",
  "immersive-theme-aurora-chromium.png",
  "immersive-theme-solar-chromium.png",
  "immersive-theme-ember-chromium.png",
  "immersive-theme-midnight-chromium.png",
  "immersive-mobile-mobile-chrome.png",
  "immersive-arabic-mobile-chrome.png",
  "immersive-malay-mobile-chrome.png",
  "immersive-reduced-motion-mobile-chrome.png",
  "immersive-forced-colors-chromium.png",
  "immersive-webgl-unavailable-chromium.png",
  "immersive-context-loss-chromium.png",
  "immersive-workflow-chromium.png",
  "immersive-login-chromium.png",
  "v2-visitor-choice-modal-chromium.png",
  "v2-visitor-claimed-counters-chromium.png",
  "v2-manage-drivers-chromium.png",
  "v2-driver-detail-chromium.png",
  "v2-populated-driver-map-chromium.png",
  "v2-available-job-pool-chromium.png",
  "v2-add-company-chromium.png",
  "v2-catalogue-chromium.png",
  "v2-staff-theme-chromium.png",
  "v2-company-theme-precedence-chromium.png",
  "interaction-tour.webm",
];
const missing = required.filter((name) => {
  const path = resolve(root, name);
  return !existsSync(path) || statSync(path).size === 0;
});
if (missing.length) throw new Error(`Missing review evidence: ${missing.join(", ")}`);
console.log(`Verified ${required.length} review evidence files.`);
