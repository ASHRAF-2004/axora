"use server";

import { createRequest, updateRequestStatus } from "@/lib/repository";
import { requireRole } from "@/lib/auth";
import { REQUEST_STATUSES } from "@/lib/domain";
import { readFormText, requestSchema } from "@/lib/validation";
import type { RequestStatus } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createRequestAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity");
  const specifications = formData.getAll("specification").map(String);
  const lines = productIds.map((productId, index) => ({ productId, quantity: quantities[index], specification: specifications[index] || undefined })).filter((line) => line.productId);
  const input = requestSchema.parse({
    companyId: readFormText(formData, "companyId"), branchId: readFormText(formData, "branchId"), requestType: readFormText(formData, "requestType"),
    department: readFormText(formData, "department"), requestedBy: readFormText(formData, "requestedBy"), requesterContact: readFormText(formData, "requesterContact"),
    neededByDate: readFormText(formData, "neededByDate"), urgency: readFormText(formData, "urgency"), notes: readFormText(formData, "notes"), lines,
  });
  const id = await createRequest(input, user);
  revalidatePath("/dashboard"); revalidatePath("/requests"); redirect(`/requests/${id}`);
}

export async function updateStatusAction(id: string, formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  const status = String(formData.get("status")) as RequestStatus;
  if (!REQUEST_STATUSES.includes(status)) throw new Error("Invalid request status.");
  await updateRequestStatus(id, status, readFormText(formData, "reason"), user);
  revalidatePath(`/requests/${id}`); revalidatePath("/requests"); revalidatePath("/dashboard");
}
