import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("P1-15 dashboard aggregation isolation", () => {
  it("starts production cohorts with database authorization and timezone boundaries", async () => {
    const source = await readFile(
      new URL("../src/lib/dashboard-reader.ts", import.meta.url),
      "utf8",
    );
    const access = source.indexOf("JOIN public.axora_request_access_rows");
    const cohort = source.indexOf("WHERE cohort_at>=");

    expect(access).toBeGreaterThan(-1);
    expect(cohort).toBeGreaterThan(access);
    expect(source).toContain("request.branch_id=$7::uuid");
    expect(source).toContain("$4::date AT TIME ZONE $6");
    expect(source).toContain("$5::date AT TIME ZONE $6");
    expect(source).toContain("scope.platformAnalytics");
    expect(source).toContain("request_row.can_view_commercial");
    expect(source).toContain("request_row.can_view_finance");
    expect(source).not.toContain("unstable_cache");
    expect(source).not.toContain("revalidateTag");
  });

  it("keeps private commercial fields out of the safe company snapshot", async () => {
    const source = await readFile(
      new URL("../src/lib/dashboard-reader.ts", import.meta.url),
      "utf8",
    );
    const companyStart = source.indexOf("function mapCompanySnapshot");
    const platformStart = source.indexOf("function mapPlatformSnapshot");
    const companyMapper = source.slice(companyStart, platformStart);

    expect(companyStart).toBeGreaterThan(-1);
    expect(companyMapper).toContain("requestedValue");
    expect(companyMapper).toContain("approvedSpend");
    expect(companyMapper).not.toContain("buyingCost");
    expect(companyMapper).not.toContain("grossProfit");
    expect(companyMapper).not.toContain("deliveryCharges");
  });

  it("removes all-time request loading from the dashboard page", async () => {
    const page = await readFile(
      new URL("../src/app/(portal)/dashboard/page.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain("getAuthorizedDashboardPeriodReport");
    expect(page).toContain("resolveDashboardReportingScope");
    expect(page).not.toContain("listAuthorizedRequests");
    expect(page).not.toContain("getAuthorizedDashboardData");
  });
});
