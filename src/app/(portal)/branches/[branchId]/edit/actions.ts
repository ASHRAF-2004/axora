"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth";
import { BranchDetailsError, updateBranchDetails } from "@/lib/branch-details";
import { branchDetailsMessages } from "@/lib/branch-details-i18n";
import { requiredPhoneNumberSchema } from "@/lib/phone-number";
import { readFormText } from "@/lib/validation";

export type BranchDetailsActionState = {
  status: "idle" | "success" | "error";
  message: string;
  submissionId: string;
  branchId?: string;
};

const formSchema = z.strictObject({
  branchId: z.union([z.uuid(), z.string().regex(/^br-[a-z0-9-]{3,80}$/)]),
  name: z.string().trim().min(2).max(300),
  city: z.string().trim().min(2).max(300),
  contactName: z.string().trim().min(2).max(300),
  contactPhone: requiredPhoneNumberSchema,
  contactEmail: z.union([z.literal(""), z.email().max(320)]),
  notes: z.string().trim().max(1_000).optional(),
  commandId: z.uuid(),
});

export async function updateBranchDetailsAction(
  _state: BranchDetailsActionState,
  formData: FormData,
): Promise<BranchDetailsActionState> {
  const actor = await requirePermission("manage_branches");
  const copy = branchDetailsMessages(actor.preferredLocale ?? "en");
  const submissionId = crypto.randomUUID();
  const parsed = formSchema.safeParse({
    branchId: readFormText(formData, "branchId"),
    name: readFormText(formData, "name"),
    city: readFormText(formData, "city"),
    contactName: readFormText(formData, "contactName"),
    contactPhone: readFormText(formData, "contactPhone"),
    contactEmail: readFormText(formData, "contactEmail"),
    notes: readFormText(formData, "notes") || undefined,
    commandId: readFormText(formData, "commandId"),
  });
  if (!parsed.success) {
    return { status: "error", message: copy.invalid, submissionId };
  }
  try {
    const branchId = await updateBranchDetails(actor, parsed.data);
    revalidatePath("/branches");
    revalidatePath(`/branches/${branchId}`);
    revalidatePath(`/branches/${branchId}/edit`);
    return { status: "success", message: copy.saved, submissionId, branchId };
  } catch (error) {
    const message = error instanceof BranchDetailsError && error.code === "DUPLICATE"
      ? copy.duplicate
      : copy.unavailable;
    return { status: "error", message, submissionId };
  }
}
