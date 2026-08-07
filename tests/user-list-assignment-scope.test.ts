import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: vi.fn(),
}));

import type { SessionUser } from "@/lib/auth";
import { listUsers } from "@/lib/users";

const companyId = "10000000-0000-4000-8000-000000000143";
const branchId = "20000000-0000-4000-8000-000000000143";

const companyAdmin: SessionUser = {
  id: "30000000-0000-4000-8000-000000000143",
  email: "admin@example.test",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
  isOwner: false,
};

const branchAdmin: SessionUser = {
  ...companyAdmin,
  id: "40000000-0000-4000-8000-000000000143",
  role: "BRANCH_ADMIN",
  scopeType: "BRANCH",
  branchId,
};

describe("user-list assignment selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("selects the newest assignment inside the company actor's current scope", async () => {
    await listUsers(companyAdmin);
    const [sql, parameters] = mocks.query.mock.calls[0] as [string, unknown[]];
    const lateral = sql.slice(
      sql.indexOf("LEFT JOIN LATERAL ("),
      sql.indexOf(") assignment ON true"),
    );

    expect(lateral).toContain("current_assignment.company_id=$2::uuid");
    expect(lateral).toContain("$3::uuid IS NULL");
    expect(lateral).toContain("current_assignment.branch_id=$3::uuid");
    expect(lateral).toContain("OR u.id=$4::uuid");
    expect(lateral.indexOf("current_assignment.company_id=$2::uuid"))
      .toBeLessThan(lateral.indexOf("ORDER BY current_assignment.assigned_at"));
    expect(parameters).toEqual([
      false,
      companyId,
      null,
      companyAdmin.id,
    ]);
  });

  it("binds branch scope while retaining the signed-in user's own visible identity", async () => {
    await listUsers(branchAdmin);
    const [, parameters] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([
      false,
      companyId,
      branchId,
      branchAdmin.id,
    ]);
  });

  it("lets a platform owner select the globally newest active assignment", async () => {
    const owner: SessionUser = {
      id: "50000000-0000-4000-8000-000000000143",
      email: "owner@example.test",
      name: "Platform owner",
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: true,
    };
    await listUsers(owner);
    const [, parameters] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([true, null, null, owner.id]);
  });
});