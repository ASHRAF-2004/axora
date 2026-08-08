import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
}));

import { listAuditRecords } from "@/lib/operations";

describe("tenant-safe audit query filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000001",
      name: "Branch auditor",
      role: "AUDITOR",
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId: "20000000-0000-4000-8000-000000000001",
      branchId: "30000000-0000-4000-8000-000000000001",
      roleAssignmentId: "35000000-0000-4000-8000-000000000001",
      isOwner: false,
    });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("binds the exact actor assignment and normalized filters to the scoped capability", async () => {
    await listAuditRecords({
      entityType: "requests",
      action: "update",
      actor: "A%_name",
      recordId: "40000000-0000-4000-8000-000000000001",
      from: "2026-08-01",
      to: "2026-08-02",
    });

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("public.axora_audit_rows");
    expect(sql).not.toContain("FROM audit_logs");
    expect(values).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "35000000-0000-4000-8000-000000000001",
      "requests", "UPDATE", "A%_name",
      "40000000-0000-4000-8000-000000000001",
      null, null, null, null, null, null,
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T23:59:59.999Z",
      500,
    ]);
  });

  it("drops malformed tokens rather than interpolating them into SQL", async () => {
    await listAuditRecords({ entityType: "requests' OR true --", action: "UPDATE); DROP TABLE users;--" });
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("OR true");
    expect(values).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "35000000-0000-4000-8000-000000000001",
      null, null, null, null, null, null, null, null, null, null, null, null,
      500,
    ]);
  });
});
