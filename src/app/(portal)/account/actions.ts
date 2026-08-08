"use server";

import {
  changeOwnPassword,
  revokeAllOtherSessions,
  revokeOtherSession,
} from "@/lib/account-security";
import {
  authenticate,
  clearSession,
  clearStepUpSessionCookie,
  requireAccountLifecycleSession,
  setSession,
  setStepUpAfterPassword,
} from "@/lib/auth";
import { PasswordPolicyError } from "@/lib/password-policy";
import { safeInternalReturnPath } from "@/lib/session-return";
import { requestEmailVerification } from "@/lib/security-notifications";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function requestNetworkIdentifier(requestHeaders: Headers) {
  const candidate = requestHeaders.get("cf-connecting-ip")?.trim()
    || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "network-unavailable";
  return candidate.length <= 128 && !/[\u0000-\u001F\u007F]/.test(candidate)
    ? candidate
    : "network-unavailable";
}

function withReauthSuccess(rawNext: string) {
  const next = safeInternalReturnPath(rawNext, "/account");
  try {
    const parsed = new URL(next, "https://axora.management");
    parsed.searchParams.set("reauth", "ok");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/account?reauth=ok";
  }
}

export async function reauthenticateSensitiveAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const next = safeInternalReturnPath(
    String(formData.get("next") ?? ""),
    "/account",
  );
  const requestHeaders = await headers();
  if (!currentPassword) {
    await clearStepUpSessionCookie();
    redirect(`/account?reauth=1&reauth=invalid&next=${encodeURIComponent(next)}`);
  }

  const verified = await authenticate(actor.email, currentPassword, {
    networkIdentifier: requestNetworkIdentifier(requestHeaders),
  });
  if (!verified || verified.id !== actor.id) {
    await clearStepUpSessionCookie();
    redirect(`/account?reauth=1&reauth=invalid&next=${encodeURIComponent(next)}`);
  }

  // Privilege elevation receives a fresh base-session token. Revoking the old
  // token first is fail-closed; the browser cookie jar then shares the new
  // token consistently with every open tab.
  await clearSession();
  try {
    await setSession(verified);
  } catch {
    const params = new URLSearchParams({
      reason: "expired",
      returnTo: next,
    });
    redirect(`/login?${params.toString()}`);
  }
  await setStepUpAfterPassword(verified, next);
  revalidatePath("/account");
  redirect(withReauthSuccess(next));
}

export async function changePasswordAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmation) redirect("/account?security=password-mismatch");

  let changed: Awaited<ReturnType<typeof changeOwnPassword>>;
  try {
    changed = await changeOwnPassword(actor, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      redirect("/account?security=password-policy");
    }
    redirect("/account?security=change-failed");
  }
  if (changed.status === "invalid_current") {
    redirect("/account?security=change-failed");
  }
  if (changed.status === "reused") {
    redirect("/account?security=password-reused");
  }
  try {
    // auth_version invalidates every prior cookie. Mint one new current session
    // only after the password transaction has committed.
    await setSession({ ...actor, authVersion: changed.authVersion });
  } catch {
    // The password transaction has already committed and prior cookies are
    // invalid. Fall back to a fresh sign-in instead of showing a false failure.
    redirect("/login?reset=complete&returnTo=%2Faccount%3Fsecurity%3Dpassword-changed");
  }
  revalidatePath("/account");
  redirect("/account?security=password-changed");
}

export async function revokeSessionAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  try {
    await revokeOtherSession(actor, String(formData.get("sessionId") ?? ""));
  } catch {
    redirect("/account?security=session-failed");
  }
  revalidatePath("/account");
  redirect("/account?security=session-revoked");
}

export async function revokeAllOtherSessionsAction() {
  const actor = await requireAccountLifecycleSession();
  try {
    await revokeAllOtherSessions(actor);
  } catch {
    redirect("/account?security=session-failed");
  }
  revalidatePath("/account");
  redirect("/account?security=sessions-revoked");
}

export async function resendEmailVerificationAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  const requestHeaders = await headers();
  try {
    await requestEmailVerification(
      actor.id,
      actor.email,
      String(formData.get("locale") ?? "en") as "en" | "ar" | "ms",
      requestNetworkIdentifier(requestHeaders),
    );
  } catch {
    redirect("/account?security=verification-failed");
  }
  redirect("/account?security=verification-sent");
}
