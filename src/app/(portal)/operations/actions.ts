"use server";

import {
  actionFeedback,
  publicApprovalErrorCode,
} from "@/lib/action-feedback-i18n";
import { requirePermission } from "@/lib/auth";
import { requestLocaleDecision } from "@/lib/locale-server";
import { recordScopedApproval } from "@/lib/scoped-operations";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const approvalSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["Approved", "Rejected"]),
});

export type ApprovalActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: "form";
  submissionId: number;
};

export async function recordApprovalAction(
  _previousState: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const submissionId = Date.now();
  let locale = (await requestLocaleDecision()).locale;
  try {
    const user = await requirePermission("approve_requests");
    locale = user.preferredLocale ?? locale;
    const input = approvalSchema.parse(Object.fromEntries(formData));
    await recordScopedApproval({ ...input, reason: input.status === "Approved" ? "REQUEST_APPROVED" : "REQUEST_REJECTED", approvalType: "Company approval" }, user);
    revalidatePath("/approvals");
    revalidatePath("/requests");
    revalidatePath("/dashboard");
    revalidatePath("/audit");
    return {
      status: "success",
      message: input.status === "Approved"
        ? actionFeedback("approval.approved", locale)
        : actionFeedback("approval.rejected", locale),
      submissionId,
    };
  } catch (error) {
    console.error("Approval decision failed", error);
    if (error instanceof z.ZodError) {
      return {
        status: "error",
        message: actionFeedback("approval.check_information", locale),
        field: "form",
        submissionId,
      };
    }
    const publicCode = error instanceof Error
      ? publicApprovalErrorCode(error.message)
      : undefined;
    return {
      status: "error",
      message: actionFeedback(publicCode ?? "approval.decision_failed", locale),
      field: "form",
      submissionId,
    };
  }
}
