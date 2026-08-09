import { describe, expect, it } from "vitest";
import {
  DASHBOARD_METRIC_DEFINITIONS,
  calculateDashboardComparison,
  dashboardPeriodSearchParams,
  normalizeDashboardPeriod,
  reportingDateAt,
} from "@/lib/dashboard-period";

describe("P1-15 dashboard period contract", () => {
  it("defaults to the current local month with an exclusive next-day boundary", () => {
    const now = new Date("2026-03-31T16:30:00.000Z");
    const period = normalizeDashboardPeriod({}, "Asia/Kuala_Lumpur", now);

    expect(reportingDateAt(now, "Asia/Kuala_Lumpur")).toBe("2026-04-01");
    expect(period).toMatchObject({
      preset: "current-month",
      startDate: "2026-04-01",
      endDate: "2026-04-01",
      endExclusiveDate: "2026-04-02",
      timeZone: "Asia/Kuala_Lumpur",
    });
  });

  it("resolves every preset as explicit inclusive and exclusive local dates", () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    expect(normalizeDashboardPeriod(
      { preset: "previous-month" },
      "UTC",
      now,
    )).toMatchObject({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      endExclusiveDate: "2026-08-01",
    });
    expect(normalizeDashboardPeriod(
      { preset: "last-3-months" },
      "UTC",
      now,
    )).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-08-09",
      endExclusiveDate: "2026-08-10",
    });
    expect(normalizeDashboardPeriod(
      { preset: "year-to-date" },
      "UTC",
      now,
    )).toMatchObject({
      startDate: "2026-01-01",
      endExclusiveDate: "2026-08-10",
    });
    expect(normalizeDashboardPeriod(
      { preset: "previous-year" },
      "UTC",
      now,
    )).toMatchObject({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      endExclusiveDate: "2026-01-01",
    });
  });

  it("keeps custom end dates inclusive and allows future no-data periods", () => {
    expect(normalizeDashboardPeriod({
      preset: "custom",
      start: "2027-01-01",
      end: "2027-01-31",
      compare: "1",
    }, "UTC", new Date("2026-08-09T00:00:00.000Z"))).toMatchObject({
      preset: "custom",
      startDate: "2027-01-01",
      endDate: "2027-01-31",
      endExclusiveDate: "2027-02-01",
      compare: true,
      comparison: {
        startDate: "2026-12-01",
        endDate: "2026-12-31",
        endExclusiveDate: "2027-01-01",
      },
    });
  });

  it("falls back safely for reversed, malformed, and oversized ranges", () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    expect(normalizeDashboardPeriod({
      preset: "custom",
      start: "2026-09-01",
      end: "2026-08-01",
    }, "UTC", now).issue).toBe("start-after-end");
    expect(normalizeDashboardPeriod({
      preset: "custom",
      start: "not-a-date",
      end: "2026-08-01",
    }, "UTC", now).issue).toBe("invalid-custom-date");
    expect(normalizeDashboardPeriod({
      preset: "custom",
      start: "2010-01-01",
      end: "2026-08-01",
    }, "UTC", now).issue).toBe("range-too-large");
    expect(normalizeDashboardPeriod({
      preset: "invented",
    }, "UTC", now).issue).toBe("invalid-preset");
  });

  it("handles zero comparison denominators without infinity or NaN", () => {
    expect(calculateDashboardComparison(0, 0)).toEqual({
      absolute: 0,
      percentage: 0,
      direction: "same",
    });
    expect(calculateDashboardComparison(50, 0)).toEqual({
      absolute: 50,
      percentage: null,
      direction: "up",
    });
    expect(calculateDashboardComparison(75, 100)).toEqual({
      absolute: -25,
      percentage: -25,
      direction: "down",
    });
  });

  it("serializes only the applied scope and period state", () => {
    const period = normalizeDashboardPeriod({
      preset: "custom",
      start: "2026-07-01",
      end: "2026-07-31",
      compare: "true",
    }, "UTC", new Date("2026-08-09T00:00:00.000Z"));
    expect(dashboardPeriodSearchParams(
      period,
      "20000000-0000-4000-8000-000000000001",
    ).toString()).toBe(
      "preset=custom&start=2026-07-01&end=2026-07-31&compare=1&branch=20000000-0000-4000-8000-000000000001",
    );
  });

  it("keeps the metric dictionary unique and complete", () => {
    const keys = DASHBOARD_METRIC_DEFINITIONS.map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([
      "requestCount",
      "requestedValue",
      "approvedSpend",
      "sales",
      "buyingCost",
      "grossMarginPercent",
      "monthlyBudget",
    ]));
    expect(DASHBOARD_METRIC_DEFINITIONS.every((metric) => (
      metric.dateField.length > 0
      && metric.statuses.length > 0
      && metric.refresh === "Live at page load"
    ))).toBe(true);
  });
});
