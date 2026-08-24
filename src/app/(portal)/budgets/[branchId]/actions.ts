"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth";
import { branchBudgetMessages } from "@/lib/branch-budget-i18n";
import { BranchBudgetError, configureFirstBranchBudget } from "@/lib/branch-budget";
import { readFormText } from "@/lib/validation";

export type BudgetActionState = { status: "idle" | "success" | "error" | "funding" | "immutable"; message: string; submissionId: string };
const schema = z.object({
  branchId: z.union([z.uuid(), z.string().regex(/^br-[a-z0-9-]{3,80}$/)]),
  amount: z.coerce.number().positive().max(100_000_000), cycle: z.enum(["MONTHLY", "YEARLY", "CUSTOM"]),
  startDate: z.iso.date(), customEndDate: z.union([z.literal(""), z.iso.date()]), commandId: z.uuid(),
});

export async function configureFirstBranchBudgetAction(_state: BudgetActionState, formData: FormData): Promise<BudgetActionState> {
  const actor = await requirePermission("manage_branch_budget");
  const locale = actor.preferredLocale ?? "en";
  const copy = branchBudgetMessages(locale);
  const submissionId = crypto.randomUUID();
  const parsed = schema.safeParse({
    branchId: readFormText(formData, "branchId"), amount: readFormText(formData, "amount"), cycle: readFormText(formData, "cycle"),
    startDate: readFormText(formData, "startDate"), customEndDate: readFormText(formData, "customEndDate"), commandId: readFormText(formData, "commandId"),
  });
  if (!parsed.success) return { status: "error", message: copy.failure, submissionId };
  try {
    const result = await configureFirstBranchBudget(actor, { ...parsed.data, customEndDate: parsed.data.customEndDate || undefined });
    if (result === "FUNDING_REQUIRED") return { status: "funding", message: copy.funding, submissionId };
    if (result === "ACTIVE_IMMUTABLE") return { status: "immutable", message: copy.immutable, submissionId };
    revalidatePath("/budgets"); revalidatePath(`/budgets/${parsed.data.branchId}`); revalidatePath(`/branches/${parsed.data.branchId}`);
    return { status: "success", message: copy.success, submissionId };
  } catch (error) {
    return { status: "error", message: error instanceof BranchBudgetError ? copy.failure : copy.failure, submissionId };
  }
}
