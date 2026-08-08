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

    expect(listPage).toContain("listAuthorizedRequests(actor)");
    expect(detailPage).toContain("getAuthorizedRequest(actor, id)");
    expect(detailPage).toContain("listAuthorizedRequestWorkflowEvents");
    expect(dashboard).toContain("getAuthorizedDashboardData(actor)");
    expect(reports).toContain("getAuthorizedDashboardData(actor)");
    expect(exportRoute).toContain("listAuthorizedRequests(user)");
    for (const text of [listPage, detailPage, dashboard, reports, exportRoute]) {
      expect(text).not.toMatch(/\b(listRequests|getRequest)\s*\(/);
    }
  });

  it("uses predicate-first approvals, sourcing, finance, delivery, and document registers", async () => {
    const [approvals, sourcing, finance, delivery, documents,
      operationRuntime] = await Promise.all([
        source("src/app/(portal)/approvals/page.tsx"),
        source("src/app/(portal)/sourcing/page.tsx"),
        source("src/app/(portal)/finance/page.tsx"),
        source("src/app/(portal)/deliveries/page.tsx"),
        source("src/app/(portal)/documents/page.tsx"),
        source("src/lib/operational-isolation.ts"),
      ]);

    expect(approvals).toContain("listAuthorizedApprovals(actor)");
    expect(sourcing).toContain("loadAuthorizedSourcingRegisters(actor)");
    expect(finance).toContain("loadAuthorizedFinanceRegisters(actor)");
    expect(delivery).toContain("loadAuthorizedDeliveryRegisters(actor)");
    expect(documents).toContain("loadAuthorizedDocumentRegisters(actor)");
    expect(operationRuntime).toContain("axora_operation_request_access_rows");
    for (const text of [approvals, sourcing, finance, delivery, documents]) {
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
