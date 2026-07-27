"use server";

import { requirePermission } from "@/lib/auth";
import { setBranchMonthlyBudget } from "@/lib/budgets";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const budgetSchema = z.object({
  branchId: z.uuid(),
  monthlyBudget: z.union([
    z.coerce.number().finite().min(0).max(100_000_000),
    z.literal(""),
  ]).transform((value) => value === "" ? null : value),
});

export async function setBranchBudgetAction(formData: FormData) {
  const actor = await requirePermission("manage_branch_budget");
  const input = budgetSchema.parse({
    branchId: String(formData.get("branchId") ?? ""),
    monthlyBudget: formData.get("monthlyBudget") ?? "",
  });
  await setBranchMonthlyBudget(input.branchId, input.monthlyBudget, actor);
  revalidatePath("/branches");
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
}
