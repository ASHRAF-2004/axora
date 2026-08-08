import { randomUUID } from "node:crypto";
import { getDemoStore } from "./demo-data";
import { isDemoMode } from "./db";
import type { SessionUser } from "./auth";
import { canAccess } from "./permissions";
import { getBudgetWorkspace, setBudgetAllocation } from "./budget-ledger";

export async function setBranchMonthlyBudget(
  branchId: string,
  monthlyBudget: number | null,
  actor: SessionUser,
) {
  if (!canAccess(actor, "manage_branch_budget") || !actor.companyId) {
    throw new Error("Only the company administrator can set branch budgets.");
  }
  if (monthlyBudget !== null && (!Number.isFinite(monthlyBudget) || monthlyBudget < 0)) {
    throw new Error("Enter a valid monthly budget.");
  }

  if (isDemoMode()) {
    const branch = getDemoStore().branches.find(
      (item) => item.id === branchId && item.companyId === actor.companyId,
    );
    if (!branch) throw new Error("Branch not found.");
    branch.monthlyBudget = monthlyBudget ?? undefined;
    branch.remainingAmount = monthlyBudget === null
      ? undefined
      : Math.max(monthlyBudget - branch.committedAmount, 0);
    return;
  }

  const workspace = await getBudgetWorkspace(actor);
  const account = workspace?.accounts.find((item) => (
    item.levelType === "BRANCH" && item.branchId === branchId
  ));
  if (!account) throw new Error("Active branch not found.");
  await setBudgetAllocation({
    actor,
    accountId: account.id,
    amount: monthlyBudget ?? 0,
    explanation: monthlyBudget === null
      ? "Branch recurring budget cleared"
      : "Branch recurring budget updated",
    idempotencyKey: `branch-budget-${randomUUID()}`,
  });
}
