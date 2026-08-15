"use server";

import { requirePermission } from "@/lib/auth";
import { deleteOrArchiveCompany } from "@/lib/company-deletion";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export async function deleteOrArchiveCompanyAction(companyId: string, formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const input = z.object({ companyId: z.uuid(), commandId: z.uuid(), confirmation: z.string().min(8).max(100), reason: z.string().trim().min(3).max(1000) }).parse({ companyId, commandId: formData.get("commandId"), confirmation: formData.get("confirmation"), reason: formData.get("reason") });
  await deleteOrArchiveCompany(actor, input);
  revalidatePath("/companies");
  revalidatePath("/dashboard");
  redirect(`/companies?deletionCommand=${encodeURIComponent(input.commandId)}`);
}
