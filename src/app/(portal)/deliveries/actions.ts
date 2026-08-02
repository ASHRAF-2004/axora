"use server";

import { requirePermission } from "@/lib/auth";
import { assignDeliveryDriver, createDeliveryJob } from "@/lib/delivery-admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createDeliveryJobAction(formData: FormData) {
  const actor = await requirePermission("manage_deliveries");
  try {
    await createDeliveryJob(actor, {
      requestId: String(formData.get("requestId") ?? ""),
      windowStart: String(formData.get("windowStart") ?? "") || undefined,
      windowEnd: String(formData.get("windowEnd") ?? "") || undefined,
      instructions: String(formData.get("instructions") ?? "") || undefined,
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
  } catch {
    redirect("/deliveries?delivery=job-failed");
  }
  revalidatePath("/deliveries");
  redirect("/deliveries?delivery=job-created");
}

export async function assignDeliveryDriverAction(formData: FormData) {
  const actor = await requirePermission("manage_deliveries");
  try {
    await assignDeliveryDriver(actor, {
      deliveryJobId: String(formData.get("deliveryJobId") ?? ""),
      driverUserId: String(formData.get("driverUserId") ?? ""),
    });
  } catch {
    redirect("/deliveries?delivery=assignment-failed");
  }
  revalidatePath("/deliveries");
  redirect("/deliveries?delivery=driver-assigned");
}
