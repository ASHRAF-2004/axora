"use server";

import {
  createAuthorizedRequest,
  updateAuthorizedRequestStatus,
} from "@/lib/request-writer";
import { requirePermission } from "@/lib/auth";
import { REQUEST_STATUSES } from "@/lib/domain";
import { readFormText, requestSchema } from "@/lib/validation";
import type { RequestStatus } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { completePayment } from "@/lib/payment-checkout";

const requestSubmissionKeySchema = z.string().uuid();

export async function createRequestAction(formData: FormData) {
  const user = await requirePermission("create_requests");
  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity");
  const specifications = formData.getAll("specification").map(String);
  const lines = productIds
    .map((productId, index) => ({
      productId,
      quantity: quantities[index],
      specification: specifications[index] || undefined,
    }))
    .filter((line) => line.productId);
  const input = requestSchema.parse({
    companyId: readFormText(formData, "companyId"),
    branchId: readFormText(formData, "branchId"),
    requestType: readFormText(formData, "requestType"),
    department: readFormText(formData, "department"),
    neededByDate: readFormText(formData, "neededByDate"),
    urgency: readFormText(formData, "urgency"),
    notes: readFormText(formData, "notes"),
    lines,
  });
  const submissionKey = requestSubmissionKeySchema.parse(
    readFormText(formData, "submissionKey"),
  );
  const id = await createAuthorizedRequest(input, user, submissionKey);
  revalidatePath("/dashboard");
  revalidatePath("/requests");
  redirect(`/requests/${id}?notice=request-submitted`);
}

export async function updateStatusAction(id: string, formData: FormData) {
  const user = await requirePermission("manage_deliveries");
  const status = String(formData.get("status")) as RequestStatus;
  if (!REQUEST_STATUSES.includes(status)) {
    redirect(`/requests/${id}?notice=request-status-invalid`);
  }
  await updateAuthorizedRequestStatus(
    id,
    status,
    readFormText(formData, "reason"),
    user,
  );
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function payRequestAction(id: string, formData: FormData) {
  const actor = await requirePermission("create_requests");
  const idempotencyKey = requestSubmissionKeySchema.parse(
    readFormText(formData, "idempotencyKey"),
  );
  await completePayment(actor, z.string().uuid().parse(id), idempotencyKey);
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  redirect(`/requests/${id}?notice=payment-completed`);
}
