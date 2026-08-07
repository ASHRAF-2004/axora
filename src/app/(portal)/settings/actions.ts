"use server";

import { requirePermission, requireRecentStepUp } from "@/lib/auth";
import { updateAuthorizedCompanyPricingConfiguration } from "@/lib/company-settings-isolation";
import {
  companyPricingSchema,
  readFormText,
} from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function numberValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === null || value === "" ? 0 : value;
}

export async function updateCompanyPricingAction(
  formData: FormData,
) {
  const actor = await requirePermission("manage_commercial_pricing");
  await requireRecentStepUp(actor, "/settings");

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
