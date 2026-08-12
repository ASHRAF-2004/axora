"use server";

import {
  COMPANY_ONBOARDING_STEPS,
  saveCompanyOnboarding,
  updateCompanyOnboardingItem,
  verifyCompanyOnboarding,
} from "@/lib/company-onboarding";
import { requirePermission } from "@/lib/auth";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { readFormText } from "@/lib/validation";
import { parseZonedDateTime } from "@/lib/zoned-date-time";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const optionalEmail = z.union([z.email().max(320), z.literal("")]);
const profileSchema = z.object({
  companyId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  legalName: z.string().trim().min(2).max(300),
  registrationNumber: z.string().trim().min(1).max(160),
  registrationCountryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  taxRegistrationNumber: z.string().trim().max(160),
  industryCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  industryOtherText: z.string().trim().max(300).optional(),
  registeredAddress: z.string().trim().min(3).max(5000),
  operatingAddress: z.string().trim().min(3).max(5000),
  mainContactName: z.string().trim().min(2).max(300),
  mainContactEmail: z.email().max(320),
  mainContactPhone: z.string().trim().min(3).max(120),
  billingContactName: z.string().trim().max(300),
  billingContactEmail: optionalEmail,
  billingContactPhone: z.string().trim().max(120),
  billingAddress: z.string().trim().min(3).max(5000),
  billingCycle: z.string().trim().min(2).max(300),
  defaultLocale: z.enum(SUPPORTED_LOCALES),
  timezone: z.string().trim().max(120).refine(
    (value) => value === "UTC" || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value),
  ),
  currentStep: z.enum(COMPANY_ONBOARDING_STEPS),
  completedSteps: z.array(z.enum(COMPANY_ONBOARDING_STEPS)).max(9),
  reason: z.string().trim().min(3).max(1000),
});

const itemSchema = z.object({
  companyId: z.uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  itemCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  status: z.enum(["PENDING", "PASSED", "FAILED", "WAIVED"]),
  responsibleUserId: z.uuid().optional(),
  notes: z.string().trim().max(3000).optional(),
  evidenceReference: z.string().trim().max(1000).optional(),
  dueAt: z.date().optional(),
  exceptionReason: z.string().trim().max(1000).optional(),
  exceptionExpiresAt: z.date().optional(),
  reason: z.string().trim().min(3).max(1000),
});

function path(companyId: string) {
  return `/companies/${companyId}/onboarding`;
}

export async function saveCompanyOnboardingAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const input = profileSchema.parse({
    companyId: readFormText(formData, "companyId"),
    expectedVersion: readFormText(formData, "expectedVersion"),
    legalName: readFormText(formData, "legalName"),
    registrationNumber: readFormText(formData, "registrationNumber"),
    registrationCountryCode: readFormText(formData, "registrationCountryCode"),
    taxRegistrationNumber: readFormText(formData, "taxRegistrationNumber"),
    industryCode: readFormText(formData, "industryCode"),
    industryOtherText: readFormText(formData, "industryOtherText") || undefined,
    registeredAddress: readFormText(formData, "registeredAddress"),
    operatingAddress: readFormText(formData, "operatingAddress"),
    mainContactName: readFormText(formData, "mainContactName"),
    mainContactEmail: readFormText(formData, "mainContactEmail"),
    mainContactPhone: readFormText(formData, "mainContactPhone"),
    billingContactName: readFormText(formData, "billingContactName"),
    billingContactEmail: readFormText(formData, "billingContactEmail"),
    billingContactPhone: readFormText(formData, "billingContactPhone"),
    billingAddress: readFormText(formData, "billingAddress"),
    billingCycle: readFormText(formData, "billingCycle"),
    defaultLocale: readFormText(formData, "defaultLocale"),
    timezone: readFormText(formData, "timezone"),
    currentStep: readFormText(formData, "currentStep"),
    completedSteps: formData.getAll("completedSteps").map(String),
    reason: readFormText(formData, "reason"),
  });
  await saveCompanyOnboarding(actor, input);
  revalidatePath(path(input.companyId));
  revalidatePath("/companies");
  redirect(`${path(input.companyId)}?notice=saved`);
}

export async function updateCompanyOnboardingItemAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const status = readFormText(formData, "status");
  const dueValue = readFormText(formData, "dueAt");
  const expiryValue = readFormText(formData, "exceptionExpiresAt");
  const input = itemSchema.parse({
    companyId: readFormText(formData, "companyId"),
    expectedVersion: readFormText(formData, "expectedVersion"),
    itemCode: readFormText(formData, "itemCode"),
    status,
    responsibleUserId: readFormText(formData, "responsibleUserId") || undefined,
    notes: readFormText(formData, "notes") || undefined,
    evidenceReference: readFormText(formData, "evidenceReference") || undefined,
    dueAt: dueValue ? parseZonedDateTime(dueValue, actor.timezone ?? "Asia/Kuala_Lumpur") : undefined,
    exceptionReason: readFormText(formData, "exceptionReason") || undefined,
    exceptionExpiresAt: expiryValue
      ? parseZonedDateTime(expiryValue, actor.timezone ?? "Asia/Kuala_Lumpur")
      : undefined,
    reason: readFormText(formData, "reason"),
  });
  await updateCompanyOnboardingItem(actor, input);
  revalidatePath(path(input.companyId));
  revalidatePath("/companies");
  redirect(`${path(input.companyId)}?notice=item-saved`);
}

export async function verifyCompanyOnboardingAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const expectedVersion = z.coerce.number().int().positive().parse(
    readFormText(formData, "expectedVersion"),
  );
  const reason = z.string().trim().min(3).max(1000).parse(readFormText(formData, "reason"));
  await verifyCompanyOnboarding(actor, companyId, expectedVersion, reason);
  revalidatePath(path(companyId));
  revalidatePath("/companies");
  redirect(`${path(companyId)}?notice=verified`);
}
