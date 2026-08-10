"use server";

import { requireSession } from "./auth";
import { manageSupplierPurchaseOrder, requestGeneratedDocumentVersion } from "./generated-documents";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function regenerateGeneratedDocumentAction(formData: FormData) {
  const actor = await requireSession();
  await requestGeneratedDocumentVersion(actor, {
    documentId: text(formData, "documentId"),
    expectedVersion: text(formData, "expectedVersion"),
    operation: text(formData, "operation"),
    reason: text(formData, "reason"),
    commandId: text(formData, "commandId"),
  });
  revalidatePath("/documents");
  redirect("/documents?notice=queued");
}

export async function manageSupplierPurchaseOrderAction(formData: FormData) {
  const actor = await requireSession();
  await manageSupplierPurchaseOrder(actor, {
    documentId: text(formData, "documentId"),
    expectedVersion: text(formData, "expectedVersion"),
    operation: text(formData, "operation"),
    recipientUserId: text(formData, "recipientUserId"),
    reason: text(formData, "reason"),
    commandId: text(formData, "commandId"),
  });
  revalidatePath("/documents");
  redirect("/documents?notice=po-updated");
}
