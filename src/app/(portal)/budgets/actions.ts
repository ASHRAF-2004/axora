"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import {
  adjustBudgetAllocation,
  refreshBudgetPeriod,
  setCompanyCeiling,
  transferBudgetAllocation,
} from "@/lib/budget-ledger";
import {
  decideBudgetAdjustment,
  decideBudgetCycleChange,
  decideVariancePolicyChange,
  requestBudgetAdjustment,
  requestBudgetCycleChange,
  requestVariancePolicyChange,
  rerunBudgetRefreshJob,
} from "@/lib/budget-cycles";
import {
  parseMoneyDecimal,
  parsePositiveMoneyDecimal,
} from "@/lib/money-decimal";
import {
  deriveBudgetPeriodScheduleFields,
  type BudgetPeriodFrequency,
} from "@/lib/budget-period-range";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function requireCompanyBudgetActor() {
  const actor = await requireSession();
  if (actor.accountKind !== "COMPANY") {
    throw new Error("Company budget administration is unavailable.");
  }
  return actor;
}

function positiveAmount(formData: FormData) {
  return parsePositiveMoneyDecimal(field(formData, "amount"));
}

function nonNegativeMoney(formData: FormData, name: string) {
  return parseMoneyDecimal(field(formData, name), { allowNegative: false });
}

function optionalMoney(formData: FormData, name: string) {
  const value = field(formData, name);
  return value ? parseMoneyDecimal(value, { allowNegative: false }) : undefined;
}

function reason(formData: FormData) {
  const value = field(formData, "explanation");
  if (value.length<3 || value.length>1000) throw new Error("Invalid explanation");
  return value;
}

function idempotencyKey(formData: FormData) {
  const value = field(formData, "idempotencyKey");
  if (value.length<8 || value.length>180) throw new Error("Invalid command key");
  return value;
}

function optionalNumber(formData: FormData, name: string) {
  const value = field(formData, name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid number");
  return parsed;
}

function boundedNumber(
  formData: FormData,
  name: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(field(formData, name));
  if (!Number.isFinite(parsed) || parsed<minimum || parsed>maximum) {
    throw new Error("Invalid number");
  }
  return parsed;
}

export async function adjustBudgetAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const direction = field(formData, "direction") === "REDUCE" ? "REDUCE" : "INCREASE";
    await adjustBudgetAllocation({
      actor,
      accountId: field(formData, "accountId"),
      direction,
      amount: positiveAmount(formData),
      recurring: formData.get("recurring") === "on",
      explanation: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=adjustment");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=adjustment");
}

export async function transferBudgetAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    await transferBudgetAllocation({
      actor,
      sourceAccountId: field(formData, "sourceAccountId"),
      targetAccountId: field(formData, "targetAccountId"),
      amount: positiveAmount(formData),
      recurring: formData.get("recurring") === "on",
      explanation: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=transfer");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=transfer");
}

export async function refreshBudgetAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    await refreshBudgetPeriod({
      actor,
      accountId: field(formData, "accountId"),
      explanation: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=refresh");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=refresh");
}

export async function setCompanyCeilingAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    await setCompanyCeiling({
      actor,
      companyId: field(formData, "companyId"),
      amount: positiveAmount(formData),
      currency: field(formData, "currency").toUpperCase(),
      explanation: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=ceiling");
  }
  revalidatePath("/budgets");
  revalidatePath("/approvals");
  redirect("/budgets?success=ceiling");
}

export async function requestBudgetCycleChangeAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const frequency = field(formData, "frequency").toUpperCase();
    const rolloverMode = field(formData, "rolloverMode").toUpperCase();
    const dstResolution = field(formData, "dstResolution").toUpperCase();
    if (!["WEEKLY","MONTHLY","QUARTERLY","YEARLY","CUSTOM","MANUAL"].includes(frequency)
      || !["RESET_FIXED","FULL","NONE","PARTIAL_PERCENT","CUSTOM_AMOUNT"].includes(rolloverMode)
      || !["EARLIER","LATER"].includes(dstResolution)) {
      throw new Error("Invalid schedule");
    }
    const schedulePeriod = deriveBudgetPeriodScheduleFields({
      frequency: frequency as BudgetPeriodFrequency,
      intervalCount: boundedNumber(formData, "intervalCount", 1, 52),
      periodStartDate: field(formData, "periodStartDate") || undefined,
      periodEndDate: field(formData, "periodEndDate") || undefined,
      anchorLocal: field(formData, "anchorLocal") || undefined,
      effectiveLocal: field(formData, "effectiveLocal") || undefined,
    });
    await requestBudgetCycleChange({
      actor,
      budgetAccountId: field(formData, "budgetAccountId"),
      config: {
        frequency: frequency as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM" | "MANUAL",
        intervalCount: schedulePeriod.intervalCount,
        customIntervalDays: schedulePeriod.customIntervalDays,
        timezone: field(formData, "timezone"),
        anchorLocal: schedulePeriod.anchorLocal,
        effectiveLocal: schedulePeriod.effectiveLocal,
        dstResolution: dstResolution as "EARLIER" | "LATER",
        fixedAllocation: nonNegativeMoney(formData, "fixedAllocation"),
        rolloverMode: rolloverMode as "RESET_FIXED" | "FULL" | "NONE" | "PARTIAL_PERCENT" | "CUSTOM_AMOUNT",
        rolloverPercentage: optionalNumber(formData, "rolloverPercentage"),
        customRolloverAmount: optionalMoney(formData, "customRolloverAmount"),
        lowThresholdPercentage: boundedNumber(formData, "lowThresholdPercentage", 1, 99),
        criticalThresholdPercentage: boundedNumber(formData, "criticalThresholdPercentage", 0.01, 98),
        hysteresisPercentage: boundedNumber(formData, "hysteresisPercentage", 0.01, 25),
      },
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=cycle");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=cycle");
}

export async function decideBudgetCycleChangeAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const decision = field(formData, "decision").toUpperCase();
    if (decision !== "APPROVE" && decision !== "REJECT") {
      throw new Error("Invalid decision");
    }
    await decideBudgetCycleChange({
      actor,
      changeRequestId: field(formData, "changeRequestId"),
      decision,
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=cycle-decision");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=cycle-decision");
}

export async function requestVariancePolicyChangeAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const toleranceMode = field(formData, "toleranceMode").toUpperCase();
    if (!["NONE","FIXED","PERCENTAGE","LOWER_ONLY"].includes(toleranceMode)) {
      throw new Error("Invalid tolerance");
    }
    await requestVariancePolicyChange({
      actor,
      companyId: field(formData, "companyId"),
      policy: {
        toleranceMode: toleranceMode as "NONE" | "FIXED" | "PERCENTAGE" | "LOWER_ONLY",
        fixedTolerance: optionalNumber(formData, "fixedTolerance"),
        percentageTolerance: optionalNumber(formData, "percentageTolerance"),
        effectiveAt: field(formData, "effectiveAt") || undefined,
      },
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=variance-policy");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=variance-policy");
}

export async function decideVariancePolicyChangeAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const decision = field(formData, "decision").toUpperCase();
    if (decision !== "APPROVE" && decision !== "REJECT") {
      throw new Error("Invalid decision");
    }
    await decideVariancePolicyChange({
      actor,
      changeRequestId: field(formData, "changeRequestId"),
      decision,
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=variance-policy-decision");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=variance-policy-decision");
}

export async function requestBudgetAdjustmentAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const adjustmentType = field(formData, "adjustmentType").toUpperCase();
    if (!["ONE_TIME","TEMPORARY","PERMANENT","TRANSFER"].includes(adjustmentType)) {
      throw new Error("Invalid adjustment");
    }
    await requestBudgetAdjustment({
      actor,
      budgetAccountId: field(formData, "budgetAccountId"),
      adjustment: {
        adjustmentType: adjustmentType as "ONE_TIME" | "TEMPORARY" | "PERMANENT" | "TRANSFER",
        amount: positiveAmount(formData),
        sourceBudgetAccountId: field(formData, "sourceBudgetAccountId") || undefined,
        effectiveUntil: field(formData, "effectiveUntil") || undefined,
      },
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=adjustment-request");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=adjustment-request");
}

export async function decideBudgetAdjustmentAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    const decision = field(formData, "decision").toUpperCase();
    if (!["APPROVE","REJECT","RETURN"].includes(decision)) {
      throw new Error("Invalid decision");
    }
    await decideBudgetAdjustment({
      actor,
      adjustmentRequestId: field(formData, "adjustmentRequestId"),
      decision: decision as "APPROVE" | "REJECT" | "RETURN",
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=adjustment-decision");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=adjustment-decision");
}

export async function rerunBudgetRefreshJobAction(formData: FormData) {
  const actor = await requireCompanyBudgetActor();
  try {
    await rerunBudgetRefreshJob({
      actor,
      jobId: field(formData, "jobId"),
      reason: reason(formData),
      idempotencyKey: idempotencyKey(formData),
    });
  } catch {
    redirect("/budgets?error=refresh-rerun");
  }
  revalidatePath("/budgets");
  redirect("/budgets?success=refresh-rerun");
}
