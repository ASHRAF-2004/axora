import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");

function reportPath(name, repositoryRoot = root) {
  const candidates = [
    resolve(repositoryRoot, `output/lighthouse/${name}.report.json`),
    resolve(repositoryRoot, `output/lighthouse/${name}.json`),
  ];
  const path = candidates.find(existsSync);
  if (!path) throw new Error(`Missing ${name} Lighthouse JSON evidence.`);
  return path;
}

function safeRequestLabel(item) {
  try {
    const url = new URL(item.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unknown resource";
  }
}

export function auditLighthouseReport(name, report) {
  const categories = report.categories ?? {};
  const audits = report.audits ?? {};
  const consoleItems = audits["errors-in-console"]?.details?.items ?? [];
  const inspector = audits["inspector-issues"];
  const inspectorPayload = JSON.stringify(inspector?.details ?? {});
  const failedRequests = (audits["network-requests"]?.details?.items ?? []).filter((item) => Number(item.statusCode) >= 400);
  const summary = {
    performance: categories.performance?.score ?? 0,
    accessibility: categories.accessibility?.score ?? 0,
    bestPractices: categories["best-practices"]?.score ?? 0,
    seo: categories.seo?.score ?? 0,
    lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
    consoleErrorCount: consoleItems.length,
    inspectorIssueCount: inspector?.details?.items?.length ?? (inspector?.score === 1 ? 0 : 1),
    failedRequestCount: failedRequests.length,
  };
  const failures = [];
  if (summary.accessibility !== 1) failures.push(`${name} accessibility ${summary.accessibility}; required 1`);
  if (summary.seo !== 1) failures.push(`${name} SEO ${summary.seo}; required 1`);
  if (summary.bestPractices !== 1) failures.push(`${name} best practices ${summary.bestPractices}; required 1`);
  if (audits["errors-in-console"]?.score !== 1 || consoleItems.length) failures.push(`${name} has ${consoleItems.length || "reported"} console error(s)`);
  if (inspector?.score !== 1) failures.push(`${name} has Inspector issue(s)${/content.?security.?policy|csp/i.test(inspectorPayload) ? " including CSP" : ""}`);
  if (audits["csp-xss"] && audits["csp-xss"].score !== 1) failures.push(`${name} CSP/XSS audit did not pass`);
  for (const request of failedRequests) failures.push(`${name} ${safeRequestLabel(request)} returned HTTP ${request.statusCode}`);
  return { summary, failures };
}

export function validateLighthouseReports({ repositoryRoot = root } = {}) {
  const reports = Object.fromEntries(["mobile", "desktop"].map((name) => [name, JSON.parse(readFileSync(reportPath(name, repositoryRoot), "utf8"))]));
  const mobileAudit = auditLighthouseReport("mobile", reports.mobile);
  const desktopAudit = auditLighthouseReport("desktop", reports.desktop);
  const failures = [...mobileAudit.failures, ...desktopAudit.failures];
  if (mobileAudit.summary.performance < 0.8) failures.push(`mobile performance ${mobileAudit.summary.performance}`);
  if (desktopAudit.summary.performance < 0.9) failures.push(`desktop performance ${desktopAudit.summary.performance}`);
  if ((mobileAudit.summary.cls ?? 1) > 0.1) failures.push(`mobile CLS ${mobileAudit.summary.cls}`);
  if ((desktopAudit.summary.cls ?? 1) > 0.1) failures.push(`desktop CLS ${desktopAudit.summary.cls}`);
  const summary = {
    generatedAt: new Date().toISOString(),
    thresholds: { mobilePerformance: 0.8, desktopPerformance: 0.9, accessibility: 1, seo: 1, bestPractices: 1, clsMaximum: 0.1 },
    mobile: mobileAudit.summary,
    desktop: desktopAudit.summary,
    failures,
  };
  const output = resolve(repositoryRoot, "output/reports/lighthouse-summary.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = validateLighthouseReports();
  console.log(JSON.stringify(summary));
  if (summary.failures.length) throw new Error(`Lighthouse budgets failed: ${summary.failures.join(", ")}`);
}
