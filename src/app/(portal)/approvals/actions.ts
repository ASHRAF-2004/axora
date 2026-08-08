"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { decideRequestApproval } from "@/lib/request-approval";
import { decideRequestActual } from "@/lib/budget-variance";

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

export async function decideRequestActualAction(formData: FormData) {
  const actor = await requireSession();
  const submissionId = field(formData, "submissionId");
  const expectedRevision = Number(field(formData, "approvalRevision"));
  const decision = field(formData, "decision").toUpperCase();
  const fundingOption = field(formData, "fundingOption").toUpperCase();
  const reason = field(formData, "reason");
  if (!submissionId || !Number.isInteger(expectedRevision) || expectedRevision<1
    || !["APPROVE","RETURN","REJECT"].includes(decision)
    || (fundingOption
      && !["APPROVE_ADDITIONAL","TRANSFER_RESERVE","TEMPORARY_INCREASE"].includes(fundingOption))
    || reason.length<3 || reason.length>1000) {
    redirect("/approvals?error=actual-invalid");
  }
  try {
    await decideRequestActual({
      actor,
      submissionId,
      expectedRevision,
      decision: decision as "APPROVE" | "RETURN" | "REJECT",
      fundingOption: fundingOption
        ? fundingOption as "APPROVE_ADDITIONAL" | "TRANSFER_RESERVE" | "TEMPORARY_INCREASE"
        : undefined,
      sourceBudgetAccountId: field(formData, "sourceBudgetAccountId") || undefined,
      reason,
      idempotencyKey: field(formData, "idempotencyKey"),
    });
  } catch {
    redirect("/approvals?error=actual-decision");
  }
  revalidatePath("/approvals");
  revalidatePath("/budgets");
  revalidatePath("/sourcing");
  redirect("/approvals?success=actual-decision");
}
