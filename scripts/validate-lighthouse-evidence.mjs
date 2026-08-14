import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function reportPath(name) {
  const candidates = [
    resolve(root, `output/lighthouse/${name}.report.json`),
    resolve(root, `output/lighthouse/${name}.json`),
  ];
  const path = candidates.find(existsSync);
  if (!path) throw new Error(`Missing ${name} Lighthouse JSON evidence.`);
  return path;
}

function summarize(name) {
  const report = JSON.parse(readFileSync(reportPath(name), "utf8"));
  const categories = report.categories ?? {};
  const audits = report.audits ?? {};
  return {
    performance: categories.performance?.score ?? 0,
    accessibility: categories.accessibility?.score ?? 0,
    bestPractices: categories["best-practices"]?.score ?? 0,
    seo: categories.seo?.score ?? 0,
    lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
  };
}

const mobile = summarize("mobile");
const desktop = summarize("desktop");
const failures = [];
if (mobile.performance < 0.8) failures.push(`mobile performance ${mobile.performance}`);
if (desktop.performance < 0.9) failures.push(`desktop performance ${desktop.performance}`);
if (mobile.accessibility < 0.95) failures.push(`mobile accessibility ${mobile.accessibility}`);
if (desktop.accessibility < 0.95) failures.push(`desktop accessibility ${desktop.accessibility}`);
if ((mobile.cls ?? 1) >= 0.1) failures.push(`mobile CLS ${mobile.cls}`);
if ((desktop.cls ?? 1) >= 0.1) failures.push(`desktop CLS ${desktop.cls}`);
const summary = { generatedAt: new Date().toISOString(), thresholds: { mobilePerformance: 0.8, desktopPerformance: 0.9, accessibility: 0.95, cls: 0.1 }, mobile, desktop, failures };
const output = resolve(root, "output/reports/lighthouse-summary.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
if (failures.length) throw new Error(`Lighthouse budgets failed: ${failures.join(", ")}`);
