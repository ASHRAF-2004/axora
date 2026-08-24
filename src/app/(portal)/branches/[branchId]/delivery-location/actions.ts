"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import { saveBranchDeliveryLocation } from "@/lib/branch-delivery-location";
import { readFormText } from "@/lib/validation";

export type BranchDeliveryLocationActionState = {
  status: "idle" | "success" | "error";
  message: string;
  submissionId: string;
  field?: "addressLabel" | "coordinates" | "instructions";
};

const coordinate = z.string().trim()
  .regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)$/)
  .transform((value, context) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      context.addIssue({ code: "custom", message: "Invalid coordinate" });
      return z.NEVER;
    }
    return parsed;
  });

const formSchema = z.strictObject({
  // Demo fixtures use explicit non-production IDs; the production service
  // still accepts UUIDs only and fails closed after this presentation parse.
  branchId: z.union([z.uuid(), z.string().regex(/^br-[a-z0-9-]{3,80}$/)]),
  addressLabel: z.string().trim().min(3).max(5_000),
  latitude: coordinate.pipe(z.number().min(-90).max(90)),
  longitude: coordinate.pipe(z.number().min(-180).max(180)),
  instructions: z.string().trim().max(5_000).optional(),
  providerId: z.string().trim().min(2).max(100),
  providerPlaceId: z.string().trim().max(500).optional(),
  providerAttribution: z.string().trim().max(1_000).optional(),
  commandId: z.uuid(),
});

function actionField(error: z.ZodError): BranchDeliveryLocationActionState["field"] {
  const field = error.issues[0]?.path[0];
  if (field === "latitude" || field === "longitude") return "coordinates";
  if (field === "addressLabel" || field === "instructions") return field;
  return undefined;
}

export async function saveBranchDeliveryLocationAction(
  _state: BranchDeliveryLocationActionState,
  formData: FormData,
): Promise<BranchDeliveryLocationActionState> {
  const actor = await requirePermission("view_branches");
  const copy = branchDeliveryLocationMessages(actor.preferredLocale ?? "en");
  const submissionId = crypto.randomUUID();
  const parsed = formSchema.safeParse({
    branchId: readFormText(formData, "branchId"),
    addressLabel: readFormText(formData, "addressLabel"),
    latitude: readFormText(formData, "latitude"),
    longitude: readFormText(formData, "longitude"),
    instructions: readFormText(formData, "instructions") || undefined,
    providerId: readFormText(formData, "providerId"),
    providerPlaceId: readFormText(formData, "providerPlaceId") || undefined,
    providerAttribution: readFormText(formData, "providerAttribution") || undefined,
    commandId: readFormText(formData, "commandId"),
  });
  if (!parsed.success) {
    const field = actionField(parsed.error);
    return {
      status: "error",
      message: field === "coordinates" ? copy.confirmationRequired : copy.saveError,
      submissionId,
      ...(field ? { field } : {}),
    };
  }
  try {
    await saveBranchDeliveryLocation(actor, {
      branchId: parsed.data.branchId,
      addressLabel: parsed.data.addressLabel,
      coordinates: {
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
      },
      instructions: parsed.data.instructions,
      providerId: parsed.data.providerId,
      providerPlaceId: parsed.data.providerPlaceId,
      providerAttribution: parsed.data.providerAttribution,
      reason: "DELIVERY_LOCATION_UPDATED",
      commandId: parsed.data.commandId,
    });
    revalidatePath(`/branches/${parsed.data.branchId}`);
    revalidatePath(`/branches/${parsed.data.branchId}/delivery-location`);
    revalidatePath("/branches");
    return { status: "success", message: copy.saved, submissionId };
  } catch {
    return { status: "error", message: copy.saveError, submissionId };
  }
}

export const branchDeliveryLocationActionInternals = { actionField, formSchema };
