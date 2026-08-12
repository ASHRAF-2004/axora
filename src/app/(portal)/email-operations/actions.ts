"use server";

import { requirePermission, requireRecentStepUp } from "@/lib/auth";
import {
  EMAIL_PROVIDER_AGENTS,
  executeEmailOperationsCommand,
  type EmailDeliveryKind,
  type EmailOperationsCommandAction,
  type EmailProviderAgent,
} from "@/lib/email-operations";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const commandSchema = z.object({
  commandId: z.uuid(),
  action: z.enum([
    "RETRY", "CANCEL", "RESEND", "SUPPRESS", "UNSUPPRESS",
    "PAUSE_AGENT", "RESUME_AGENT", "RECONCILE", "RECORD_PROVIDER_HEALTH",
  ]),
  deliveryKind: z.enum(["ACCOUNT_SETUP", "TRANSACTIONAL", "WORKFLOW"]).optional(),
  deliveryId: z.uuid().optional(),
  providerAgent: z.enum(EMAIL_PROVIDER_AGENTS).optional(),
  reason: z.string().trim().min(10).max(1_000),
});

const revealSchema = z.object({
  commandId: z.uuid(),
  deliveryKind: z.enum(["ACCOUNT_SETUP", "TRANSACTIONAL", "WORKFLOW"]),
  deliveryId: z.uuid(),
  reason: z.string().trim().min(10).max(1_000),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return textValue(formData, key) || undefined;
}

function commandDetails(formData: FormData, action: EmailOperationsCommandAction) {
  if (action === "SUPPRESS" || action === "UNSUPPRESS") {
    return {
      targetType: textValue(formData, "targetType") || "ADDRESS",
      correctionResolved: formData.get("correctionResolved") === "true",
    };
  }
  if (action === "RECONCILE" || action === "RECORD_PROVIDER_HEALTH") {
    return {
      providerName: textValue(formData, "providerName") || "resend",
      source: textValue(formData, "source") || "MANUAL",
      remainingRecipientUnits: optionalText(formData, "remainingRecipientUnits"),
      allowanceRenewsAt: optionalText(formData, "allowanceRenewsAt"),
      creditExpiresAt: optionalText(formData, "creditExpiresAt"),
      accountState: textValue(formData, "accountState") || "UNKNOWN",
      domainName: optionalText(formData, "domainName"),
      domainState: textValue(formData, "domainState") || "UNKNOWN",
      configurationState: textValue(formData, "configurationState") || "UNKNOWN",
      note: optionalText(formData, "note"),
    };
  }
  return {};
}

export async function performEmailOperationAction(formData: FormData) {
  const actor = await requirePermission("manage_email_operations");
  await requireRecentStepUp(actor, "/email-operations");
  const parsed = commandSchema.safeParse({
    commandId: textValue(formData, "commandId"),
    action: textValue(formData, "action"),
    deliveryKind: optionalText(formData, "deliveryKind"),
    deliveryId: optionalText(formData, "deliveryId"),
    providerAgent: optionalText(formData, "providerAgent"),
    reason: textValue(formData, "reason"),
  });
  if (!parsed.success) redirect("/email-operations?notice=denied");
  let notice = "success";
  try {
    const result = await executeEmailOperationsCommand(actor, {
      ...parsed.data,
      deliveryKind: parsed.data.deliveryKind as EmailDeliveryKind | undefined,
      providerAgent: parsed.data.providerAgent as EmailProviderAgent | undefined,
      action: parsed.data.action as EmailOperationsCommandAction,
      details: commandDetails(formData, parsed.data.action),
    });
    if (result.changed === false) notice = "noop";
    revalidatePath("/email-operations");
  } catch {
    notice = "denied";
  }
  redirect(`/email-operations?notice=${notice}`);
}

export interface RecipientRevealState {
  status: "idle" | "revealed" | "invalid" | "unavailable";
  recipient?: string;
}

export async function revealEmailRecipientAction(
  _previous: RecipientRevealState,
  formData: FormData,
): Promise<RecipientRevealState> {
  const actor = await requirePermission("manage_email_operations");
  await requireRecentStepUp(actor, "/email-operations");
  const parsed = revealSchema.safeParse({
    commandId: textValue(formData, "commandId"),
    deliveryKind: textValue(formData, "deliveryKind"),
    deliveryId: textValue(formData, "deliveryId"),
    reason: textValue(formData, "reason"),
  });
  if (!parsed.success) return { status: "invalid" };
  try {
    const result = await executeEmailOperationsCommand(actor, {
      ...parsed.data,
      action: "REVEAL",
    });
    return typeof result.recipient === "string"
      ? { status: "revealed", recipient: result.recipient }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
