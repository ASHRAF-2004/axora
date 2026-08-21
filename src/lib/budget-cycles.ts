import { isDemoMode, query, withAuditTransaction } from "./db";
import type { MoneyDecimalString } from "./money-decimal";

type Actor = {
  id: string;
  roleAssignmentId?: string;
};

export type BudgetCycleSchedule = {
  id: string;
  version: number;
  frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM" | "MANUAL";
  intervalCount: number;
  customIntervalDays?: number;
  timezone: string;
  anchorLocal: string;
  dstResolution: "EARLIER" | "LATER";
  fixedAllocation: string;
  rolloverMode: "RESET_FIXED" | "FULL" | "NONE" | "PARTIAL_PERCENT" | "CUSTOM_AMOUNT";
  rolloverPercentage?: number;
  customRolloverAmount?: number;
  lowThresholdPercentage: number;
  criticalThresholdPercentage: number;
  hysteresisPercentage: number;
  effectiveAt: string;
};

export type BudgetCycleWorkspace = {
  capturedAt: string;
  accounts: Array<{
    id: string;
    companyId: string;
    name: string;
    code: string;
    currency: string;
    levelType: string;
    canRequest: boolean;
    canApprove: boolean;
    canRefresh: boolean;
    schedule: BudgetCycleSchedule;
    nextRefreshAt: string;
    periods: Array<{
      id: string;
      name: string;
      startsAt: string;
      endsAt: string;
      status: string;
      scheduleVersion: number;
      allocated: string;
      available: string;
      reserved: string;
      spent: string;
    }>;
  }>;
  changeRequests: Array<{
    id: string;
    budgetAccountId: string;
    accountName: string;
    state: string;
    requestedBy: string;
    requestedById: string;
    reason: string;
    config: Record<string, unknown>;
    effectiveAt: string;
    createdAt: string;
    canDecide: boolean;
  }>;
  jobs: Array<{
    id: string;
    budgetAccountId: string;
    accountName: string;
    state: string;
    dueAt: string;
    nextAttemptAt: string;
    attemptCount: number;
    maxAttempts: number;
    lastErrorCode?: string;
    manualRerunCount: number;
    canRerun: boolean;
  }>;
  alerts: Array<{
    id: string;
    budgetAccountId: string;
    accountName: string;
    thresholdCode: string;
    active: boolean;
    lastAvailable: string;
    lastPercentage?: number;
    notificationCount: number;
    lastNotifiedAt?: string;
  }>;
  variancePolicies: Array<{
    id: string;
    companyId: string;
    companyName: string;
    version: number;
    toleranceMode: "NONE" | "FIXED" | "PERCENTAGE" | "LOWER_ONLY";
    fixedTolerance?: number;
    percentageTolerance?: number;
    effectiveAt: string;
    canRequest: boolean;
  }>;
  variancePolicyChanges: Array<{
    id: string;
    companyId: string;
    companyName: string;
    state: string;
    requestedBy: string;
    requestedById: string;
    policy: Record<string, unknown>;
    effectiveAt: string;
    reason: string;
    createdAt: string;
    canDecide: boolean;
  }>;
  adjustmentRequests: Array<{
    id: string;
    budgetAccountId: string;
    accountName: string;
    state: string;
    adjustmentType: string;
    amount: string;
    sourceBudgetAccountId?: string;
    requestedBy: string;
    requestedById: string;
    reason: string;
    createdAt: string;
    canDecide: boolean;
  }>;
};

export type BudgetCycleConfig = {
  frequency: BudgetCycleSchedule["frequency"];
  intervalCount: number;
  customIntervalDays?: number;
  timezone: string;
  anchorLocal: string;
  effectiveLocal?: string;
  dstResolution: BudgetCycleSchedule["dstResolution"];
  fixedAllocation: MoneyDecimalString;
  rolloverMode: BudgetCycleSchedule["rolloverMode"];
  rolloverPercentage?: number;
  customRolloverAmount?: MoneyDecimalString;
  lowThresholdPercentage: number;
  criticalThresholdPercentage: number;
  hysteresisPercentage: number;
};

function assignmentId(actor: Actor) {
  if (!actor.roleAssignmentId) {
    throw new Error("The active role assignment is unavailable.");
  }
  return actor.roleAssignmentId;
}

export async function getBudgetCycleWorkspace(actor: Actor) {
  if (isDemoMode()) {
    return {
      capturedAt: new Date().toISOString(),
      accounts: [],
      changeRequests: [],
      jobs: [],
      alerts: [],
      variancePolicies: [],
      variancePolicyChanges: [],
      adjustmentRequests: [],
    } satisfies BudgetCycleWorkspace;
  }
  const result = await query<{ payload: BudgetCycleWorkspace | null }>(
    "SELECT public.axora_budget_cycle_workspace($1,$2,now()) AS payload",
    [actor.id, assignmentId(actor)],
  );
  return result.rows[0]?.payload ?? null;
}

export async function requestBudgetCycleChange(input: {
  actor: Actor;
  budgetAccountId: string;
  config: BudgetCycleConfig;
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_request_budget_cycle_change($1,$2,$3,$4::jsonb,$5,$6,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.budgetAccountId,
        JSON.stringify(input.config),
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function decideBudgetCycleChange(input: {
  actor: Actor;
  changeRequestId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_decide_budget_cycle_change($1,$2,$3,$4,$5,$6,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.changeRequestId,
        input.decision,
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function requestVariancePolicyChange(input: {
  actor: Actor;
  companyId: string;
  policy: {
    toleranceMode: "NONE" | "FIXED" | "PERCENTAGE" | "LOWER_ONLY";
    fixedTolerance?: number;
    percentageTolerance?: number;
    effectiveAt?: string;
  };
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_request_variance_policy_change($1,$2,$3,$4::jsonb,$5,$6,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.companyId,
        JSON.stringify(input.policy),
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function decideVariancePolicyChange(input: {
  actor: Actor;
  changeRequestId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_decide_variance_policy_change($1,$2,$3,$4,$5,$6,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.changeRequestId,
        input.decision,
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function requestBudgetAdjustment(input: {
  actor: Actor;
  budgetAccountId: string;
  adjustment: {
    adjustmentType: "ONE_TIME" | "TEMPORARY" | "PERMANENT" | "TRANSFER";
    amount: MoneyDecimalString;
    sourceBudgetAccountId?: string;
    effectiveUntil?: string;
  };
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_request_budget_adjustment($1,$2,$3,$4::jsonb,$5,$6,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.budgetAccountId,
        JSON.stringify(input.adjustment),
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function decideBudgetAdjustment(input: {
  actor: Actor;
  adjustmentRequestId: string;
  decision: "APPROVE" | "REJECT" | "RETURN";
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_decide_budget_adjustment($1,$2,$3,$4,$5,$6,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.adjustmentRequestId,
        input.decision,
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}

export async function rerunBudgetRefreshJob(input: {
  actor: Actor;
  jobId: string;
  reason: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction({ actor: input.actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT public.axora_rerun_budget_refresh_job($1,$2,$3,$4,$5,now()) AS payload",
      [
        input.actor.id,
        assignmentId(input.actor),
        input.jobId,
        input.reason,
        input.idempotencyKey,
      ],
    );
    return result.rows[0]?.payload;
  });
}
