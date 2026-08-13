import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(
  new URL(`../${path}`, import.meta.url),
  "utf8",
);

describe("request resource isolation integration", () => {
  it("routes primary request reads, timeline, dashboard, reports, and export through trusted readers", async () => {
    const [listPage, detailPage, dashboard, reports, exportRoute] =
      await Promise.all([
        source("src/app/(portal)/requests/page.tsx"),
        source("src/app/(portal)/requests/[id]/page.tsx"),
        source("src/app/(portal)/dashboard/page.tsx"),
        source("src/app/(portal)/reports/page.tsx"),
        source("src/app/api/export/requests/route.ts"),
      ]);

    expect(listPage).toContain("searchAuthorizedRequests(actor");
    expect(detailPage).toContain("getAuthorizedRequest(actor, id)");
    expect(detailPage).toContain("listAuthorizedRequestWorkflowEvents");
    expect(dashboard).toContain("resolveDashboardReportingScope(actor");
    expect(dashboard).toContain("getAuthorizedDashboardPeriodReport(actor, period, scope)");
    expect(reports).toContain("getAuthorizedDashboardData(actor)");
    expect(exportRoute).toContain("listAuthorizedFilteredRequests(user,filters)");
    for (const text of [listPage, detailPage, dashboard, reports, exportRoute]) {
      expect(text).not.toMatch(/\b(listRequests|getRequest)\s*\(/);
    }
  });

  it("uses predicate-first approvals, finance, and delivery registers", async () => {
    const [approvals, finance, delivery, deliveryRuntime] = await Promise.all([
        source("src/app/(portal)/approvals/page.tsx"),
        source("src/app/(portal)/finance/page.tsx"),
        source("src/app/api/deliveries/workspace/route.ts"),
        source("src/lib/delivery-execution.ts"),
      ]);

    expect(approvals).toContain("getApprovalWorkspace(actor)");
    expect(finance).toContain("loadAuthorizedFinanceRegisters(actor)");
    expect(delivery).toContain("getDeliverySupervisorWorkspace(actor)");
    expect(delivery).toContain('canAccess(actor, "manage_deliveries")');
    expect(deliveryRuntime).toContain("axora_delivery_supervisor_workspace");
    for (const text of [approvals, finance, delivery]) {
      expect(text).not.toMatch(/\blistRequests\s*\(/);
    }
  });

  it("uses transaction-scoped request creation and status mutation", async () => {
    const [actions, writer] = await Promise.all([
      source("src/app/(portal)/requests/actions.ts"),
      source("src/lib/request-writer.ts"),
    ]);
    expect(actions).toContain("createAuthorizedRequest");
    expect(actions).toContain("updateAuthorizedRequestStatus");
    expect(actions).not.toContain("createRequest(");
    expect(actions).not.toContain("updateRequestStatus(");
    expect(writer).toContain("lockRequestCreationScope");
    expect(writer).toContain("lockRequestResourceAccess");
    expect(writer).toContain("withAuditTransaction");
  });
});
