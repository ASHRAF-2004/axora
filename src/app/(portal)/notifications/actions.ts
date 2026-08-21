"use server";

import { requireSession } from "@/lib/auth";
import {
  archiveMyNotification,
  markAllMyNotificationsRead,
  markMyNotificationRead,
  saveMyNotificationPreference,
} from "@/lib/notification-repository";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const uuid = z.uuid();
const statusFilter = z.enum(["ALL", "UNREAD", "READ", "ARCHIVED"]);
const categoryFilter = z.enum([
  "ALL", "ACCOUNT", "LEAD", "APPROVAL", "BUDGET",
  "DELIVERY", "FINANCE", "EMAIL", "WORKFLOW",
]);
const notificationCommandSchema = z.object({
  commandId: uuid,
  notificationId: uuid,
  stateVersion: z.coerce.number().int().positive().optional(),
});
const preferenceSchema = z.object({
  commandId: uuid,
  scope: z.enum(["USER", "COMPANY"]),
  companyId: uuid.optional(),
  eventKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
  emailEnabled: z.boolean(),
  deliverySchedule: z.enum(["IMMEDIATE", "DAILY", "WEEKLY"]),
  reminderHours: z.coerce.number().int().min(0).max(720),
}).refine((value) => value.scope === "USER" || Boolean(value.companyId));

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function finish(formData: FormData, notice: "saved" | "denied"): never {
  const params = new URLSearchParams({ notice });
  const status = statusFilter.safeParse(text(formData, "returnStatus"));
  const category = categoryFilter.safeParse(text(formData, "returnCategory"));
  if (status.success) params.set("status", status.data);
  if (category.success) params.set("category", category.data);
  revalidatePath("/notifications");
  redirect(`/notifications?${params.toString()}`);
}

export async function markNotificationReadAction(formData: FormData) {
  const actor = await requireSession();
  const parsed = notificationCommandSchema.safeParse({
    commandId: text(formData, "commandId"),
    notificationId: text(formData, "notificationId"),
    stateVersion: text(formData, "stateVersion") || undefined,
  });
  if (!parsed.success) finish(formData, "denied");
  try {
    await markMyNotificationRead(
      actor,
      parsed.data.notificationId,
      parsed.data.commandId,
      parsed.data.stateVersion,
    );
  } catch {
    finish(formData, "denied");
  }
  finish(formData, "saved");
}

export async function markAllNotificationsReadAction(formData: FormData) {
  const actor = await requireSession();
  const commandId = uuid.safeParse(text(formData, "commandId"));
  if (!commandId.success) finish(formData, "denied");
  try {
    await markAllMyNotificationsRead(actor, commandId.data);
  } catch {
    finish(formData, "denied");
  }
  finish(formData, "saved");
}

export async function archiveNotificationAction(formData: FormData) {
  const actor = await requireSession();
  const parsed = notificationCommandSchema.safeParse({
    commandId: text(formData, "commandId"),
    notificationId: text(formData, "notificationId"),
  });
  if (!parsed.success) finish(formData, "denied");
  try {
    await archiveMyNotification(
      actor,
      parsed.data.notificationId,
      parsed.data.commandId,
    );
  } catch {
    finish(formData, "denied");
  }
  finish(formData, "saved");
}

export async function saveNotificationPreferenceAction(formData: FormData) {
  const actor = await requireSession();
  const parsed = preferenceSchema.safeParse({
    commandId: text(formData, "commandId"),
    scope: text(formData, "scope"),
    companyId: text(formData, "companyId") || undefined,
    eventKey: text(formData, "eventKey"),
    emailEnabled: formData.get("emailEnabled") === "on"
      || formData.get("emailEnabled") === "true",
    deliverySchedule: text(formData, "deliverySchedule"),
    reminderHours: text(formData, "reminderHours") || "0",
  });
  if (!parsed.success) finish(formData, "denied");
  try {
    await saveMyNotificationPreference(actor, parsed.data);
  } catch {
    finish(formData, "denied");
  }
  finish(formData, "saved");
}
