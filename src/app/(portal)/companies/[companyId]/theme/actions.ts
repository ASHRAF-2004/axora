"use server";

import { requirePermission } from "@/lib/auth";
import {
  COMPANY_LOGO_PLACEMENTS,
  COMPANY_LOGO_VARIANTS,
  COMPANY_THEME_PREFERENCES,
  createCompanyBrandCustomDraft,
  createCompanyBrandPaletteDraft,
  regenerateCompanyBrand,
  rollbackCompanyBrandTheme,
  transitionCompanyBrandTheme,
} from "@/lib/tenant-branding";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const reasonSchema = z.string().trim().min(3).max(1000);
const hexSchema = z.string().trim().toUpperCase().regex(/^#[0-9A-F]{6}$/);

function themePath(companyId: string) {
  return "/companies/" + encodeURIComponent(companyId) + "/theme";
}

function finish(companyId: string, notice: string) {
  revalidatePath("/companies");
  revalidatePath(themePath(companyId));
  revalidatePath("/dashboard");
  redirect(themePath(companyId) + "?notice=" + encodeURIComponent(notice));
}

async function reviewer() {
  const actor = await requirePermission("manage_companies");
  return actor;
}

export async function uploadCompanyBrandDraftAction(
  companyId: string,
  formData: FormData,
) {
  const actor = await reviewer();
  const logo = formData.get("logo");
  if (!(logo instanceof File) || logo.size < 1) {
    redirect(themePath(companyId) + "?notice=logo-required");
  }
  await regenerateCompanyBrand(
    companyId,
    Buffer.from(await logo.arrayBuffer()),
    logo.name,
    logo.type || undefined,
    actor,
  );
  finish(companyId, "draft-generated");
}

export async function createCompanyBrandAlternativeAction(
  companyId: string,
  formData: FormData,
) {
  const actor = await reviewer();
  const input = z.object({
    baseThemeId: z.uuid(),
    paletteChoice: z.enum(["REVERSED", "VIVID", "AXORA_DEFAULT"]),
  }).parse({
    baseThemeId: readFormText(formData, "baseThemeId"),
    paletteChoice: readFormText(formData, "paletteChoice"),
  });
  await createCompanyBrandPaletteDraft(
    companyId,
    input.baseThemeId,
    input.paletteChoice,
    actor,
  );
  finish(companyId, "alternative-generated");
}

export async function createCompanyBrandCustomDraftAction(
  companyId: string,
  formData: FormData,
) {
  const actor = await reviewer();
  const input = z.object({
    baseThemeId: z.uuid(),
    primary: hexSchema,
    secondary: hexSchema,
    accent: hexSchema,
    pageBackground: hexSchema,
    darkPageBackground: hexSchema,
    text: hexSchema,
    textInverse: hexSchema,
    icon: hexSchema,
    iconInverse: hexSchema,
    logoVariant: z.enum(COMPANY_LOGO_VARIANTS),
    logoPlacement: z.enum(COMPANY_LOGO_PLACEMENTS),
    themePreference: z.enum(COMPANY_THEME_PREFERENCES),
    reason: reasonSchema,
  }).parse({
    baseThemeId: readFormText(formData, "baseThemeId"),
    primary: readFormText(formData, "primary"),
    secondary: readFormText(formData, "secondary"),
    accent: readFormText(formData, "accent"),
    pageBackground: readFormText(formData, "pageBackground"),
    darkPageBackground: readFormText(formData, "darkPageBackground"),
    text: readFormText(formData, "text"),
    textInverse: readFormText(formData, "textInverse"),
    icon: readFormText(formData, "icon"),
    iconInverse: readFormText(formData, "iconInverse"),
    logoVariant: readFormText(formData, "logoVariant"),
    logoPlacement: readFormText(formData, "logoPlacement"),
    themePreference: readFormText(formData, "themePreference"),
    reason: "COMPANY_THEME_UPDATED",
  });
  await createCompanyBrandCustomDraft(
    companyId,
    input.baseThemeId,
    input,
    actor,
  );
  finish(companyId, "draft-adjusted");
}

export async function transitionCompanyBrandThemeAction(
  companyId: string,
  formData: FormData,
) {
  const actor = await reviewer();
  const input = z.object({
    themeId: z.uuid(),
    action: z.enum(["APPROVE", "REJECT", "PUBLISH"]),
    reason: reasonSchema,
  }).parse({
    themeId: readFormText(formData, "themeId"),
    action: readFormText(formData, "action"),
    reason: "COMPANY_THEME_REVIEWED",
  });
  const result = await transitionCompanyBrandTheme(
    companyId,
    input.themeId,
    input.action,
    input.reason,
    actor,
  );
  const notice = result.status === "CONTRAST_BLOCKED"
    ? "contrast-blocked"
    : result.status === "INVALID_STATE"
      ? "invalid-state"
      : result.status.toLowerCase();
  finish(companyId, notice);
}

export async function rollbackCompanyBrandThemeAction(
  companyId: string,
  formData: FormData,
) {
  const actor = await reviewer();
  const input = z.object({
    themeId: z.uuid(),
    reason: reasonSchema,
  }).parse({
    themeId: readFormText(formData, "themeId"),
    reason: "COMPANY_THEME_ROLLED_BACK",
  });
  await rollbackCompanyBrandTheme(
    companyId,
    input.themeId,
    input.reason,
    actor,
  );
  finish(companyId, "rolledback");
}
