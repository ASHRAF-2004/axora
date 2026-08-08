import { isDemoMode, query, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";

export type BudgetPeriodSummary = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: string;
  nextRefreshAt: string;
  allocated: string;
  reserved: string;
  spent: string;
  pendingApproval: string;
  available: string;
  rolloverBroughtForward: string;
  expiredAmount: string;
};

export type BudgetAccountSummary = {
  id: string;
  companyId: string;
  parentAccountId?: string;
  levelType: "COMPANY" | "BRANCH" | "DEPARTMENT" | "COST_CENTRE";
  branchId?: string;
  departmentId?: string;
  costCentreId?: string;
  code: string;
  name: string;
  currency: string;
  recurringAllocation: string;
  refreshInterval: string;
  timezone: string;
  rolloverPolicy: string;
  rolloverCap?: string;
  active: boolean;
  canAssign: boolean;
  canIncrease: boolean;
  canReduce: boolean;
  canRefresh: boolean;
  period?: BudgetPeriodSummary;
};

export type BudgetLedgerEntry = {
  id: string;
  accountId: string;
  periodId: string;
  entryType: string;
  amount: string;
  currency: string;
  requestId?: string;
  requestVersion?: number;
  reasonCode: string;
  explanation: string;
  availableBefore: string;
  availableAfter: string;
  reservedBefore: string;
  reservedAfter: string;
  spentBefore: string;
  spentAfter: string;
  pendingBefore: string;
  pendingAfter: string;
  correlationId: string;
  postedAt: string;
};

export type CompanyCeilingSummary = {
  companyId: string;
  companyName: string;
  amount: string;
  currency: string;
  utilized: string;
  canOverride: boolean;
};

export type BudgetWorkspace = {
  capturedAt: string;
  accounts: BudgetAccountSummary[];
  periods: Array<BudgetPeriodSummary & { accountId: string }>;
  entries: BudgetLedgerEntry[];
  ceilings: CompanyCeilingSummary[];
};

export type RequestBudgetChoice = {
  id: string;
  companyId: string;
  levelType: "BRANCH" | "DEPARTMENT" | "COST_CENTRE";
  branchId?: string;
  departmentId?: string;
  costCentreId?: string;
  name: string;
  currency: string;
  periodId: string;
  periodName: string;
  available: string;
  allocated: string;
  nextRefreshAt: string;
  approvalPolicyId: string;
};

export type RequestBudgetChoices = {
  capturedAt: string;
  accounts: RequestBudgetChoice[];
};

type Actor = {
  id: string;
  roleAssignmentId?: string;
  companyId?: string;
  branchId?: string;
  role?: string;
};

function assignmentId(actor: Actor) {
  if (!actor.roleAssignmentId) throw new Error("The active role assignment is unavailable.");
  return actor.roleAssignmentId;
}

export async function getBudgetWorkspace(actor: Actor) {
  if (isDemoMode()) {
    const capturedAt = new Date().toISOString();
    const canManage = ["ADMIN", "COMPANY_ADMIN", "BRANCH_ADMIN"].includes(actor.role ?? "");
    const accounts: BudgetAccountSummary[] = getDemoStore().branches
      .filter((branch) => (!actor.companyId || branch.companyId === actor.companyId)
        && (!actor.branchId || branch.id === actor.branchId))
      .map((branch) => ({
        id: `demo-budget-${branch.id}`,
        companyId: branch.companyId,
        levelType: "BRANCH",
        branchId: branch.id,
        code: branch.branchCode,
        name: `${branch.name} budget`,
        currency: "MYR",
        recurringAllocation: String(branch.monthlyBudget ?? 0),
        refreshInterval: "MONTHLY",
        timezone: "Asia/Kuala_Lumpur",
        rolloverPolicy: "NONE",
        active: branch.status === "Active",
        canAssign: canManage,
        canIncrease: canManage,
        canReduce: canManage,
        canRefresh: canManage,
        period: {
          id: `demo-period-${branch.id}`,
          name: new Date().toISOString().slice(0,7),
          startsAt: capturedAt,
          endsAt: capturedAt,
          status: "ACTIVE",
          nextRefreshAt: capturedAt,
          allocated: String(branch.monthlyBudget ?? 0),
          reserved: String(branch.committedAmount ?? 0),
          spent: "0",
          pendingApproval: "0",
          available: String(branch.remainingAmount ?? branch.monthlyBudget ?? 0),
          rolloverBroughtForward: "0",
          expiredAmount: "0",
        },
      }));
    return { capturedAt, accounts, periods: [], entries: [], ceilings: [] } satisfies BudgetWorkspace;
  }
  const result = await query<{ payload: BudgetWorkspace | null }>(
    "SELECT public.axora_budget_workspace($1,$2,now()) AS payload",
    [actor.id, assignmentId(actor)],
  );
  return result.rows[0]?.payload ?? null;
}

export async function getRequestBudgetChoices(actor: Actor) {
  if (isDemoMode()) {
    const capturedAt = new Date().toISOString();
    return {
      capturedAt,
      accounts: getDemoStore().branches
        .filter((branch) => (!actor.companyId || branch.companyId === actor.companyId)
          && (!actor.branchId || branch.id === actor.branchId))
        .map((branch) => ({
          id: `demo-budget-${branch.id}`,
          companyId: branch.companyId,
          levelType: "BRANCH" as const,
          branchId: branch.id,
          name: `${branch.name} budget`,
          currency: "MYR",
          periodId: `demo-period-${branch.id}`,
          periodName: new Date().toISOString().slice(0,7),
          available: String(branch.remainingAmount ?? branch.monthlyBudget ?? 0),
          allocated: String(branch.monthlyBudget ?? 0),
          nextRefreshAt: capturedAt,
          approvalPolicyId: `demo-policy-${branch.companyId}`,
        })),
    } satisfies RequestBudgetChoices;
  }
  const result = await query<{ payload: RequestBudgetChoices | null }>(
    "SELECT public.axora_request_budget_choices($1,$2,now()) AS payload",
    [actor.id, assignmentId(actor)],
  );
  return result.rows[0]?.payload ?? null;
}

export async function adjustBudgetAllocation(input: {
  actor: Actor;
  accountId: string;
  direction: "INCREASE" | "REDUCE";
  amount: number;
  recurring: boolean;
  explanation: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction(
    { userId: input.actor.id, reason: input.explanation },
    async (client) => {
      const result = await client.query<{ payload: unknown }>(
        `SELECT public.axora_adjust_budget_allocation(
          $1,$2,$3,$4,$5,$6,$7,$8,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.accountId,
          input.direction, input.amount, input.recurring, input.explanation,
          input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}

export async function transferBudgetAllocation(input: {
  actor: Actor;
  sourceAccountId: string;
  targetAccountId: string;
  amount: number;
  recurring: boolean;
  explanation: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction(
    { userId: input.actor.id, reason: input.explanation },
    async (client) => {
      const result = await client.query<{ payload: unknown }>(
        `SELECT public.axora_transfer_budget_allocation(
          $1,$2,$3,$4,$5,$6,$7,$8,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.sourceAccountId,
          input.targetAccountId, input.amount, input.recurring,
          input.explanation, input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}

export async function setBudgetAllocation(input: {
  actor: Actor;
  accountId: string;
  amount: number;
  explanation: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction(
    { userId: input.actor.id, reason: input.explanation },
    async (client) => {
      const result = await client.query<{ payload: unknown }>(
        `SELECT public.axora_set_budget_allocation(
          $1,$2,$3,$4,$5,$6,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.accountId,
          input.amount, input.explanation, input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}

export async function setCompanyCeiling(input: {
  actor: Actor;
  companyId: string;
  amount: number;
  currency: string;
  explanation: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction(
    { userId: input.actor.id, reason: input.explanation },
    async (client) => {
      const result = await client.query<{ payload: unknown }>(
        `SELECT public.axora_set_company_ceiling(
          $1,$2,$3,$4,$5,$6,$7,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.companyId,
          input.amount, input.currency, input.explanation, input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}

export async function refreshBudgetPeriod(input: {
  actor: Actor;
  accountId: string;
  explanation: string;
  idempotencyKey: string;
}) {
  return withAuditTransaction(
    { userId: input.actor.id, reason: input.explanation },
    async (client) => {
      const result = await client.query<{ payload: unknown }>(
        `SELECT public.axora_refresh_budget_period(
          $1,$2,$3,$4,$5,now()
        ) AS payload`,
        [input.actor.id, assignmentId(input.actor), input.accountId,
          input.explanation, input.idempotencyKey],
      );
      return result.rows[0]?.payload;
    },
  );
}
