"use server";

import { requirePermission, requireRecentStepUp } from "@/lib/auth";
import {
  createScopedInvoice,
  createScopedQuotation,
  issueScopedSupplierRfq,
  recordScopedApproval,
  recordScopedDelivery,
  recordScopedPayment,
  selectScopedQuotation,
} from "@/lib/scoped-operations";
import {
  createAuthorizedAttachment,
  documentRecordIdSchema,
} from "@/lib/document-isolation";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { evaluateCustomerMatch, overrideCustomerMatch } from "@/lib/customer-matching";
import { redirect } from "next/navigation";
import { actionFeedback, publicApprovalErrorCode, type ActionFeedbackCode } from "@/lib/action-feedback-i18n";
import { requestLocaleDecision } from "@/lib/locale-server";

const optionalDate = z.union([z.iso.date(), z.literal("")]).transform((value) => value || undefined);
const optionalPositive = z.union([z.coerce.number().positive(), z.literal("")]).optional().transform((value) => value === "" ? undefined : value);

const quotationSchema = z.object({
  requestLineId: z.string().uuid(), supplierId: z.string().uuid(), quotationReference: z.string().trim().min(1).max(100),
  quotationDate: z.iso.date(), unitPrice: z.coerce.number().min(0), deliveryCharge: z.coerce.number().min(0),
  minimumOrderQuantity: optionalPositive, leadTimeDays: z.union([z.coerce.number().int().min(0), z.literal("")]).optional().transform((value) => value === "" ? undefined : value), validUntil: optionalDate,
});

const supplierRfqSchema = z.object({
  requestLineId: z.string().uuid(),
  supplierId: z.string().uuid(),
  reference: z.string().trim().min(3).max(80),
  respondBy: z.string().trim().min(1),
  specification: z.string().trim().max(2000).optional().transform((value) => value || undefined),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function issueSupplierRfqAction(formData: FormData) {
  const user = await requirePermission("manage_sourcing");
  await requireRecentStepUp(user, "/sourcing");
  const input = supplierRfqSchema.parse(Object.fromEntries(formData));
  const respondBy = new Date(input.respondBy);
  if (Number.isNaN(respondBy.getTime())) throw new Error("RFQ response deadline is invalid.");
  await issueScopedSupplierRfq({ ...input, respondBy: respondBy.toISOString() }, user);
  revalidatePath("/sourcing");
  revalidatePath("/requests");
  revalidatePath("/audit");
  redirect("/sourcing?notice=rfq-issued");
}

export async function createQuotationAction(formData: FormData) {
  const user = await requirePermission("manage_sourcing");
  await requireRecentStepUp(user, "/sourcing");
  const input = quotationSchema.parse(Object.fromEntries(formData));
  await createScopedQuotation(input, user);
  revalidatePath("/sourcing"); revalidatePath("/requests");
}

export async function selectQuotationAction(id: string, formData: FormData) {
  const user = await requirePermission("manage_sourcing");
  await requireRecentStepUp(user, "/sourcing");
  await selectScopedQuotation(z.string().uuid().parse(id), readFormText(formData, "reason"), user);
  revalidatePath("/sourcing"); revalidatePath("/requests"); revalidatePath("/dashboard");
}

const approvalSchema = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["Approved", "Rejected"]),
  reason: z.string().trim().max(1000).optional().transform((value) => value || undefined),
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
    await requireRecentStepUp(user, "/approvals");
    locale = user.preferredLocale ?? locale;
    const input = approvalSchema.parse(Object.fromEntries(formData));

    await recordScopedApproval(
      { ...input, approvalType: "Company approval" },
      user,
    );

    revalidatePath("/approvals");
    revalidatePath("/requests");
    revalidatePath("/dashboard");
    revalidatePath("/audit");

    return {
      status: "success",
      message:
        input.status === "Approved"
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

    const publicCode = error instanceof Error ? publicApprovalErrorCode(error.message) : undefined;
    const message = actionFeedback(publicCode ?? "approval.decision_failed", locale);

    return {
      status: "error",
      message,
      field: publicCode === "approval.reason_required" ? "reason" : "form",
      submissionId,
    };
  }
}

const deliverySchema = z.object({ requestLineId: z.string().uuid(), expectedDate: optionalDate, revisedDate: optionalDate, actualDate: optionalDate,
  status: z.enum(["Not Scheduled", "Scheduled", "Preparing", "Out for Delivery", "Delayed", "Failed", "Cancelled"]),
  quantityReceived: z.coerce.number().min(0), receivedBy: z.string().trim().max(200).optional().transform((value) => value || undefined),
  issueReason: z.string().trim().max(1000).optional().transform((value) => value || undefined) });

export async function recordDeliveryAction(formData: FormData) {
  const user = await requirePermission("manage_deliveries");
  await requireRecentStepUp(user, "/deliveries");
  await recordScopedDelivery(deliverySchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/deliveries"); revalidatePath("/requests"); revalidatePath("/dashboard");
}

const invoiceSchema = z.object({ direction: z.enum(["CUSTOMER", "SUPPLIER"]), requestId: z.string().uuid(),
  supplierId: z.string().uuid().optional(), invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.iso.date(), dueDate: optionalDate, amount: z.coerce.number().positive(), status: z.literal("Issued") });

export async function createInvoiceAction(formData: FormData) {
  const user = await requirePermission("manage_finance");
  await requireRecentStepUp(user, "/finance");
  await createScopedInvoice(invoiceSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/finance"); revalidatePath("/dashboard"); revalidatePath("/reports");
}

const paymentSchema = z.object({ invoiceId: z.string().uuid(), paymentDate: z.iso.date(), amount: z.coerce.number().positive(),
  method: z.literal(COD_PAYMENT_METHOD), reference: z.string().trim().min(1, "Receipt reference is required.").max(200) });

export async function recordPaymentAction(formData: FormData) {
  const user = await requirePermission("manage_finance");
  await requireRecentStepUp(user, "/finance");
  await recordScopedPayment(paymentSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/finance"); revalidatePath("/dashboard");
}

export async function evaluateCustomerMatchAction(formData: FormData) {
  const user = await requirePermission("review_three_way_matches");
  await requireRecentStepUp(user, "/finance");
  try {
    await evaluateCustomerMatch(user, {
      requestLineId: readFormText(formData, "requestLineId"),
      customerInvoiceId: readFormText(formData, "customerInvoiceId"),
      invoicedQuantity: Number(readFormText(formData, "invoicedQuantity")),
      invoicedUnitPrice: Number(readFormText(formData, "invoicedUnitPrice")),
      idempotencyKey: readFormText(formData, "idempotencyKey"),
    });
  } catch {
    redirect("/finance?match=evaluation-failed");
  }
  revalidatePath("/finance");
  redirect("/finance?match=evaluated");
}

export async function overrideCustomerMatchAction(formData: FormData) {
  const user = await requirePermission("review_three_way_matches");
  await requireRecentStepUp(user, "/finance");
  try {
    await overrideCustomerMatch(
      user,
      readFormText(formData, "matchId"),
      readFormText(formData, "reason"),
    );
  } catch {
    redirect("/finance?match=override-failed");
  }
  revalidatePath("/finance");
  redirect("/finance?match=overridden");
}

export async function uploadAttachmentAction(formData: FormData) {
  const user = await requirePermission("manage_documents");
  await requireRecentStepUp(user, "/documents");
  const entityType = z.enum(["request", "invoice", "delivery"]).parse(readFormText(formData, "entityType"));
  const recordId = documentRecordIdSchema.parse(readFormText(formData, "recordId"));
  const visibility = z.enum(["CUSTOMER", "INTERNAL"]).parse(readFormText(formData, "visibility") || "CUSTOMER");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size < 1) redirect("/documents?notice=document-file-required");
  await createAuthorizedAttachment(user, { entityType, recordId, file, visibility });
  revalidatePath("/documents"); revalidatePath("/audit");
}
