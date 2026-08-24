"use server";

import { requirePermission } from "@/lib/auth";
import {
  approveCompanyVerification,
  loadCompanyOnboardingWorkspace,
  saveCompanyOnboarding,
} from "@/lib/company-onboarding";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const TIMEZONES = ["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Riyadh", "Asia/Dubai", "Asia/Jakarta", "Asia/Manila", "UTC"] as const;

const setupSchema = z.object({
  companyId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  legalName: z.string().trim().min(2).max(300),
  mainContactName: z.string().trim().min(2).max(300),
  industryCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  defaultLocale: z.enum(SUPPORTED_LOCALES),
  timezone: z.enum(TIMEZONES),
});

export async function saveCompanyOnboardingAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const input = setupSchema.parse({
    companyId: readFormText(formData, "companyId"),
    expectedVersion: readFormText(formData, "expectedVersion"),
    legalName: readFormText(formData, "legalName"),
    mainContactName: readFormText(formData, "mainContactName"),
    industryCode: readFormText(formData, "industryCode"),
    defaultLocale: readFormText(formData, "defaultLocale"),
    timezone: readFormText(formData, "timezone"),
  });
  const current = (await loadCompanyOnboardingWorkspace(actor, input.companyId)).company;
  await saveCompanyOnboarding(actor, {
    ...input,
    registrationCountryCode: current.registrationCountryCode,
    taxRegistrationNumber: current.taxRegistrationNumber,
    industryOtherText: current.industryOtherText,
    registeredAddress: current.registeredAddress,
    operatingAddress: current.operatingAddress,
    billingContactName: current.billingContactName,
    billingContactEmail: current.billingContactEmail,
    billingAddress: current.billingAddress,
    billingCycle: current.billingCycle,
    currentStep: current.currentStep,
    completedSteps: current.completedSteps,
    reason: "COMPANY_UPDATED",
  });
  revalidatePath(`/companies/${input.companyId}/onboarding`);
  revalidatePath(`/companies/${input.companyId}`);
  revalidatePath("/companies");
  redirect(`/companies/${input.companyId}/onboarding?notice=saved`);
}

export async function approveCompanyVerificationAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const expectedVersion = z.coerce.number().int().positive().parse(
    readFormText(formData, "expectedVersion"),
  );
  const result = await approveCompanyVerification(
    actor,
    companyId,
    expectedVersion,
  );
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/companies/${companyId}/onboarding`);
  if (result.status === "VERIFIED") {
    redirect(`/companies/${companyId}?notice=company-verification-approved`);
  }
  if (result.status === "BLOCKED") {
    redirect(`/companies/${companyId}?notice=company-verification-blocked`);
  }
  if (result.status === "STALE") {
    redirect(`/companies/${companyId}?notice=company-verification-stale`);
  }
  if (result.status === "ALREADY_VERIFIED") {
    redirect(`/companies/${companyId}?notice=company-already-verified`);
  }
  redirect(`/companies?notice=company-verification-unavailable`);
}
