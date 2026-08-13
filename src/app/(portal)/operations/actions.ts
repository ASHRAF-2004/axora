"use server";

import {
  actionFeedback,
  publicApprovalErrorCode,
  type ActionFeedbackCode,
} from "@/lib/action-feedback-i18n";
import { requirePermission } from "@/lib/auth";
import { requestLocaleDecision } from "@/lib/locale-server";
import { recordScopedApproval } from "@/lib/scoped-operations";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const approvalSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["Approved", "Rejected"]),
  reason: z.string().trim().max(1000).optional()
    .transform((value) => value || undefined),
}).superRefine((value, context) => {
  if (value.status === "Rejected" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "approval.reason_required",
    });
  }
});

export type ApprovalActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: "reason" | "form";
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
    await recordScopedApproval({ ...input, approvalType: "Company approval" }, user);
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
      const issue = error.issues[0];
      return {
        status: "error",
        message: actionFeedback(
          issue?.message === "approval.reason_required"
            ? issue.message as ActionFeedbackCode
            : "approval.check_information",
          locale,
        ),
        field: issue?.path[0] === "reason" ? "reason" : "form",
        submissionId,
      };
    }
    const publicCode = error instanceof Error
      ? publicApprovalErrorCode(error.message)
      : undefined;
    return {
      status: "error",
      message: actionFeedback(publicCode ?? "approval.decision_failed", locale),
      field: publicCode === "approval.reason_required" ? "reason" : "form",
      submissionId,
    };
  }
}
