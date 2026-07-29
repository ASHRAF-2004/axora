"use server";

import { requirePermission } from "@/lib/auth";
import { createUser, setUserActive } from "@/lib/users";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const userSchema = z.object({ email: z.email(), displayName: z.string().trim().min(2).max(200),
  role: z.enum(["ADMIN", "BRANCH_ADMIN", "APPROVER", "REQUESTER", "FINANCE", "VIEWER", "IT_SUPPORT"]),
  password: z.string().min(14).max(200), companyId: z.uuid().optional(), branchId: z.uuid().optional() });

export async function createUserAction(formData: FormData) {
  const actor = await requirePermission("manage_users");
  const input = userSchema.parse({ email: readFormText(formData, "email"), displayName: readFormText(formData, "displayName"),
    role: readFormText(formData, "role"), password: String(formData.get("password") ?? ""),
    companyId: readFormText(formData, "companyId") || undefined, branchId: readFormText(formData, "branchId") || undefined });
  await createUser(input, actor);
  revalidatePath("/users");
  redirect("/users?notice=user-created");
}

export async function setUserActiveAction(id: string, active: boolean) {
  const actor = await requirePermission("manage_users");
  await setUserActive(id, active, actor);
  revalidatePath("/users");
}
