"use server";

import {
  createAuthorizedRequest,
  updateAuthorizedRequestStatus,
} from "@/lib/request-writer";
import { requirePermission, requireSession } from "@/lib/auth";
import { REQUEST_STATUSES } from "@/lib/domain";
import { readFormText, requestSchema } from "@/lib/validation";
import type { RequestStatus } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { approveAndPay } from "@/lib/company-wallet";
import { isApproveAndPayLocalNotReadyState } from "@/lib/finance-business-results";
import { decideRequestApproval } from "@/lib/request-approval";
import { canAccess } from "@/lib/permissions";
import { usesCompanyAdministratorDirectPurchase } from "@/lib/company-admin-direct-purchase";

const requestSubmissionKeySchema = z.string().uuid();
const cartSubmissionSchema = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

export async function createRequestAction(formData: FormData) {
  const user = await requirePermission("create_requests");
  if (usesCompanyAdministratorDirectPurchase(user)) {
    const branchId = readFormText(formData, "branchId");
    redirect(branchId
      ? `/cart?branch=${encodeURIComponent(branchId)}`
      : "/products?notice=shopping-branch-required");
  }
  const parsedInput = requestSchema.safeParse({
    companyId: readFormText(formData, "companyId") || "canonical-cart",
    branchId: readFormText(formData, "branchId") || "canonical-cart",
    requestType: "Standard",
    department: readFormText(formData, "department"),
    neededByDate: readFormText(formData, "neededByDate"),
    urgency: readFormText(formData, "urgency"),
    notes: readFormText(formData, "notes"),
    lines: [{ productId: "canonical-cart", quantity: 1 }],
  });
  if (!parsedInput.success) redirect("/cart?notice=request-invalid");
  const input = parsedInput.data;
  const submissionKey = requestSubmissionKeySchema.safeParse(
    readFormText(formData, "submissionKey"),
  );
  const cart = cartSubmissionSchema.safeParse({
    id: readFormText(formData, "cartId"),
    version: readFormText(formData, "cartVersion"),
  });
  if (!submissionKey.success || !cart.success) {
    redirect("/cart?notice=request-invalid");
  }
  let id: string;
  try {
    id = await createAuthorizedRequest(
      input,
      user,
      submissionKey.data,
      cart.data,
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code) : "";
    const notice = code === "P8202" ? "cart-repriced"
      : code === "P8204" ? "cart-product-unavailable"
        : code === "P8205" ? "cart-empty"
          : code === "P8206" ? "budget-inactive"
            : code === "P8207" ? "budget-insufficient"
              : code === "P8203" ? "cart-stale" : "request-unavailable";
    redirect(`/cart?notice=${notice}`);
  }
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
    `REQUEST_STATUS_UPDATED_${status.toUpperCase().replaceAll(" ", "_")}`,
    user,
  );
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function cancelPurchaseRequestAction(id: string, formData: FormData) {
  const actor = await requireSession();
  if (!canAccess(actor, "create_requests") && !canAccess(actor, "approve_requests")) {
    redirect(`/requests/${id}?cancelNotice=failed`);
  }
  const input = z.object({
    requestId: z.string().trim().min(1).max(160),
    approvalRevision: z.coerce.number().int().positive(),
    commandId: z.string().uuid(),
  }).safeParse({
    requestId: id,
    approvalRevision: readFormText(formData, "approvalRevision"),
    commandId: readFormText(formData, "commandId"),
  });
  if (!input.success) redirect(`/requests/${id}?cancelNotice=failed`);
  try {
    await decideRequestApproval({
      actor,
      requestId: input.data.requestId,
      expectedApprovalRevision: input.data.approvalRevision,
      action: "CANCEL",
      reason: "REQUEST_CANCELLED",
      idempotencyKey: input.data.commandId,
    });
  } catch {
    redirect(`/requests/${id}?cancelNotice=failed`);
  }
  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/budgets");
  redirect(`/requests/${id}?cancelNotice=complete`);
}

export async function approveAndPayRequestAction(id: string, formData: FormData) {
  const actor = await requirePermission("approve_requests");
  const input = z.object({
    requestId: z.string().uuid(),
    approvalRevision: z.coerce.number().int().positive(),
    commandId: z.string().uuid(),
  }).safeParse({
    requestId: id,
    approvalRevision: readFormText(formData, "approvalRevision"),
    commandId: readFormText(formData, "commandId"),
  });
  if (!input.success) redirect(`/requests/${id}?financeError=invalid`);
  let result: Awaited<ReturnType<typeof approveAndPay>>;
  try {
    result = await approveAndPay(actor, {
      requestId: input.data.requestId,
      expectedApprovalRevision: input.data.approvalRevision,
      reason: "REQUEST_APPROVED_AND_PAID",
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
