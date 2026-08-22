"use server";

import { requirePermission } from "@/lib/auth";
import { getDriverDetailWorkspace, releaseStuckDeliveryJob } from "@/lib/driver-operations";
import { requestPasswordReset } from "@/lib/security-notifications";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export async function requestDriverPasswordResetAction(driverId: string) {
  const actor = await requirePermission("manage_deliveries");
  const targetId = z.uuid().parse(driverId);
  const driver = await getDriverDetailWorkspace(actor, targetId);
  if (!driver?.active) redirect(`/deliveries/drivers/${targetId}?notice=reset-unavailable`);
  await requestPasswordReset(driver.email, `internal-driver-reset:${actor.id}`, actor.preferredLocale ?? "en");
  revalidatePath(`/deliveries/drivers/${targetId}`);
  redirect(`/deliveries/drivers/${targetId}?notice=reset-requested`);
}

export async function releaseStuckDeliveryJobAction(jobId: string, formData: FormData) {
  const actor = await requirePermission("manage_deliveries");
  const input = z.object({
    jobId: z.uuid(),
    driverId: z.uuid(),
    commandId: z.uuid(),
    reason: z.literal("DELIVERY_ASSIGNMENT_RELEASED"),
  }).parse({
    jobId,
    driverId: formData.get("driverId"),
    commandId: formData.get("commandId"),
    reason: "DELIVERY_ASSIGNMENT_RELEASED",
  });
  await releaseStuckDeliveryJob(actor, input.jobId, input.commandId, input.reason);
  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/drivers/${input.driverId}`);
  redirect(`/deliveries/drivers/${input.driverId}?notice=job-released`);
}
