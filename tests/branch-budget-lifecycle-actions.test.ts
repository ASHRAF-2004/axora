import { beforeEach,describe,expect,it,vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(),add: vi.fn(),setActive: vi.fn(),remove: vi.fn(),revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/repository", () => ({ setMasterActive: mocks.setActive,deleteEmptyBranch: mocks.remove }));
vi.mock("@/lib/budgets", () => ({ setBranchMonthlyBudget: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDemoMode: () => false,query: vi.fn(),withAuditTransaction: vi.fn() }));
vi.mock("@/lib/branch-budget", async (original) => {
  const actual = await original<typeof import("@/lib/branch-budget")>();
  return { ...actual,addBranchBudget: mocks.add };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { addBranchBudgetAction,deleteBranchAction,setBranchActiveAction } from "@/app/(portal)/branches/actions";
import { BranchBudgetError } from "@/lib/branch-budget";

const actor = { id: "ba000000-0000-4000-8000-000000000001",email: "branch-actions@example.test",
  name: "Isolated branch actor",role: "COMPANY_ADMIN",isOwner: false,accountKind: "COMPANY",scopeType: "COMPANY",
  authVersion: 1,companyId: "ba000000-0000-4000-8000-000000000002",
  roleAssignmentId: "ba000000-0000-4000-8000-000000000003",effectivePermissions: ["manage_branch_budget","manage_branches"],
} satisfies AuthenticatedSessionUser;
const initial = { status: "idle",message: "" } as const;
function form() {
  const result = new FormData();
  result.set("branchId","ba000000-0000-4000-8000-000000000004");
  result.set("commandId","ba000000-0000-4000-8000-000000000005");
  result.set("amount","500"); result.set("active","false");
  return result;
}

describe("branch budget/lifecycle server actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requirePermission.mockResolvedValue(actor); });
  it("carries only authorized typed ceiling detail, not raw SQL, through the action", async () => {
    const limits = { ceiling: "2000.00",allocated: "2000.00",headroom: "0.00" };
    mocks.add.mockRejectedValue(new BranchBudgetError("CEILING_EXCEEDED",limits));
    expect(await addBranchBudgetAction(initial,form())).toEqual({ status: "error",message: "CEILING_EXCEEDED",code: "CEILING_EXCEEDED",limits });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("returns stable invalid-amount code recognized by the form", async () => {
    mocks.add.mockRejectedValue(new BranchBudgetError("INVALID"));
    expect(await addBranchBudgetAction(initial,form())).toEqual({ status: "error",message: "INVALID",code: "INVALID" });
  });
  it("does not return arbitrary database messages or details", async () => {
    mocks.add.mockRejectedValue(new Error("Private SQL details"));
    expect(await addBranchBudgetAction(initial,form())).toEqual({ status: "error",message: "UNAVAILABLE",code: "UNAVAILABLE" });
  });
  it.each([setBranchActiveAction,deleteBranchAction])("denies Branch Administrator custom route GRANT before calling a lifecycle repository", async (action) => {
    mocks.requirePermission.mockResolvedValue({ ...actor,role: "BRANCH_ADMIN",scopeType: "BRANCH",branchId: String(form().get("branchId")) });
    expect(await action(initial,form())).toEqual({ status: "error",message: "BRANCH_UNAVAILABLE" });
    expect(mocks.setActive).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([addBranchBudgetAction,setBranchActiveAction,deleteBranchAction])("preserves authentication/framework control flow outside mutation error handling", async (action) => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.requirePermission.mockRejectedValue(redirect);
    await expect(action(initial,form())).rejects.toBe(redirect);
  });
  it("preserves authorized lifecycle and budget paths", async () => {
    mocks.add.mockResolvedValue({ changed: false });
    expect(await addBranchBudgetAction(initial,form())).toEqual({ status: "success",message: "BUDGET_ADDED" });
    mocks.setActive.mockResolvedValue(undefined);
    expect(await setBranchActiveAction(initial,form())).toEqual({ status: "success",message: "BRANCH_UPDATED" });
    mocks.remove.mockResolvedValue(undefined);
    expect(await deleteBranchAction(initial,form())).toEqual({ status: "success",message: "BRANCH_DELETED" });
  });
});
