import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { DashboardPeriod } from "@/lib/dashboard-period";
import type { DashboardReportingScope } from "@/lib/dashboard-reader";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withAuditTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

vi.mock("@/lib/dashboard-data", () => ({
  isPlatformAnalyticsActor: (actor: { isOwner?: boolean }) => Boolean(actor.isOwner),
}));

vi.mock("@/lib/organization-access", () => ({
  loadOrganizationDirectory: vi.fn(),
}));

vi.mock("@/lib/request-reader", () => ({
  listAuthorizedRequests: vi.fn(),
}));

import { getAuthorizedDashboardPeriodReport } from "@/lib/dashboard-reader";

const period = {
  preset: "current-month",
  startDate: "2026-08-01",
  endExclusiveDate: "2026-09-01",
  generatedAt: "2026-08-10T04:00:00.000Z",
} as DashboardPeriod;

const directory = {
  capturedAt: new Date("2026-08-10T04:00:00.000Z"),
  companies: [],
  branches: [],
};

const summary = {
  requestCount: 0,
  openRequestCount: 0,
  urgentRequestCount: 0,
  requestedValue: 0,
  approvedSpend: 0,
  pendingApprovalCount: 0,
  sales: 0,
  buyingCost: 0,
  deliveryCharges: 0,
  delayedDeliveryCount: 0,
  outstandingInvoiceCount: 0,
};

function actor(platform = false) {
  return {
    id: "10000000-0000-4000-8000-000000000089",
    email: "actor@example.test",
    name: "Dashboard actor",
    role: platform ? "PLATFORM_OWNER" : "COMPANY_ADMIN",
    accountKind: platform ? "PLATFORM" : "COMPANY",
    scopeType: platform ? "PLATFORM" : "COMPANY",
    roleAssignmentId: "20000000-0000-4000-8000-000000000089",
    companyId: platform ? undefined : "30000000-0000-4000-8000-000000000089",
    isOwner: platform,
    timezone: "Asia/Kuala_Lumpur",
  } as unknown as AuthenticatedSessionUser;
}

function scope(platform = false): DashboardReportingScope {
  return {
    timeZone: platform ? "UTC" : "Asia/Kuala_Lumpur",
    branchUnavailable: false,
    branches: [],
    directory,
    platformAnalytics: platform,
  };
}

function mockReportQueries(platform = false) {
  mocks.query.mockResolvedValueOnce({ rows: [summary] });
  mocks.query.mockResolvedValueOnce({ rows: [] });
  mocks.query.mockResolvedValueOnce({ rows: [] });
  if (platform) mocks.query.mockResolvedValueOnce({ rows: [] });
  mocks.query.mockResolvedValueOnce({ rows: [] });
}

function expectExactQueryBindings() {
  for (const [sql, values] of mocks.query.mock.calls) {
    const placeholders = Array.from(
      String(sql).matchAll(/\$(\d+)/g),
      (match) => Number(match[1]),
    );
    expect(placeholders.length).toBeGreaterThan(0);
    expect(values).toHaveLength(Math.max(...placeholders));
  }
}

describe("dashboard database query binding contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withAuditTransaction.mockImplementation(
      async (_context, callback) => callback({ query: mocks.query }),
    );
  });

  it("binds the exact company dashboard parameters each statement references", async () => {
    mockReportQueries();

    await expect(getAuthorizedDashboardPeriodReport(actor(), period, scope()))
      .resolves.toMatchObject({ scope: "company" });

    expect(mocks.query.mock.calls.map(([, values]) => values.length))
      .toEqual([9, 7, 9, 8]);
    expectExactQueryBindings();
  });

  it("binds the exact platform top-product parameters without leaking extras", async () => {
    mockReportQueries(true);

    await expect(
      getAuthorizedDashboardPeriodReport(actor(true), period, scope(true)),
    ).resolves.toMatchObject({ scope: "platform" });

    expect(mocks.query.mock.calls.map(([, values]) => values.length))
      .toEqual([9, 7, 9, 7, 8]);
    expectExactQueryBindings();
  });
});
