import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildCompanyDashboardData,
  isPlatformAnalyticsActor,
} from "@/lib/dashboard-data";
import type { SessionUser } from "@/lib/auth";
import type { ProcurementRequest } from "@/lib/types";

const companyActor = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "admin@company-a.example",
  name: "Company A admin",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "20000000-0000-4000-8000-000000000001",
  isOwner: false,
} as unknown as SessionUser;

const request = {
  id: "30000000-0000-4000-8000-000000000001",
  orderCode: "REQ-A-001",
  status: "Pending Approval",
  urgency: "Urgent",
  neededByDate: "2026-08-10",
  lines: [],
} as unknown as ProcurementRequest;

describe("P0-11 analytics contract isolation", () => {
  it("returns a deliberately small company contract even for low-count data", () => {
    const data = buildCompanyDashboardData([request]);

    expect(data).toEqual({
      scope: "company",
      requestCount: 1,
      openRequestCount: 1,
      urgentRequestCount: 1,
      byStatus: [{ label: "Pending Approval", value: 1 }],
      attention: [request],
    });
    expect(Object.keys(data)).not.toEqual(expect.arrayContaining([
      "sales",
      "buyingCost",
      "grossProfit",
      "grossMarginPercent",
      "deliveryCharges",
      "delayedDeliveryCount",
      "outstandingInvoiceCount",
      "activeCompanyCount",
      "activeSupplierCount",
      "byCompany",
      "topProducts",
    ]));
  });

  it("does not treat a generic platform account as an analytics authority", () => {
    expect(isPlatformAnalyticsActor(companyActor)).toBe(false);
    expect(isPlatformAnalyticsActor({
      ...companyActor,
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      companyId: undefined,
      role: "IT_SUPPORT",
    } as SessionUser)).toBe(false);
    expect(isPlatformAnalyticsActor({
      ...companyActor,
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      companyId: undefined,
      role: "PLATFORM_OPERATIONS",
    } as unknown as SessionUser)).toBe(false);
    expect(isPlatformAnalyticsActor({
      ...companyActor,
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      companyId: undefined,
      role: "PLATFORM_OWNER",
      isOwner: true,
    } as unknown as SessionUser)).toBe(true);
  });

  it("branches before loading cross-company organization aggregates", async () => {
    const source = await readFile(new URL("../src/lib/request-reader.ts", import.meta.url), "utf8");
    const branch = source.indexOf("if (!isPlatformAnalyticsActor(actor))");
    const organizationLoad = source.indexOf("loadOrganizationDirectory(actor)", branch);

    expect(branch).toBeGreaterThan(-1);
    expect(organizationLoad).toBeGreaterThan(branch);
    expect(source).not.toContain("listSuppliers(actor)");
    expect(source.slice(branch, organizationLoad)).toContain("return buildCompanyDashboardData");
  });
});
