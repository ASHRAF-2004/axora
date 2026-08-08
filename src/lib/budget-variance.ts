import { isDemoMode, query, withAuditTransaction } from "./db";

type Actor = {
  id: string;
  roleAssignmentId?: string;
};

type ActualLine = {
  requestLineId: string;
  actualProductId: string;
  supplierId: string;
  quantity: number;
  actualBuyUnitPrice: number;
  taxRate: number;
  deliveryCharge: number;
  otherCharge: number;
  substituteReason?: string;
  notes?: string;
};

export type ProcurementActualWorkspace = {
  capturedAt: string;
  canAssign: boolean;
  eligibleUsers: Array<{
    userId: string;
    roleAssignmentId: string;
    name: string;
  }>;
  products: Array<{ id: string; name: string; code: string }>;
  suppliers: Array<{ id: string; name: string; code: string }>;
  requests: Array<{
    id: string;
    requestNumber: string;
    requestVersion: number;
    companyName: string;
    branchName: string;
    currency: string;
    estimateAmount: string;
    reservationRemaining: string;
    assignment?: {
      id: string;
      assignedUserId: string;
      assignedUserName: string;
      status: string;
    };
    canSubmit: boolean;
    lines: Array<{
      id: string;
      productId: string;
      productName: string;
      quantity: number;
      unitOfMeasure: string;
      estimatedUnitPrice: string;
      selectedSupplierId?: string;
    }>;
    actualHistory: Array<{
      id: string;
      purchaseMode: string;
      state: string;
      submissionAmount: string;
      cumulativeActualAmount: string;
      differenceAmount: string;
      withinTolerance: boolean;
      substitutePresent: boolean;
      receiptAttachmentId: string;
      submittedAt: string;
    }>;
  }>;
};

export type ProcurementVarianceApprovalWorkspace = {
  capturedAt: string;
  submissions: Array<{
    id: string;
    requestId: string;
    requestNumber: string;
    companyName: string;
    branchName: string;
    currency: string;
    state: "PENDING_COMPANY" | "PENDING_AXORA";
    approvalRevision: number;
    estimateAmount: string;
    previousActualAmount: string;
    submissionAmount: string;
    cumulativeActualAmount: string;
    differenceAmount: string;
    withinTolerance: boolean;
    substitutePresent: boolean;
    receiptProvided: boolean;
    notes: string;
    submittedBy: string;
    submittedAt: string;
    lines: Array<{
      id: string;
      estimatedProductName: string;
      actualProductName: string;
      quantity: number;
      unitOfMeasure: string;
      customerUnitPrice: string;
      taxAmount: string;
      deliveryCharge: string;
      otherCharge: string;
      lineTotal: string;
      substituteReason?: string;
    }>;
    sourceAccounts: Array<{ id: string; name: string; available: string }>;
  }>;
};

function assignmentId(actor: Actor) {
  if (!actor.roleAssignmentId) {
    throw new Error("The active role assignment is unavailable.");
  }
  return actor.roleAssignmentId;
}

export async function getProcurementActualWorkspace(actor: Actor) {
  if (isDemoMode()) {
    return {
      capturedAt: new Date().toISOString(),
      canAssign: false,
      eligibleUsers: [],
      products: [],
      suppliers: [],
      requests: [],
    } satisfies ProcurementActualWorkspace;
  }
  const result = await query<{ payload: ProcurementActualWorkspace | null }>(
    "SELECT public.axora_procurement_actual_workspace($1,$2,now()) AS payload",
    [actor.id, assignmentId(actor)],
  );
  return result.rows[0]?.payload ?? null;
}

export async function getProcurementVarianceApprovalWorkspace(actor: Actor) {
  if (isDemoMode()) {
    return {
      capturedAt: new Date().toISOString(),
      submissions: [],
    } satisfies ProcurementVarianceApprovalWorkspace;
  }
  const result = await query<{
    payload: ProcurementVarianceApprovalWorkspace | null;
  }>(
    "SELECT public.axora_procurement_variance_approval_workspace($1,$2,now()) AS payload",
    [actor.id, assignmentId(actor)],
  );
  return result.rows[0]?.payload ?? null;
}

export async function assignFulfilmentPurchase(input: {
  actor: Actor;
  requestId: string;
  assignedUserId: string;
  assignedRoleAssignmentId: string;
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_assign_fulfilment_purchase($1,$2,$3,$4,$5,$6,$7,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.requestId,
        input.assignedUserId,
        input.assignedRoleAssignmentId,
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function submitRequestActual(input: {
  actor: Actor;
  requestId: string;
  purchaseMode: "PARTIAL" | "FINAL" | "REFUND";
  receiptAttachmentId: string;
  notes: string;
  lines: ActualLine[];
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.notes }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_submit_request_actual($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.requestId,
        input.purchaseMode,
        input.receiptAttachmentId,
        input.notes,
        JSON.stringify(input.lines),
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function decideRequestActual(input: {
  actor: Actor;
  submissionId: string;
  expectedRevision: number;
  decision: "APPROVE" | "RETURN" | "REJECT";
  fundingOption?: "APPROVE_ADDITIONAL" | "TRANSFER_RESERVE" | "TEMPORARY_INCREASE";
  sourceBudgetAccountId?: string;
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_decide_request_actual($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.submissionId,
        input.expectedRevision,
        input.decision,
        input.fundingOption ?? null,
        input.sourceBudgetAccountId ?? null,
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}
