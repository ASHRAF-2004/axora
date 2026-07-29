"use server";

import { requirePermission } from "@/lib/auth";
import { createInvoice, createQuotation, recordApproval, recordDelivery, recordPayment, saveAttachment, selectQuotation } from "@/lib/operations";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const optionalDate = z.union([z.iso.date(), z.literal("")]).transform((value) => value || undefined);
const optionalPositive = z.union([z.coerce.number().positive(), z.literal("")]).optional().transform((value) => value === "" ? undefined : value);

const quotationSchema = z.object({
  requestLineId: z.string().trim().min(1), supplierId: z.string().trim().min(1), quotationReference: z.string().trim().min(1).max(100),
  quotationDate: z.iso.date(), unitPrice: z.coerce.number().min(0), deliveryCharge: z.coerce.number().min(0),
  minimumOrderQuantity: optionalPositive, leadTimeDays: z.union([z.coerce.number().int().min(0), z.literal("")]).optional().transform((value) => value === "" ? undefined : value), validUntil: optionalDate,
});

export async function createQuotationAction(formData: FormData) {
  const user = await requirePermission("manage_sourcing");
  const input = quotationSchema.parse(Object.fromEntries(formData));
  await createQuotation(input, user);
  revalidatePath("/sourcing"); revalidatePath("/requests");
}

export async function selectQuotationAction(id: string, formData: FormData) {
  const user = await requirePermission("manage_sourcing");
  await selectQuotation(id, readFormText(formData, "reason"), user);
  revalidatePath("/sourcing"); revalidatePath("/requests"); revalidatePath("/dashboard");
}

const approvalSchema = z.object({
  requestId: z.string().trim().min(1),
  status: z.enum(["Approved", "Rejected"]),
  reason: z.string().trim().max(1000).optional().transform((value) => value || undefined),
}).superRefine((value, context) => {
  if (value.status === "Rejected" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Enter a reason before rejecting this purchase request.",
    });
  }
});

export type ApprovalActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: "reason" | "form";
  submissionId: number;
};

const publicApprovalErrors = new Set([
  "A rejection reason is required.",
  "Choose Approve or Reject.",
  "Only an assigned company approver can decide this request.",
  "Request not found.",
  "This branch is inactive and cannot approve new spending.",
  "This request is not pending approval for your branch.",
  "You cannot approve your own purchase request.",
  "This purchase request already has a final company decision.",
  "This request exceeds the branch's available monthly budget.",
]);

export async function recordApprovalAction(
  _previousState: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const submissionId = Date.now();

  try {
    const input = approvalSchema.parse(Object.fromEntries(formData));
    const user = await requirePermission("approve_requests");

    await recordApproval(
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
          ? "Purchase request approved."
          : "Purchase request rejected.",
      submissionId,
    };
  } catch (error) {
    console.error("Approval decision failed", error);

    if (error instanceof z.ZodError) {
      const issue = error.issues[0];

      return {
        status: "error",
        message:
          issue?.message ??
          "Check the approval information and try again.",
        field: issue?.path[0] === "reason" ? "reason" : "form",
        submissionId,
      };
    }

    const message =
      error instanceof Error && publicApprovalErrors.has(error.message)
        ? error.message
        : "The decision could not be saved. Please try again. If the problem continues, contact an administrator.";

    return {
      status: "error",
      message,
      field:
        message.toLowerCase().includes("reason") ? "reason" : "form",
      submissionId,
    };
  }
}

const deliverySchema = z.object({ requestLineId: z.string().trim().min(1), expectedDate: optionalDate, revisedDate: optionalDate, actualDate: optionalDate,
  status: z.enum(["Not Scheduled", "Scheduled", "Preparing", "Out for Delivery", "Partially Delivered", "Delivered", "Delayed", "Failed", "Cancelled"]),
  quantityReceived: z.coerce.number().min(0), receivedBy: z.string().trim().max(200).optional().transform((value) => value || undefined),
  issueReason: z.string().trim().max(1000).optional().transform((value) => value || undefined) });

export async function recordDeliveryAction(formData: FormData) {
  const user = await requirePermission("manage_deliveries");
  await recordDelivery(deliverySchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/deliveries"); revalidatePath("/requests"); revalidatePath("/dashboard");
}

const invoiceSchema = z.object({ direction: z.enum(["CUSTOMER", "SUPPLIER"]), requestId: z.string().trim().min(1),
  supplierId: z.string().trim().optional().transform((value) => value || undefined), invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.iso.date(), dueDate: optionalDate, amount: z.coerce.number().positive(), status: z.literal("Issued") });

export async function createInvoiceAction(formData: FormData) {
  const user = await requirePermission("manage_finance");
  await createInvoice(invoiceSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/finance"); revalidatePath("/dashboard"); revalidatePath("/reports");
}

const paymentSchema = z.object({ invoiceId: z.string().trim().min(1), paymentDate: z.iso.date(), amount: z.coerce.number().positive(),
  method: z.literal(COD_PAYMENT_METHOD), reference: z.string().trim().min(1, "Receipt reference is required.").max(200) });

export async function recordPaymentAction(formData: FormData) {
  const user = await requirePermission("manage_finance");
  await recordPayment(paymentSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/finance"); revalidatePath("/dashboard");
}

export async function uploadAttachmentAction(formData: FormData) {
  const user = await requirePermission("manage_documents");
  const entityType = z.enum(["request", "invoice", "delivery"]).parse(readFormText(formData, "entityType"));
  const recordId = z.string().trim().min(1).parse(readFormText(formData, "recordId"));
  const visibility = z.enum(["CUSTOMER", "INTERNAL"]).parse(readFormText(formData, "visibility") || "CUSTOMER");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a file to upload.");
  await saveAttachment({ entityType, recordId, file, visibility }, user);
  revalidatePath("/documents"); revalidatePath("/audit");
}
