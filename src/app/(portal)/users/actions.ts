"use server";

import { requireRole } from "@/lib/auth";
import { createUser, setUserActive } from "@/lib/users";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const userSchema = z.object({ email: z.email(), displayName: z.string().trim().min(2).max(200),
  role: z.enum(["ADMIN", "OPERATIONS", "FINANCE", "VIEWER", "IT_SUPPORT"]), password: z.string().min(14).max(200),
  companyId: z.uuid().optional() });

export async function createUserAction(formData: FormData) {
  const actor = await requireRole(["ADMIN"]);
  const input = userSchema.parse({ email: readFormText(formData, "email"), displayName: readFormText(formData, "displayName"),
    role: readFormText(formData, "role"), password: String(formData.get("password") ?? ""),
    companyId: readFormText(formData, "companyId") || undefined });
  await createUser(input, actor);
  revalidatePath("/users");
}

export async function setUserActiveAction(id: string, active: boolean) {
  const actor = await requireRole(["ADMIN"]);
  await setUserActive(id, active, actor);
  revalidatePath("/users");
}
