"use server";

import { requirePermission } from "@/lib/auth";
import { parseReceiptConfirmationForm } from "@/lib/receiving-form";
import { confirmReceipt } from "@/lib/role-portals-repository";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function confirmReceiptAction(formData: FormData) {
  const actor = await requirePermission("confirm_receipts");
  await confirmReceipt(actor, parseReceiptConfirmationForm(formData));
  revalidatePath("/receiving");
  redirect("/receiving?notice=receipt-confirmed");
}
