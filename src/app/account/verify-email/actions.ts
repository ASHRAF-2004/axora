"use server";

import {
  consumeEmailVerificationToken,
  SecurityTokenError,
} from "@/lib/security-notifications";

export type EmailVerificationState = {
  status: "verified" | "invalid" | "unavailable";
  locale?: "en" | "ar" | "ms";
};

export async function verifyEmailTokenAction(
  rawToken: string,
): Promise<EmailVerificationState> {
  try {
    const result = await consumeEmailVerificationToken(rawToken);
    return { status: "verified", locale: result.locale };
  } catch (error) {
    return {
      status: error instanceof SecurityTokenError ? "invalid" : "unavailable",
    };
  }
}
