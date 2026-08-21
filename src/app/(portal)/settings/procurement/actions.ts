"use server";

import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/auth";
import { setCategoryPolicy } from "@/lib/category-policy";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

export async function updateCategoryPolicyAction(formData: FormData) {
  const actor = await requirePermission("manage_category_policy");
  const input = z.object({
    scopeType: z.enum(["COMPANY", "BRANCH", "DEPARTMENT"]),
    companyId: z.string().uuid(), branchId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(), expectedVersion: z.coerce.number().int().min(0),
    reason: z.string().trim().min(3).max(1_000), commandId: z.string().uuid(),
  }).safeParse({
    scopeType: formData.get("scopeType"), companyId: formData.get("companyId"),
    branchId: formData.get("branchId") || undefined,
    departmentId: formData.get("departmentId") || undefined,
    expectedVersion: formData.get("expectedVersion"), reason: formData.get("reason"),
    commandId: formData.get("commandId") || randomUUID(),
  });
  if (!input.success) redirect("/settings/procurement?notice=failed");
  let notice = "saved";
  try {
    await setCategoryPolicy(actor, {
      ...input.data, enabled: formData.get("enabled") === "on",
      allowedCategories: formData.getAll("allowedCategory").map(String),
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code) : "";
    notice = code === "P8203" ? "stale"
      : code === "P8210" ? "parent"
        : code === "42501" ? "denied" : "failed";
  }
  revalidatePath("/settings/procurement");
  revalidatePath("/products");
  redirect(`/settings/procurement?notice=${notice}`);
}
