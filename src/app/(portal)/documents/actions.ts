"use server";

import { requirePermission, requireRecentStepUp } from "@/lib/auth";
import {
  createAuthorizedAttachment,
  documentRecordIdSchema,
} from "@/lib/document-isolation";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const attachmentInputSchema = z.object({
  entityType: z.enum(["request", "invoice", "delivery"]),
  recordId: documentRecordIdSchema,
  visibility: z.enum(["CUSTOMER", "INTERNAL"]),
}).strict();

export async function uploadAttachmentAction(formData: FormData) {
  const actor = await requirePermission("manage_documents");
  await requireRecentStepUp(actor, "/documents");

  const input = attachmentInputSchema.parse({
    entityType: readFormText(formData, "entityType"),
    recordId: readFormText(formData, "recordId"),
    visibility: readFormText(formData, "visibility") || "CUSTOMER",
  });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size < 1) {
    redirect("/documents?notice=document-file-required");
  }

  await createAuthorizedAttachment(actor, { ...input, file });
  revalidatePath("/documents");
  revalidatePath("/audit");
  redirect("/documents?notice=document-uploaded");
}