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

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function positiveAmount(formData: FormData) {
  const amount = Number(field(formData, "amount"));
  if (!Number.isFinite(amount) || amount<=0 || amount>999_999_999_999) {
    throw new Error("Invalid amount");
  }
  return Math.round(amount*100)/100;
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

export async function adjustBudgetAction(formData: FormData) {
  const actor = await requireSession();
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
  const actor = await requireSession();
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
  const actor = await requireSession();
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
  const actor = await requireSession();
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
