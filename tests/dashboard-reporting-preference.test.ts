import { describe, expect, it } from "vitest";

import {
  clearDashboardReportingPreference,
  dashboardReportingPreferenceForUser,
  dashboardReportingPreferenceInput,
  hasExplicitDashboardReportingFilters,
  serializeDashboardReportingPreference,
} from "@/lib/dashboard-reporting-preference";

const firstUser = "10000000-0000-4000-8000-000000000001";
const secondUser = "20000000-0000-4000-8000-000000000001";
const branch = "30000000-0000-4000-8000-000000000001";

describe("dashboard reporting preference", () => {
  it("restores year-to-date and branch scope only for the authenticated user", () => {
    const saved = serializeDashboardReportingPreference(undefined, firstUser, {
      preset: "year-to-date", branchId: branch,
    }, "2026-09-09T00:00:00.000Z");

    expect(dashboardReportingPreferenceForUser(saved, firstUser)).toEqual({
      preset: "year-to-date", branchId: branch,
    });
    expect(dashboardReportingPreferenceInput(
      dashboardReportingPreferenceForUser(saved, firstUser),
    )).toEqual({ preset: "year-to-date" });
    expect(dashboardReportingPreferenceForUser(saved, secondUser)).toBeUndefined();
  });

  it("keeps exact custom dates and independently retains another user's selection", () => {
    const first = serializeDashboardReportingPreference(undefined, firstUser, {
      preset: "custom", start: "2026-01-14", end: "2026-08-31", branchId: branch,
    }, "2026-09-09T00:00:00.000Z");
    const saved = serializeDashboardReportingPreference(first, secondUser, {
      preset: "previous-month",
    }, "2026-09-09T00:01:00.000Z");

    expect(dashboardReportingPreferenceForUser(saved, firstUser)).toEqual({
      preset: "custom", start: "2026-01-14", end: "2026-08-31", branchId: branch,
    });
    expect(dashboardReportingPreferenceForUser(saved, secondUser)).toEqual({
      preset: "previous-month",
    });
  });

  it("treats explicit URL filters as canonical and clears only the current user's reset", () => {
    const first = serializeDashboardReportingPreference(undefined, firstUser, {
      preset: "year-to-date",
    }, "2026-09-09T00:00:00.000Z");
    const saved = serializeDashboardReportingPreference(first, secondUser, {
      preset: "current-month",
    }, "2026-09-09T00:01:00.000Z");

    expect(hasExplicitDashboardReportingFilters({ preset: "custom", start: "2026-09-01" })).toBe(true);
    expect(hasExplicitDashboardReportingFilters({})).toBe(false);
    const cleared = clearDashboardReportingPreference(saved, firstUser);
    expect(dashboardReportingPreferenceForUser(cleared, firstUser)).toBeUndefined();
    expect(dashboardReportingPreferenceForUser(cleared, secondUser)).toEqual({
      preset: "current-month",
    });
  });
});
