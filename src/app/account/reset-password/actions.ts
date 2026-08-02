"use server";

import {
  consumePasswordResetToken,
  inspectPasswordResetToken,
  SecurityTokenError,
} from "@/lib/security-notifications";
import { PasswordPolicyError } from "@/lib/password-policy";
import { redirect } from "next/navigation";
import type { SupportedLocale } from "@/lib/i18n";
import type { PasswordResetErrorCode } from "@/lib/account-lifecycle-i18n";

export type PasswordResetInspectionState =
  | { status: "valid"; locale: SupportedLocale }
  | { status: "invalid" | "unavailable" };

export interface PasswordResetCompletionState {
  status: "idle" | "error" | "invalid";
  code?: PasswordResetErrorCode;
}

export async function inspectPasswordResetTokenAction(
  rawToken: string,
): Promise<PasswordResetInspectionState> {
  try {
    const inspected = await inspectPasswordResetToken(rawToken);
    return inspected.valid
      ? { status: "valid", locale: inspected.locale }
      : { status: "invalid" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function completePasswordResetAction(
  rawToken: string,
  _previousState: PasswordResetCompletionState,
  formData: FormData,
): Promise<PasswordResetCompletionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");
  if (password !== confirmation) {
    return {
      status: "error",
      code: "password_mismatch",
    };
  }
  try {
    await consumePasswordResetToken(rawToken, password);
  } catch (error) {
    if (error instanceof SecurityTokenError) {
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
  redirect("/login?reset=complete");
}
