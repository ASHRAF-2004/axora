import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { branchBudgetRefusal } from "@/lib/branch-budget-refusal";
import { branchBudgetRefusalMessages,branchBudgetRefusalMessage } from "@/lib/branch-budget-refusal-i18n";
import { canManageBranchLifecycle } from "@/lib/branch-lifecycle-policy";

const mocks = vi.hoisted(() => ({ query: vi.fn(),transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDemoMode: () => false,query: vi.fn(),withAuditTransaction: mocks.transaction }));
import { addBranchBudget } from "@/lib/branch-budget";

const actor = { id: "bf000000-0000-4000-8000-000000000001",email: "budget-refusal@example.test",
  name: "Isolated budget actor",role: "COMPANY_ADMIN",isOwner: false,accountKind: "COMPANY",scopeType: "COMPANY",
  authVersion: 1,companyId: "bf000000-0000-4000-8000-000000000002",
  roleAssignmentId: "bf000000-0000-4000-8000-000000000003",effectivePermissions: ["manage_branch_budget","manage_branches"],
} satisfies AuthenticatedSessionUser;
const command = { branchId: "bf000000-0000-4000-8000-000000000004",commandId: "bf000000-0000-4000-8000-000000000005",amount: "0.01" };

describe("branch budget safe refusal contract", () => {
  beforeEach(() => {
    mocks.query.mockReset(); mocks.transaction.mockReset();
    mocks.transaction.mockImplementation((_context,work) => work({ query: mocks.query }));
  });
  it.each([["AX001","INVALID"],["AX002","FORBIDDEN"],["AX003","BUDGET_UNAVAILABLE"],
    ["AX004","CEILING_EXCEEDED"],["AX005","COMMAND_MISMATCH"]])("maps only the typed %s reason to %s", async (sqlCode,code) => {
    mocks.query.mockRejectedValue({ code: sqlCode,message: "Private arbitrary SQL text" });
    await expect(addBranchBudget(actor,command)).rejects.toMatchObject({ name: "BranchBudgetError",code,message: code });
  });
  it("does not render or persist arbitrary SQL messages/detail", () => {
    expect(branchBudgetRefusal({ code: "P0001",message: "Private SQL",detail: "Private rows" })).toEqual({ code: "UNAVAILABLE" });
    expect(branchBudgetRefusal({ code: "AX004",detail: "Private rows" })).toEqual({ code: "CEILING_EXCEEDED" });
    expect(branchBudgetRefusal({ code: "AX004",detail: JSON.stringify({ ceiling: "1.00",allocated: "1.00",headroom: "private" }) })).toEqual({ code: "CEILING_EXCEEDED" });
  });
  it("keeps very large decimal limits exact without floating-point conversion", () => {
    expect(branchBudgetRefusal({ code: "AX004",detail: JSON.stringify({ ceiling: "9999999999999999.99",allocated: "0.01",headroom: "9999999999999999.98" }) }))
      .toEqual({ code: "CEILING_EXCEEDED",limits: { ceiling: "9999999999999999.99",allocated: "0.01",headroom: "9999999999999999.98" } });
  });
  it.each(["0","-1","1.001","1e2","NaN","", "10000000000000000"]) ("rejects invalid amount %s before a database command", async (amount) => {
    await expect(addBranchBudget(actor,{ ...command,amount })).rejects.toMatchObject({ code: "INVALID" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("sends decimal text and the same command ID, not float calculations or cash mutations", async () => {
    mocks.query.mockResolvedValue({ rows: [{ result: { changed: false } }] });
    await expect(addBranchBudget(actor,command)).resolves.toEqual({ changed: false });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("axora_add_branch_budget"),
      [actor.id,actor.roleAssignmentId,command.branchId,"0.01",command.commandId]);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.objectContaining({ commandId: command.commandId,reason: "COMPANY_ADMIN_BRANCH_BUDGET_ADD" }),expect.any(Function));
  });
  it("separates permission refusal from amount validation without DB/detail exposure", async () => {
    await expect(addBranchBudget({ ...actor,effectivePermissions: [] },command)).rejects.toMatchObject({ code: "FORBIDDEN",limits: undefined });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["en","ar","ms"] as const)("has precise %s refusals with no Wallet cash-shortage instruction", (locale) => {
    const messages = branchBudgetRefusalMessages(locale);
    for (const code of ["CEILING_EXCEEDED","BUDGET_UNAVAILABLE","FORBIDDEN","COMMAND_MISMATCH","UNAVAILABLE"] as const) {
      expect(branchBudgetRefusalMessage(locale,code)).toBe(messages[code]);
      expect(messages[code].length).toBeGreaterThan(10);
    }
    expect(Object.keys(messages)).toHaveLength(8);
  });
});

describe("branch lifecycle UI/server role ceiling", () => {
  it("forbids Branch Administrator even with a route GRANT, without removing operational permissions", () => {
    expect(canManageBranchLifecycle({ ...actor,role: "BRANCH_ADMIN",scopeType: "BRANCH",branchId: command.branchId })).toBe(false);
    expect(actor.effectivePermissions).toContain("manage_branches");
  });
  it("preserves Company Administrator/Owner and respects route permission denial", () => {
    expect(canManageBranchLifecycle(actor)).toBe(true);
    expect(canManageBranchLifecycle({ ...actor,role: "PLATFORM_OWNER",isOwner: true,accountKind: "PLATFORM",scopeType: "PLATFORM",companyId: undefined })).toBe(true);
    expect(canManageBranchLifecycle({ ...actor,effectivePermissions: [] })).toBe(false);
  });
});
