"use server";

import { requirePermission } from "@/lib/auth";
import { setBranchMonthlyBudget } from "@/lib/budgets";
import { addBranchBudget, BranchBudgetError } from "@/lib/branch-budget";
import { deleteEmptyBranch } from "@/lib/repository";
import { setMasterActive } from "@/lib/repository";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
  revalidatePath(`/branches/${input.branchId}`);
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  redirect(`/branches/${input.branchId}?notice=budget-updated`);
}

export type AddBranchBudgetActionState = { status: "idle" | "success" | "error"; message: string };

export async function addBranchBudgetAction(
  _state: AddBranchBudgetActionState,
  formData: FormData,
): Promise<AddBranchBudgetActionState> {
  const actor = await requirePermission("manage_branch_budget");
  const branchId = String(formData.get("branchId") ?? "");
  const commandId = String(formData.get("commandId") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  try {
    await addBranchBudget(actor, { branchId, commandId, amount });
    revalidatePath("/branches"); revalidatePath(`/branches/${branchId}`);
    revalidatePath("/products"); revalidatePath("/cart"); revalidatePath("/dashboard");
    return { status: "success", message: "Budget updated." };
  } catch (error) {
    const message = error instanceof BranchBudgetError && error.code === "INVALID"
      ? "Enter a valid positive MYR amount with up to two decimal places."
      : "Budget could not be added. Check available company funds and try again.";
    return { status: "error", message };
  }
}

export type DeleteBranchActionState = { status: "idle" | "success" | "error"; message: string };

export async function setBranchActiveAction(
  _state: DeleteBranchActionState,
  formData: FormData,
): Promise<DeleteBranchActionState> {
  const branchId = z.uuid().safeParse(String(formData.get("branchId") ?? ""));
  const active = String(formData.get("active")) === "true";
  if (!branchId.success) return { status: "error", message: "BRANCH_UNAVAILABLE" };
  try {
    const actor = await requirePermission("manage_branches");
    await setMasterActive("branches", branchId.data, active, actor);
    revalidatePath("/branches"); revalidatePath(`/branches/${branchId.data}`); revalidatePath("/dashboard");
    return { status: "success", message: "BRANCH_UPDATED" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return { status: "error", message: reason.includes("active delivery") ? "ACTIVE_DELIVERY"
      : reason.includes("active cart") ? "ACTIVE_CART"
        : reason.includes("active request") ? "ACTIVE_REQUEST" : "BRANCH_UNAVAILABLE" };
  }
}

export async function deleteBranchAction(
  _state: DeleteBranchActionState,
  formData: FormData,
): Promise<DeleteBranchActionState> {
  const branchId = z.uuid().safeParse(String(formData.get("branchId") ?? ""));
  if (!branchId.success) return { status: "error", message: "BRANCH_UNAVAILABLE" };
  try {
    const actor = await requirePermission("manage_branches");
    await deleteEmptyBranch(branchId.data, actor);
    revalidatePath("/branches");
    revalidatePath("/dashboard");
    return { status: "success", message: "BRANCH_DELETED" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error && error.message.includes("Used branches can only be deactivated")
        ? "BRANCH_USED" : "BRANCH_UNAVAILABLE",
    };
  }
}
