"use server";

import { requirePermission } from "@/lib/auth";
import { updateAuthorizedCompanyPricingConfiguration } from "@/lib/company-settings-isolation";
import {
  companyPricingSchema,
  readFormText,
} from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateProfileImagePolicy } from "@/lib/profile-images";
import { z } from "zod";

function numberValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === null || value === "" ? 0 : value;
}

export async function updateCompanyPricingAction(
  formData: FormData,
) {
  const actor = await requirePermission("manage_commercial_pricing");

  const input = companyPricingSchema.parse({
    companyId: readFormText(formData, "companyId"),
    taxRate: numberValue(formData, "taxRate"),
    estimatedDeliveryFee: numberValue(
      formData,
      "estimatedDeliveryFee",
    ),
  });

  await updateAuthorizedCompanyPricingConfiguration(
    input.companyId,
    {
      taxRate: input.taxRate,
      estimatedDeliveryFee: input.estimatedDeliveryFee,
    },
    actor,
  );

  revalidatePath("/settings");
  revalidatePath("/requests/new");
  revalidatePath("/products");

  redirect("/settings?notice=pricing-updated");
}

export async function updateProfileImagePolicyAction(formData: FormData) {
  const actor = await requirePermission("manage_settings");
  const scope = z.enum(["global", "company"]).parse(readFormText(formData, "scope"));
  const companyId = readFormText(formData, "companyId");
  if (scope === "company") {
    await updateProfileImagePolicy({
      companyId: z.uuid().parse(companyId),
      companyPhotoDisplayEnabled: formData.get("companyPhotoDisplayEnabled") === "on",
    }, actor);
  } else {
    await updateProfileImagePolicy({
      deliveryAgentPhotoRequired: formData.get("deliveryAgentPhotoRequired") === "on",
    }, actor);
  }
  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/receiving");
  redirect("/settings?notice=profile-image-policy-updated");
}
