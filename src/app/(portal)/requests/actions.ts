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
import { getCatalogProductsByPublicRefs } from "@/lib/catalog";
import { approveAndPay } from "@/lib/company-wallet";
import { isApproveAndPayLocalNotReadyState } from "@/lib/finance-business-results";

const requestSubmissionKeySchema = z.string().uuid();

export async function createRequestAction(formData: FormData) {
  const user = await requirePermission("create_requests");
  const productRefs = formData.getAll("publicRef").map(String);
  const quantities = formData.getAll("quantity");
  const specifications = formData.getAll("specification").map(String);
  const resolvedProducts = await getCatalogProductsByPublicRefs(productRefs, user);
  const productsByRef = new Map(resolvedProducts.map((product) => [product.code, product]));
  const lines = productRefs
    .map((publicRef, index) => ({
      productId: productsByRef.get(publicRef)?.id ?? "",
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

export async function approveAndPayRequestAction(id: string, formData: FormData) {
  const actor = await requirePermission("approve_requests");
  const input = z.object({
    requestId: z.string().uuid(),
    approvalRevision: z.coerce.number().int().positive(),
    reason: z.string().trim().min(3).max(1_000),
    commandId: z.string().uuid(),
  }).safeParse({
    requestId: id,
    approvalRevision: readFormText(formData, "approvalRevision"),
    reason: readFormText(formData, "reason"),
    commandId: readFormText(formData, "commandId"),
  });
  if (!input.success) redirect(`/requests/${id}?financeError=invalid`);
  let result: Awaited<ReturnType<typeof approveAndPay>>;
  try {
    result = await approveAndPay(actor, {
      requestId: input.data.requestId,
      expectedApprovalRevision: input.data.approvalRevision,
      reason: input.data.reason,
      commandId: input.data.commandId,
    });
  } catch {
    redirect(`/requests/${id}?financeError=unavailable`);
  }
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/budgets");
  revalidatePath("/wallet");
  const feedback = new URLSearchParams({ financeResult: result.status });
  if (result.status === "NOT_READY"
    && isApproveAndPayLocalNotReadyState(result.requestState)) {
    feedback.set("financeState", result.requestState);
  }
  redirect(`/requests/${id}?${feedback.toString()}`);
}
