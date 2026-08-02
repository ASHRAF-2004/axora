"use server";

import { requirePermission } from "@/lib/auth";
import {
  acknowledgeSupplierRfq,
  submitSupplierQuotation,
  uploadSupplierDocument,
} from "@/lib/role-portals-repository";
import { SUPPLIER_AVAILABILITIES, type SupplierAcknowledgement, type SupplierAvailability } from "@/lib/supplier-portal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const ACKNOWLEDGEMENTS = ["ACKNOWLEDGED", "DECLINED", "CLARIFICATION_REQUESTED"] as const;

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function number(formData: FormData, key: string, optional = false) {
  const value = text(formData, key);
  if (!value && optional) return undefined;
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative number.`);
  return parsed;
}

export async function acknowledgeSupplierRfqAction(formData: FormData) {
  const actor = await requirePermission("respond_to_rfqs");
  const acknowledgement = text(formData, "acknowledgement") as SupplierAcknowledgement;
  if (!ACKNOWLEDGEMENTS.includes(acknowledgement)) throw new Error("Select a valid RFQ response.");
  await acknowledgeSupplierRfq(actor, {
    rfqId: text(formData, "rfqId"),
    acknowledgement,
    note: text(formData, "note") || undefined,
    clientEventId: text(formData, "clientEventId") || undefined,
  });
  revalidatePath("/supplier");
  redirect("/supplier?notice=acknowledgement-recorded");
}

export async function submitSupplierQuotationAction(formData: FormData) {
  const actor = await requirePermission("respond_to_rfqs");
  const availability = text(formData, "availability") as SupplierAvailability;
  if (!SUPPLIER_AVAILABILITIES.includes(availability)) throw new Error("Select a valid availability status.");
  await submitSupplierQuotation(actor, {
    rfqId: text(formData, "rfqId"),
    quotationReference: text(formData, "quotationReference"),
    unitPrice: number(formData, "unitPrice") as number,
    deliveryCharge: number(formData, "deliveryCharge") as number,
    minimumOrderQuantity: number(formData, "minimumOrderQuantity", true),
    leadTimeDays: number(formData, "leadTimeDays", true),
    validUntil: text(formData, "validUntil") || undefined,
    availability,
    note: text(formData, "note") || undefined,
    clientEventId: text(formData, "clientEventId") || undefined,
  });
  revalidatePath("/supplier");
  redirect("/supplier?notice=quotation-submitted");
}

export async function uploadSupplierDocumentAction(formData: FormData) {
  const actor = await requirePermission("respond_to_rfqs");
  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a quotation document to upload.");
  const documentKind = text(formData, "documentKind") === "SUPPORTING" ? "SUPPORTING" : "QUOTATION";
  await uploadSupplierDocument(actor, text(formData, "rfqId"), file, documentKind);
  revalidatePath("/supplier");
  redirect(`/supplier?notice=${documentKind === "SUPPORTING" ? "invoice-document-uploaded" : "document-uploaded"}`);
}
