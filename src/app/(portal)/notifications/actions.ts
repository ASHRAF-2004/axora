"use server";

import { requireSession } from "@/lib/auth";
import {
  markAllMyNotificationsRead,
  markMyNotificationRead,
  saveMyNotificationPreference,
} from "@/lib/notification-repository";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function markNotificationReadAction(id: string) {
  const actor = await requireSession();
  await markMyNotificationRead(actor, id);
  revalidatePath("/notifications");
  redirect("/notifications?notice=read");
}

export async function markAllNotificationsReadAction() {
  const actor = await requireSession();
  await markAllMyNotificationsRead(actor);
  revalidatePath("/notifications");
  redirect("/notifications?notice=all-read");
}

export async function saveNotificationPreferenceAction(formData: FormData) {
  const actor = await requireSession();
  await saveMyNotificationPreference(actor, {
    eventKey: String(formData.get("eventKey") ?? ""),
    inAppEnabled: formData.get("inAppEnabled") === "on",
    emailEnabled: formData.get("emailEnabled") === "on",
    digestMode: String(formData.get("digestMode") ?? "IMMEDIATE") as "IMMEDIATE" | "DAILY" | "WEEKLY",
  });
  revalidatePath("/notifications");
  redirect("/notifications?notice=preference-saved");
}
