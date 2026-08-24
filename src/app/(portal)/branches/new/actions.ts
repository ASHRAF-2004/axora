"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePermission } from "@/lib/auth";
import { BranchCreationError, createBranchWithLocation } from "@/lib/branch-creation";
import { readFormText } from "@/lib/validation";

export type BranchCreateState = { status: "idle" | "error" | "success"; message: string; branchId?: string; submissionId: string };

const coordinate = z.coerce.number().finite();
const formSchema = z.object({
  companyId: z.string().uuid(), name: z.string().trim().min(2).max(300),
  branchCode: z.string().trim().min(2).max(50), city: z.string().trim().min(2).max(300),
  addressLabel: z.string().trim().min(3).max(5_000), latitude: coordinate.min(-90).max(90), longitude: coordinate.min(-180).max(180),
  providerId: z.string().trim().min(2).max(100), providerPlaceId: z.string().trim().max(500).optional(),
  providerAttribution: z.string().trim().max(1_000).optional(), contactName: z.string().trim().min(2).max(300),
  contactPhone: z.string().trim().min(5).max(120), contactEmail: z.union([z.literal(""), z.email().max(320)]),
  deliveryInstructions: z.string().trim().max(5_000).optional(), notes: z.string().trim().max(1_000).optional(), commandId: z.string().uuid(),
});

export async function createBranchWithLocationAction(_state: BranchCreateState, formData: FormData): Promise<BranchCreateState> {
  const actor = await requirePermission("manage_branches");
  const submissionId = crypto.randomUUID();
  const submittedCompanyId = readFormText(formData, "companyId");
  if (actor.accountKind === "COMPANY" && submittedCompanyId !== actor.companyId) {
    return { status: "error", message: "This company context is no longer available. Reload the page.", submissionId };
  }
  const parsed = formSchema.safeParse({
    companyId: actor.accountKind === "COMPANY" ? actor.companyId : submittedCompanyId,
    name: readFormText(formData, "name"), branchCode: readFormText(formData, "branchCode"), city: readFormText(formData, "city"),
    addressLabel: readFormText(formData, "addressLabel"), latitude: readFormText(formData, "latitude"), longitude: readFormText(formData, "longitude"),
    providerId: readFormText(formData, "providerId"), providerPlaceId: readFormText(formData, "providerPlaceId") || undefined,
    providerAttribution: readFormText(formData, "providerAttribution") || undefined, contactName: readFormText(formData, "contactName"),
    contactPhone: readFormText(formData, "contactPhone"), contactEmail: readFormText(formData, "contactEmail"),
    deliveryInstructions: readFormText(formData, "deliveryInstructions") || undefined, notes: readFormText(formData, "notes") || undefined,
    commandId: readFormText(formData, "commandId"),
  });
  if (!parsed.success) return { status: "error", message: "Check the marked branch and delivery details, then try again.", submissionId };
  try {
    const branchId = await createBranchWithLocation(actor, parsed.data);
    revalidatePath("/branches"); revalidatePath("/dashboard");
    return { status: "success", message: "Branch and delivery location created.", branchId, submissionId };
  } catch (error) {
    const message = error instanceof BranchCreationError && error.code === "DUPLICATE"
      ? "A branch with this name or code already exists in the company."
      : "The branch could not be created. Review the details and try again.";
    return { status: "error", message, submissionId };
  }
}
