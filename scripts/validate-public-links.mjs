import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = new URL(process.env.AXORA_EVIDENCE_BASE_URL ?? "http://127.0.0.1:3100");
const seeds = ["/en", "/en/how-it-works", "/en/procurement-process", "/en/solutions-by-role", "/en/security-and-privacy", "/en/about", "/login"];
const checked = new Map();
const failures = [];

for (const path of seeds) {
  const response = await fetch(new URL(path, base), { redirect: "manual" });
  checked.set(path, response.status);
  if (response.status >= 400) failures.push(`${path}: HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("text/html")) continue;
  const html = await response.text();
  for (const match of html.matchAll(/\s(?:href|src)=["']([^"'#]+)["']/g)) {
    const candidate = new URL(match[1], base);
    if (candidate.origin !== base.origin || candidate.pathname.startsWith("/_next/") || candidate.pathname.startsWith("/api/")) continue;
    const key = candidate.pathname + candidate.search;
    if (checked.has(key)) continue;
    const linked = await fetch(candidate, { redirect: "manual" });
    checked.set(key, linked.status);
    if (linked.status >= 400) failures.push(`${key}: HTTP ${linked.status}`);
  }
}

const report = { generatedAt: new Date().toISOString(), base: base.origin, checked: Object.fromEntries(checked), failures };
mkdirSync(resolve("output/reports"), { recursive: true });
writeFileSync(resolve("output/reports/public-link-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Checked ${checked.size} public links; ${failures.length} failed.`);
if (failures.length) throw new Error(`Broken public links: ${failures.join(", ")}`);
