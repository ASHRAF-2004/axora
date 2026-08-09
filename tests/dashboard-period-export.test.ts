import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DASHBOARD_METRIC_DEFINITIONS } from "@/lib/dashboard-period";

describe("P1-15 dashboard export contract", () => {
  it("uses the same period, scope, and authorized report functions as the page", async () => {
    const source = await readFile(
      new URL("../src/app/api/export/dashboard/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("normalizeDashboardPeriod");
    expect(source).toContain("resolveDashboardReportingScope");
    expect(source).toContain("getAuthorizedDashboardPeriodReport");
    expect(source).toContain('"Exported authorized dashboard period"');
    expect(source).toContain('"start_inclusive"');
    expect(source).toContain('"end_exclusive"');
    expect(source).toContain('"generated_at"');
    expect(source).toContain('"date_semantics"');
    expect(source).toContain('"freshness"');
    expect(source).toContain('"Cache-Control": "private, no-store"');
  });

  it("documents every runtime metric key", async () => {
    const dictionary = await readFile(
      new URL("../docs/dashboard-metric-dictionary.md", import.meta.url),
      "utf8",
    );
    for (const metric of DASHBOARD_METRIC_DEFINITIONS) {
      expect(dictionary).toContain(metric.key);
    }
    expect(dictionary).toContain("inclusive");
    expect(dictionary).toContain("exclusive");
    expect(dictionary).toContain("no shared dashboard cache");
  });
});
