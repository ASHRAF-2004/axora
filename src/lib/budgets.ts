import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";
import type { SessionUser } from "./auth";

export async function setBranchMonthlyBudget(
  branchId: string,
  monthlyBudget: number | null,
  actor: SessionUser,
) {
  if (actor.isOwner || actor.role !== "ADMIN" || !actor.companyId) {
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

  await withAuditTransaction(
    { userId: actor.id, reason: monthlyBudget === null ? "Branch monthly budget cleared" : "Branch monthly budget updated" },
    async (client) => {
      const result = await client.query(
        `UPDATE branches
         SET monthly_budget=$3,budget_updated_at=now()
         WHERE id=$1 AND company_id=$2 AND active=true`,
        [branchId, actor.companyId, monthlyBudget],
      );
      if (!result.rowCount) throw new Error("Active branch not found.");
    },
  );
}
