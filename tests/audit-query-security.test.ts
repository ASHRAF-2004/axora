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
      isOwner: false,
    });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("keeps company and branch predicates ahead of parameterized user filters", async () => {
    await listAuditRecords({
      entityType: "requests",
      action: "update",
      actor: "A%_name",
      recordId: "40000000-0000-4000-8000-000000000001",
      from: "2026-08-01",
      to: "2026-08-02",
    });

    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("a.company_id=$1");
    expect(sql).toContain("scoped_request.branch_id=$2");
    expect(sql).toContain("a.entity_type=$3");
    expect(sql).toContain("upper(a.action)=$4");
    expect(sql).toContain("strpos(lower(COALESCE(u.display_name,'')),lower($5))>0");
    expect(sql).toContain("a.record_id=$6::uuid");
    expect(sql).toContain("a.occurred_at>=$7::date");
    expect(sql).toContain("a.occurred_at<($8::date + interval '1 day')");
    expect(values).toEqual([
      "20000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000001",
      "requests", "UPDATE", "A%_name",
      "40000000-0000-4000-8000-000000000001",
      "2026-08-01", "2026-08-02",
    ]);
  });

  it("drops malformed tokens rather than interpolating them into SQL", async () => {
    await listAuditRecords({ entityType: "requests' OR true --", action: "UPDATE); DROP TABLE users;--" });
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("OR true");
    expect(values).toEqual([
      "20000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000001",
    ]);
  });
});
