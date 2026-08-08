"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { decideRequestApproval } from "@/lib/request-approval";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function decideRequestApprovalAction(formData: FormData) {
  const actor = await requireSession();
  const requestId = field(formData, "requestId");
  const revision = Number(field(formData, "approvalRevision"));
  const rawAction = field(formData, "decision").toUpperCase();
  const action = rawAction === "APPROVE" || rawAction === "REJECT"
    || rawAction === "RETURN" || rawAction === "CANCEL" ? rawAction : null;
  const reason = field(formData, "reason");
  const option = field(formData, "optionCode").toUpperCase();
  const optionCode = option === "ONE_TIME_EXCEPTION" || option === "TRANSFER_RESERVE"
    || option === "TEMPORARY_PERIOD_INCREASE" ? option : undefined;

  if (!requestId || !Number.isInteger(revision) || revision<1 || !action || reason.length<3) {
    redirect("/approvals?error=invalid");
  }
  try {
    await decideRequestApproval({
      actor,
      requestId,
      expectedApprovalRevision: revision,
      action,
      optionCode,
      sourceBudgetAccountId: field(formData, "sourceBudgetAccountId") || undefined,
      reason,
      idempotencyKey: `${requestId}:${revision}:${action}`,
    });
  } catch {
    redirect("/approvals?error=decision");
  }
  revalidatePath("/approvals");
  revalidatePath("/budgets");
  revalidatePath(`/requests/${requestId}`);
  redirect("/approvals?success=decision");
}
