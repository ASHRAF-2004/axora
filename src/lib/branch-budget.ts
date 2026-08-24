import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { getBudgetWorkspace } from "@/lib/budget-ledger";
import { isDemoMode, query, withAuditTransaction } from "@/lib/db";
import { getDemoStore } from "@/lib/demo-data";
import { canAccess } from "@/lib/permissions";

const commandSchema = z.strictObject({
  branchId: z.union([z.string().uuid(), z.string().regex(/^br-[a-z0-9-]{3,80}$/)]), amount: z.number().positive().max(100_000_000),
  cycle: z.enum(["MONTHLY", "YEARLY", "CUSTOM"]), startDate: z.iso.date(),
  customEndDate: z.iso.date().optional(), commandId: z.string().uuid(),
}).superRefine((input, context) => {
  if (input.cycle === "CUSTOM" && (!input.customEndDate || input.customEndDate < input.startDate)) {
    context.addIssue({ code: "custom", path: ["customEndDate"], message: "Invalid custom period" });
  }
});

export type BranchBudgetCommand = z.infer<typeof commandSchema>;
export type BranchBudgetCommandStatus = "CREATED" | "ALREADY_CREATED" | "ACTIVE_IMMUTABLE" | "FUNDING_REQUIRED";

interface ResultRow extends QueryResultRow { result: { status?: BranchBudgetCommandStatus; branchId?: string; accountId?: string } | null }
export type BranchBudgetFundingState = {
  state: "READY" | "FUNDING_REQUIRED";
  requiredAmount?: string;
  availableAmount?: string;
  lastCheckedAt?: string;
};

export class BranchBudgetError extends Error {
  constructor(public readonly code: "INVALID" | "FORBIDDEN" | "UNAVAILABLE") { super(code); this.name = "BranchBudgetError"; }
}

export async function getBranchBudgetFundingState(
  actor: AuthenticatedSessionUser,
  branchId: string,
): Promise<BranchBudgetFundingState | null> {
  if (isDemoMode()) return { state: "READY" };
  if (!actor.roleAssignmentId) return null;
  const result = await query<{ payload: BranchBudgetFundingState | null }>(
    "SELECT public.axora_branch_budget_funding_state($1,$2,$3,now()) AS payload",
    [actor.id, actor.roleAssignmentId, branchId],
  );
  return result.rows[0]?.payload ?? null;
}

export async function configureFirstBranchBudget(actor: AuthenticatedSessionUser, value: unknown): Promise<BranchBudgetCommandStatus> {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success || actor.accountKind !== "COMPANY" || !actor.companyId || !canAccess(actor, "manage_branch_budget")) {
    throw new BranchBudgetError("INVALID");
  }
  const input = parsed.data;
  if (isDemoMode()) {
    const branch = getDemoStore().branches.find((candidate) => candidate.id === input.branchId && candidate.companyId === actor.companyId);
    if (!branch) throw new BranchBudgetError("FORBIDDEN");
    if ((branch.monthlyBudget ?? 0) > 0) return "ACTIVE_IMMUTABLE";
    branch.monthlyBudget = input.amount;
    branch.remainingAmount = input.amount;
    return "CREATED";
  }
  if (!actor.roleAssignmentId) throw new BranchBudgetError("FORBIDDEN");
  const workspace = await getBudgetWorkspace(actor);
  const account = workspace?.accounts.find((candidate) => candidate.levelType === "BRANCH" && candidate.branchId === input.branchId && candidate.companyId === actor.companyId);
  if (!account) throw new BranchBudgetError("FORBIDDEN");
  try {
    return await withAuditTransaction({ actor, reason: "FIRST_BRANCH_BUDGET_CONFIGURED", commandId: input.commandId }, async (client) => {
      const result = await client.query<ResultRow>(
        "SELECT public.axora_configure_first_branch_budget($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result",
        [actor.id, actor.roleAssignmentId, input.branchId, input.amount.toFixed(2), input.cycle, input.startDate, input.customEndDate ?? null, input.commandId, new Date()],
      );
      const status = result.rows[0]?.result?.status;
      if (!status || !["CREATED", "ALREADY_CREATED", "ACTIVE_IMMUTABLE", "FUNDING_REQUIRED"].includes(status)) throw new BranchBudgetError("UNAVAILABLE");
      return status;
    });
  } catch (error) {
    if (error instanceof BranchBudgetError) throw error;
    throw new BranchBudgetError("UNAVAILABLE");
  }
}
