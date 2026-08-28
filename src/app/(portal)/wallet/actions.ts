"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth";
import {
  CompanyWalletValidationError,
  recordCompanyWalletTopUp,
  requestCompanyWalletTopUp,
} from "@/lib/company-wallet";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function walletPath(
  companyId: string,
  parameters: Record<string, string>,
  owner = false,
) {
  const query = new URLSearchParams(parameters);
  if (owner && companyId) {
    return `/companies/${encodeURIComponent(companyId)}/wallet?${query.toString()}`;
  }
  return `/wallet?${query.toString()}`;
}

export async function requestWalletTopUpAction(formData: FormData) {
  const actor = await requirePermission("request_wallet_top_up");
  const companyId = field(formData, "companyId");
  try {
    await requestCompanyWalletTopUp(actor, {
      companyId,
      amount: field(formData, "amount"),
      reference: field(formData, "reference") || undefined,
      note: field(formData, "note") || undefined,
      commandId: field(formData, "commandId"),
    });
  } catch (error) {
    redirect(walletPath(companyId, {
      error: error instanceof CompanyWalletValidationError ? "invalid" : "unavailable",
    }, actor.isOwner));
  }
  revalidatePath("/wallet");
  redirect(walletPath(companyId, { outcome: "requested" }, actor.isOwner));
}

export async function recordWalletTopUpAction(formData: FormData) {
  const actor = await requirePermission("record_wallet_top_up");
  const companyId = field(formData, "companyId");
  let created = false;
  try {
    const result = await recordCompanyWalletTopUp(actor, {
      companyId,
      topUpRequestId: field(formData, "topUpRequestId") || undefined,
      amount: field(formData, "amount"),
      effectiveDate: field(formData, "effectiveDate"),
      reference: field(formData, "reference"),
      reason: "WALLET_TOP_UP_RECORDED",
      commandId: field(formData, "commandId"),
    });
    created = result.created;
  } catch (error) {
    redirect(walletPath(companyId, {
      error: error instanceof CompanyWalletValidationError ? "invalid" : "unavailable",
    }, actor.isOwner));
  }
  revalidatePath("/wallet");
  revalidatePath(`/companies/${encodeURIComponent(companyId)}/wallet`);
  revalidatePath("/dashboard");
  redirect(walletPath(companyId, {
    outcome: created ? "recorded" : "already-recorded",
  }, actor.isOwner));
}
