import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: vi.fn(),
  withAuditTransaction: mocks.withAuditTransaction,
}));

import type { SessionUser } from "@/lib/auth";
import { setUserActive } from "@/lib/users";

const platformOwner: SessionUser = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  name: "Owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
};

const companyAdmin: SessionUser = {
  id: "90000000-0000-4000-8000-000000000002",
  email: "admin@example.test",
  name: "Company admin",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
};

describe("People & Access safety boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never deactivates the signed-in account", async () => {
    await expect(setUserActive(platformOwner.id, false, platformOwner))
      .rejects.toThrow(/own signed-in account/i);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("protects the last active platform owner but allows a non-last owner", async () => {
    const target = {
      active: true,
      isOwner: true,
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      setupCompleted: true,
    };
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(scoped_role.role_key")) {
        return { rowCount: 1, rows: [target] };
      }
      if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("count(DISTINCT account.id)")) {
        return { rowCount: 1, rows: [{ count: "1" }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const otherOwnerId = "90000000-0000-4000-8000-000000000009";
    await expect(setUserActive(otherOwnerId, false, platformOwner))
      .rejects.toThrow(/last active platform owner/i);

    vi.clearAllMocks();
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(scoped_role.role_key")) {
        return { rowCount: 1, rows: [target] };
      }
      if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("count(DISTINCT account.id)")) {
        return { rowCount: 1, rows: [{ count: "2" }] };
      }
      if (sql.includes("UPDATE users")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE account_setup_invitations")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(setUserActive(otherOwnerId, false, platformOwner)).resolves.toBeUndefined();
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("SET active=$2"))).toBe(true);
    const statements = mocks.client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes("UPDATE account_setup_invitations")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("SET active=$2")));
  });

  it("protects the last active company administrator", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(scoped_role.role_key")) {
        return { rowCount: 1, rows: [{
          active: true,
          isOwner: false,
          role: "COMPANY_ADMIN",
          accountKind: "COMPANY",
          scopeType: "COMPANY",
          companyId: companyAdmin.companyId,
          setupCompleted: true,
        }] };
      }
      if (sql.includes("SELECT 1 FROM companies")) return { rowCount: 1, rows: [{}] };
      if (sql.includes("count(DISTINCT account.id)")) {
        return { rowCount: 1, rows: [{ count: "1" }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(setUserActive(
      "90000000-0000-4000-8000-000000000003",
      false,
      companyAdmin,
    )).rejects.toThrow(/last active company administrator/i);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("SET active=$2"))).toBe(false);
  });

  it("reactivates an authorized suspended account without replacing audit history", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COALESCE(scoped_role.role_key")) {
        return { rowCount: 1, rows: [{
          active: false,
          isOwner: false,
          role: "REQUESTER",
          accountKind: "COMPANY",
          scopeType: "COMPANY",
          companyId: companyAdmin.companyId,
          setupCompleted: true,
        }] };
      }
      if (sql.includes("UPDATE users")) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(setUserActive(
      "90000000-0000-4000-8000-000000000006",
      true,
      companyAdmin,
    )).resolves.toBeUndefined();
    expect(mocks.client.query.mock.calls.some(([sql, parameters]) =>
      String(sql).includes("SET active=$2") && parameters?.[1] === true)).toBe(true);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE account_setup_invitations"))).toBe(false);
  });

  it("rejects a branch administrator managing roles outside the allowlist", async () => {
    const branchAdmin: SessionUser = {
      ...companyAdmin,
      id: "90000000-0000-4000-8000-000000000004",
      role: "BRANCH_ADMIN",
      scopeType: "BRANCH",
      branchId: "20000000-0000-4000-8000-000000000001",
    };
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [{
      active: true,
      isOwner: false,
      role: "BRANCH_ADMIN",
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId: branchAdmin.companyId,
      branchId: branchAdmin.branchId,
      setupCompleted: true,
    }] });
    await expect(setUserActive(
      "90000000-0000-4000-8000-000000000005",
      false,
      branchAdmin,
    )).rejects.toThrow(/cannot manage this user/i);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe("normal account lifecycle architecture", () => {
  const sourceRoot = new URL("../src", import.meta.url).pathname;

  it("keeps account removal non-destructive", () => {
    const activeSurfaces = [
      new URL("../src/lib/users.ts", import.meta.url),
      new URL("../src/app/(portal)/users/actions.ts", import.meta.url),
      new URL("../src/app/(portal)/users/page.tsx", import.meta.url),
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    expect(activeSurfaces).not.toMatch(/DELETE\s+FROM\s+users/i);
    expect(activeSurfaces).toContain("removeAuthorizedUser");
    expect(activeSurfaces).toContain("removeUserAction");
  });

  it("never writes immutable audit rows directly from application runtime", () => {
    const directAuditDml = /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+audit_logs\b/i;
    const offenders = sourceFiles(sourceRoot).filter((path) =>
      directAuditDml.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
