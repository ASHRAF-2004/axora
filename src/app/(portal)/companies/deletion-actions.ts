"use server";

import { requirePermission } from "@/lib/auth";
import { deleteOrArchiveCompany, getCompanyDeletionImpact } from "@/lib/company-deletion";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export async function deleteOrArchiveCompanyAction(companyId: string, formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const input = z.object({ companyId: z.uuid(), commandId: z.uuid(), confirmed: z.literal("confirmed"), reason: z.literal("COMPANY_REMOVED") }).parse({ companyId, commandId: formData.get("commandId"), confirmed: formData.get("confirmed"), reason: "COMPANY_REMOVED" });
  const impact = await getCompanyDeletionImpact(actor, input.companyId);
  await deleteOrArchiveCompany(actor, { ...input, confirmation: impact.confirmation });
  revalidatePath("/companies");
  revalidatePath("/dashboard");
  redirect(`/companies?deletionCommand=${encodeURIComponent(input.commandId)}`);
}
