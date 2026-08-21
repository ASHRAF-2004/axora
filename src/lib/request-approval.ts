import type { PoolClient } from "pg";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";

export type ApprovalQueueItem = {
  id: string;
  requestNumber: string;
  requestVersion: number;
  approvalRevision: number;
  state: "PENDING_DEPARTMENT" | "PENDING_COMPANY" | "PENDING_AXORA";
  companyId: string;
  companyName: string;
  branchId: string;
  budgetAccountId: string;
  branchName: string;
  departmentId?: string;
  departmentName?: string;
  requesterId: string;
  requesterName: string;
  amount: string;
  currency: string;
  approvalLimit?: string;
  available: string;
  exceededBy: string;
  companyCeiling?: string;
  ceilingUtilized?: string;
  submittedAt: string;
  deliveryDate?: string;
  notes?: string;
  lines: Array<Record<string, unknown>>;
  canResolveOverBudget: boolean;
  canOverrideCeiling: boolean;
  canApproveAndPay: boolean;
};

export type ApprovalWorkspace = {
  capturedAt: string;
  requests: ApprovalQueueItem[];
};

export type ApprovalDecisionResult = {
  decisionId: string;
  reservationId?: string;
  requestId: string;
  requestVersion: number;
  approvalRevision: number;
  state: string;
  action: string;
  correlationId: string;
};

export type ApprovalTimeline = {
  requestId: string;
  events: Array<{
    id: string;
    action: string;
    stateBefore: string;
    stateAfter: string;
    amount: string;
    currency: string;
    reason: string;
    actorUserId?: string;
    selfApproval: boolean;
    optionCode?: string;
    correlationId: string;
    decidedAt: string;
  }>;
};

type Actor = {
  id: string;
  roleAssignmentId?: string;
  companyId?: string;
  branchId?: string;
  role?: string;
  accountKind?: string;
};

function assignmentId(actor: Actor) {
  if (!actor.roleAssignmentId) throw new Error("The active role assignment is unavailable.");
  return actor.roleAssignmentId;
}

export async function getApprovalWorkspace(actor: Actor) {
  if (isDemoMode()) {
    if (actor.accountKind !== "COMPANY") {
      const emptyWorkspace: ApprovalWorkspace = {
        capturedAt: new Date().toISOString(),
        requests: [],
      };
      return emptyWorkspace;
    }
    const store = getDemoStore();
    return {
      capturedAt: new Date().toISOString(),
      requests: store.requests
        .filter((request) => request.approvalStatus === "Pending"
          && (!actor.companyId || request.companyId === actor.companyId)
          && (!actor.branchId || request.branchId === actor.branchId)
          && request.createdById !== actor.id)
        .map((request) => {
          const branch = store.branches.find((item) => item.id === request.branchId);
          const available = branch?.remainingAmount ?? branch?.monthlyBudget ?? 0;
          return {
            id: request.id,
            requestNumber: request.orderCode,
            requestVersion: 1,
            approvalRevision: 1,
            state: "PENDING_COMPANY" as const,
            companyId: request.companyId,
            companyName: request.companyName,
            branchId: request.branchId,
            budgetAccountId: `demo-budget-${request.branchId}`,
            branchName: request.branchName,
            departmentName: request.department,
            requesterId: request.createdById ?? "demo-requester",
            requesterName: request.requestedBy,
            amount: String(request.estimatedTotal),
            currency: "MYR",
            approvalLimit: "999999999",
            available: String(available),
            exceededBy: String(Math.max(request.estimatedTotal-available,0)),
            submittedAt: request.requestDate,
            deliveryDate: request.neededByDate,
            notes: request.notes,
            lines: request.lines as unknown as Array<Record<string, unknown>>,
            canResolveOverBudget: ["ADMIN", "COMPANY_ADMIN"].includes(actor.role ?? ""),
            canOverrideCeiling: false,
            canApproveAndPay: request.estimatedTotal <= available,
          };
        }),
    } satisfies ApprovalWorkspace;
  }
  const result = await query<{ payload: ApprovalWorkspace | null }>(
    "SELECT public.axora_request_approval_workspace_v2($1,$2,now()) AS payload",
    [actor.id, assignmentId(actor)],
  );
  return result.rows[0]?.payload ?? null;
}

export async function initializeRequestApproval(
  client: PoolClient,
  input: { actor: Actor; requestId: string; idempotencyKey: string },
) {
  const result = await client.query<{ payload: ApprovalDecisionResult }>(
    "SELECT public.axora_initialize_request_approval($1,$2,$3,$4,now()) AS payload",
    [input.actor.id, assignmentId(input.actor), input.requestId, input.idempotencyKey],
  );
  return result.rows[0]?.payload;
}

export async function decideRequestApproval(input: {
  actor: Actor;
  requestId: string;
  expectedApprovalRevision: number;
  action: "APPROVE" | "REJECT" | "RETURN" | "CANCEL";
  optionCode?: "ONE_TIME_EXCEPTION" | "TRANSFER_RESERVE" | "TEMPORARY_PERIOD_INCREASE";
  sourceBudgetAccountId?: string;
  reason: string;
  idempotencyKey: string;
}) {
  if (isDemoMode()) {
    if (input.actor.accountKind !== "COMPANY") {
      throw new Error("The request is unavailable.");
    }
    const store = getDemoStore();
    const request = store.requests.find((item) => item.id === input.requestId);
    if (!request || request.approvalStatus !== "Pending"
      || (input.actor.companyId && request.companyId !== input.actor.companyId)
      || (input.actor.branchId && request.branchId !== input.actor.branchId)
      || request.createdById === input.actor.id) {
      throw new Error("The request is unavailable.");
    }
    const branch = store.branches.find((item) => item.id === request.branchId);
    if (input.action === "APPROVE") {
      request.approvalStatus = "Approved";
      request.approvedByName = "Demo approver";
      request.approvalReason = input.reason;
      if (branch) {
        branch.committedAmount += request.estimatedTotal;
        branch.remainingAmount = Math.max((branch.monthlyBudget ?? 0)-branch.committedAmount,0);
      }
    } else if (input.action === "REJECT") {
      request.approvalStatus = "Rejected";
      request.approvalReason = input.reason;
      request.status = "Cancelled";
    } else if (input.action === "RETURN") {
      request.approvalReason = input.reason;
    } else {
      request.status = "Cancelled";
      request.approvalStatus = "Rejected";
      request.approvalReason = input.reason;
    }
    return {
      decisionId: `demo-decision-${request.id}`,
      requestId: request.id,
      requestVersion: 1,
      approvalRevision: 2,
      state: input.action === "APPROVE" ? "APPROVED"
        : input.action === "RETURN" ? "RETURNED"
          : input.action === "CANCEL" ? "CANCELLED" : "REJECTED",
      action: input.action,
      correlationId: `demo-correlation-${request.id}`,
    } satisfies ApprovalDecisionResult;
  }
  return withAuditTransaction(
    { actor: input.actor, reason: input.reason },
    async (client) => {
      const result = await client.query<{ payload: ApprovalDecisionResult }>(
        `SELECT public.axora_decide_request_approval(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.requestId,
          input.expectedApprovalRevision, input.action, input.optionCode ?? null,
          input.sourceBudgetAccountId ?? null, input.reason, input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}

export async function finalizeRequestBudget(input: {
  actor: Actor;
  requestId: string;
  actualAmount: number;
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction(
    { actor: input.actor, reason: input.reason },
    async (client) => {
      const result = await client.query<{ payload: ApprovalDecisionResult }>(
        `SELECT public.axora_finalize_request_budget(
          $1,$2,$3,$4,$5,$6,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.requestId,
          input.actualAmount, input.reason, input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}

export async function getRequestApprovalTimeline(actor: Actor, requestId: string) {
  if (isDemoMode()) return null;
  const result = await query<{ payload: ApprovalTimeline | null }>(
    "SELECT public.axora_request_approval_timeline($1,$2,$3,now()) AS payload",
    [actor.id, assignmentId(actor), requestId],
  );
  return result.rows[0]?.payload ?? null;
}
