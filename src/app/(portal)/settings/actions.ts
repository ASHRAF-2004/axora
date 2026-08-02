"use server";

import { requirePermission } from "@/lib/auth";
import { updateCompanyPricingConfiguration } from "@/lib/repository";
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

  const input = companyPricingSchema.parse({
    companyId: readFormText(formData, "companyId"),
    taxRate: numberValue(formData, "taxRate"),
    estimatedDeliveryFee: numberValue(
      formData,
      "estimatedDeliveryFee",
    ),
  });

  await updateCompanyPricingConfiguration(
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
