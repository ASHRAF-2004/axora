"use server";

import { requireRole } from "@/lib/auth";
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
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  const input = quotationSchema.parse(Object.fromEntries(formData));
  await createQuotation(input, user);
  revalidatePath("/sourcing"); revalidatePath("/requests");
}

export async function selectQuotationAction(id: string, formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  await selectQuotation(id, readFormText(formData, "reason"), user);
  revalidatePath("/sourcing"); revalidatePath("/requests"); revalidatePath("/dashboard");
}

const approvalSchema = z.object({ requestId: z.string().trim().min(1), approvalType: z.string().trim().min(1).max(100),
  status: z.enum(["Pending", "Approved", "Rejected"]), reason: z.string().trim().max(1000).optional().transform((value) => value || undefined) });

export async function recordApprovalAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  await recordApproval(approvalSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/approvals"); revalidatePath("/audit");
}

const deliverySchema = z.object({ requestLineId: z.string().trim().min(1), expectedDate: optionalDate, revisedDate: optionalDate, actualDate: optionalDate,
  status: z.enum(["Not Scheduled", "Scheduled", "Preparing", "Out for Delivery", "Partially Delivered", "Delivered", "Delayed", "Failed", "Cancelled"]),
  quantityReceived: z.coerce.number().min(0), receivedBy: z.string().trim().max(200).optional().transform((value) => value || undefined),
  issueReason: z.string().trim().max(1000).optional().transform((value) => value || undefined) });

export async function recordDeliveryAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  await recordDelivery(deliverySchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/deliveries"); revalidatePath("/requests"); revalidatePath("/dashboard");
}

const invoiceSchema = z.object({ direction: z.enum(["CUSTOMER", "SUPPLIER"]), requestId: z.string().trim().min(1),
  supplierId: z.string().trim().optional().transform((value) => value || undefined), invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.iso.date(), dueDate: optionalDate, amount: z.coerce.number().positive(), status: z.enum(["Draft", "Issued", "Disputed", "Cancelled"]) });

export async function createInvoiceAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "FINANCE"]);
  await createInvoice(invoiceSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/finance"); revalidatePath("/dashboard"); revalidatePath("/reports");
}

const paymentSchema = z.object({ invoiceId: z.string().trim().min(1), paymentDate: z.iso.date(), amount: z.coerce.number().positive(),
  method: z.literal(COD_PAYMENT_METHOD), reference: z.string().trim().max(200).optional().transform((value) => value || undefined) });

export async function recordPaymentAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "FINANCE"]);
  await recordPayment(paymentSchema.parse(Object.fromEntries(formData)), user);
  revalidatePath("/finance"); revalidatePath("/dashboard");
}

export async function uploadAttachmentAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS", "FINANCE"]);
  const entityType = z.enum(["request", "invoice", "delivery"]).parse(readFormText(formData, "entityType"));
  const recordId = z.string().trim().min(1).parse(readFormText(formData, "recordId"));
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a file to upload.");
  await saveAttachment({ entityType, recordId, file }, user);
  revalidatePath("/documents"); revalidatePath("/audit");
}
