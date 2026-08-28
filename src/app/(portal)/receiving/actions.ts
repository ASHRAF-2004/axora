"use server";

import { requirePermission } from "@/lib/auth";
import { parseReceiptConfirmationForm } from "@/lib/receiving-form";
import { confirmReceipt } from "@/lib/role-portals-repository";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function confirmReceiptAction(formData: FormData) {
  const actor = await requirePermission("confirm_receipts");
  await confirmReceipt(actor, parseReceiptConfirmationForm(formData));
  const requestId = String(formData.get("requestId") ?? "");
  revalidatePath("/requests");
  if (/^[0-9a-f-]{36}$/i.test(requestId)) {
    revalidatePath(`/requests/${requestId}`);
    redirect(`/requests/${requestId}?notice=receipt-confirmed`);
  }
  redirect("/requests?notice=receipt-confirmed");
}
