import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    getBudgetWorkspace: vi.fn(),
    withAuditTransaction: vi.fn(async (
      _context: unknown,
      work: (transactionClient: typeof client) => Promise<unknown>,
    ) => work(client)),
  };
});

vi.mock("@/lib/budget-ledger", () => ({
  getBudgetWorkspace: mocks.getBudgetWorkspace,
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: vi.fn(),
  withAuditTransaction: mocks.withAuditTransaction,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { configureFirstBranchBudget } from "@/lib/branch-budget";
import { isoDateInTimeZone } from "@/lib/budget-period-range";

const actor = {
  id: "b3000000-0000-4000-8000-000000000003",
  email: "foundation-admin@example.test",
  name: "Foundation administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "b3000000-0000-4000-8000-000000000001",
  roleAssignmentId: "b3000000-0000-4000-8000-000000000004",
  isOwner: false,
  authVersion: 1,
  effectivePermissions: ["manage_branch_budget"],
} satisfies AuthenticatedSessionUser;

const branchId = "b3000000-0000-4000-8000-000000000007";
const commandId = "b3000000-0000-4000-8000-000000000008";
const commandAt = "2026-08-24T19:59:00.000Z";
const accountTimezone = "Asia/Kuala_Lumpur";

describe("Company Administrator first branch budget command date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(commandAt));
    mocks.client.query.mockReset();
    mocks.withAuditTransaction.mockClear();
    mocks.getBudgetWorkspace.mockReset();
    mocks.getBudgetWorkspace.mockResolvedValue({
      capturedAt: commandAt,
      accounts: [{
        id: "b3000000-0000-4000-8000-000000000009",
        companyId: actor.companyId,
        levelType: "BRANCH",
        branchId,
        code: "BRANCH-CYB-BUDGET",
        name: "Cyberjaya budget",
        currency: "MYR",
        recurringAllocation: "0.00",
        refreshInterval: "MONTHLY",
        timezone: accountTimezone,
        rolloverPolicy: "NONE",
        active: true,
        canAssign: true,
        canIncrease: false,
        canReduce: false,
        canRefresh: false,
      }],
      periods: [],
      entries: [],
      ceilings: [],
    });
    mocks.client.query.mockResolvedValue({ rows: [{ result: { status: "CREATED" } }] });
  });

  afterEach(() => vi.useRealTimers());

  it("uses the server-provided account-local date with the same authoritative command timestamp", async () => {
    const startDate = isoDateInTimeZone(commandAt, accountTimezone);
    expect(startDate).toBe("2026-08-25");

    await expect(configureFirstBranchBudget(actor, {
      branchId,
      amount: 1000,
      cycle: "MONTHLY",
      startDate,
      commandId,
    })).resolves.toBe("CREATED");

    const parameters = mocks.client.query.mock.calls[0]?.[1];
    expect(parameters?.[5]).toBe("2026-08-25");
    expect(parameters?.[8]).toEqual(new Date(commandAt));
  });
});
