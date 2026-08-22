"use server";

import { requirePermission } from "@/lib/auth";
import {
  EMAIL_DELIVERY_STREAMS,
  executeEmailOperationsCommand,
  type EmailDeliveryKind,
  type EmailDeliveryStream,
  type EmailOperationsCommandAction,
} from "@/lib/email-operations";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const commandSchema = z.object({
  commandId: z.uuid(),
  action: z.literal("RETRY"),
  deliveryKind: z.enum(["ACCOUNT_SETUP", "TRANSACTIONAL", "WORKFLOW"]).optional(),
  deliveryId: z.uuid().optional(),
  providerAgent: z.enum(EMAIL_DELIVERY_STREAMS).optional(),
  reason: z.literal("EMAIL_RETRY_REQUESTED"),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return textValue(formData, key) || undefined;
}

export async function performEmailOperationAction(formData: FormData) {
  const actor = await requirePermission("manage_email_operations");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") redirect("/dashboard");
  const parsed = commandSchema.safeParse({
    commandId: textValue(formData, "commandId"),
    action: textValue(formData, "action"),
    deliveryKind: optionalText(formData, "deliveryKind"),
    deliveryId: optionalText(formData, "deliveryId"),
    providerAgent: optionalText(formData, "providerAgent"),
    reason: "EMAIL_RETRY_REQUESTED",
  });
  if (!parsed.success) redirect("/email-operations?notice=denied");
  let notice = "success";
  try {
    const result = await executeEmailOperationsCommand(actor, {
      ...parsed.data,
      deliveryKind: parsed.data.deliveryKind as EmailDeliveryKind | undefined,
      providerAgent: parsed.data.providerAgent as EmailDeliveryStream | undefined,
      action: parsed.data.action as EmailOperationsCommandAction,
      details: {},
    });
    if (result.changed === false) notice = "noop";
    revalidatePath("/email-operations");
  } catch {
    notice = "denied";
  }
  redirect(`/email-operations?notice=${notice}`);
}
