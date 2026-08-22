"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireSession } from "@/lib/auth";
import { decideRequestApproval } from "@/lib/request-approval";
import { decideRequestActual } from "@/lib/budget-variance";
import { approveAndPay } from "@/lib/company-wallet";
import { isApproveAndPayLocalNotReadyState } from "@/lib/finance-business-results";
import { z } from "zod";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function decideRequestApprovalAction(formData: FormData) {
  const actor = await requirePermission("approve_requests");
  const requestId = field(formData, "requestId");
  const revision = Number(field(formData, "approvalRevision"));
  const rawAction = field(formData, "decision").toUpperCase();
  const action = rawAction === "APPROVE" || rawAction === "APPROVE_AND_PAY"
    || rawAction === "REJECT"
    || rawAction === "RETURN" || rawAction === "CANCEL" ? rawAction : null;
  const reason = `REQUEST_${rawAction || "DECISION"}`;
  const rawOption = field(formData, "optionCode").toUpperCase();
  const optionCode = rawOption === "ONE_TIME_EXCEPTION"
    || rawOption === "TRANSFER_RESERVE"
    || rawOption === "TEMPORARY_PERIOD_INCREASE" ? rawOption : undefined;
  if (!requestId || !Number.isInteger(revision) || revision<1 || !action) {
    redirect("/approvals?error=invalid");
  }
  if (action === "APPROVE_AND_PAY") {
    const commandId = z.string().uuid().safeParse(field(formData, "commandId"));
    if (!commandId.success) redirect("/approvals?error=invalid");
    let result: Awaited<ReturnType<typeof approveAndPay>>;
    try {
      result = await approveAndPay(actor, {
        requestId,
        expectedApprovalRevision: revision,
        reason,
        commandId: commandId.data,
      });
    } catch {
      redirect("/approvals?error=decision");
    }
    revalidatePath("/approvals");
    revalidatePath("/budgets");
    revalidatePath("/wallet");
    revalidatePath(`/requests/${requestId}`);
    const feedback = new URLSearchParams({ result: result.status });
    if (result.status === "NOT_READY"
      && isApproveAndPayLocalNotReadyState(result.requestState)) {
      feedback.set("state", result.requestState);
    }
    redirect(`/approvals?${feedback.toString()}`);
  }
  try {
    await decideRequestApproval({
      actor,
      requestId,
      expectedApprovalRevision: revision,
      action: action as "APPROVE" | "REJECT" | "RETURN" | "CANCEL",
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
  const reason = `REQUEST_ACTUAL_${decision || "DECISION"}`;
  if (!submissionId || !Number.isInteger(expectedRevision) || expectedRevision<1
    || !["APPROVE","RETURN","REJECT"].includes(decision)
    || (fundingOption
      && !["APPROVE_ADDITIONAL","TRANSFER_RESERVE","TEMPORARY_INCREASE"].includes(fundingOption))
    ) {
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
  redirect("/approvals?success=actual-decision");
}
