"use server";

import {
  AccountSetupTokenError,
  consumeAccountSetupToken,
  inspectAccountSetupToken,
} from "@/lib/account-setup";
import { PasswordPolicyError } from "@/lib/password-policy";
import type { SupportedLocale } from "@/lib/i18n";
import type { PasswordResetErrorCode } from "@/lib/account-lifecycle-i18n";
import { redirect } from "next/navigation";

export type AccountSetupInspectionState =
  | {
    status: "valid";
    recipientName: string;
    recipientEmail: string;
    companyName: string;
    role: string;
    jobTitle?: string;
    expiresAt: string;
    locale: SupportedLocale;
  }
  | {
    status: "missing" | "malformed" | "invalid" | "expired" | "used"
      | "revoked" | "unavailable";
  };

export interface AccountSetupCompletionState {
  status: "idle" | "error" | "invalid";
  code?: PasswordResetErrorCode | "policy_required";
}

/** Called from the client after the fragment has been removed from the URI. */
export async function inspectAccountSetupTokenAction(
  rawToken: string,
): Promise<AccountSetupInspectionState> {
  try {
    const invitation = await inspectAccountSetupToken(rawToken);
    return invitation.valid
      ? {
        status: "valid",
        recipientName: invitation.recipientName,
        recipientEmail: invitation.recipientEmail,
        companyName: invitation.companyName,
        role: invitation.role,
        ...(invitation.jobTitle ? { jobTitle: invitation.jobTitle } : {}),
        expiresAt: invitation.expiresAt,
        locale: invitation.locale,
      }
      : { status: invitation.reason };
  } catch {
    return { status: "unavailable" };
  }
}

export async function completeAccountSetupAction(
  rawToken: string,
  _previousState: AccountSetupCompletionState,
  formData: FormData,
): Promise<AccountSetupCompletionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");
  const termsAccepted = formData.get("termsAccepted") === "on";
  const privacyAccepted = formData.get("privacyAccepted") === "on";
  if (password !== confirmation) {
    return {
      status: "error",
      code: "password_mismatch",
    };
  }
  if (!termsAccepted || !privacyAccepted) {
    return { status: "error", code: "policy_required" };
  }

  try {
    await consumeAccountSetupToken(rawToken, password, {
      displayName: String(formData.get("displayName") ?? ""),
      locale: String(formData.get("locale") ?? "en") as "en" | "ar" | "ms",
      termsAccepted: true,
      privacyAccepted: true,
    });
  } catch (error) {
    if (error instanceof AccountSetupTokenError) {
      return {
        status: "invalid",
        code: "invalid_link",
      };
    }
    if (error instanceof PasswordPolicyError) {
      return {
        status: "error",
        code: "password_policy",
      };
    }
    return {
      status: "error",
      code: "save_failed",
    };
  }

  redirect("/login?setup=complete");
}
