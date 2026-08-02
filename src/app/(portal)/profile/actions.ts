"use server";

import { requireAccountLifecycleSession } from "@/lib/auth";
import {
  completeMyProfile,
  removeMyProfileImage,
  saveMyProfileImage,
} from "@/lib/profile";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isSupportedLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { landingPathForSession } from "@/lib/session-landing";

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

export async function saveProfileAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  if (!checked(formData, "policyAccepted")) redirect("/profile?error=invalid-profile");
  const preferredLocale = String(formData.get("preferredLocale") ?? "en");
  try {
    await completeMyProfile({
      displayName: String(formData.get("displayName") ?? ""),
      jobTitle: String(formData.get("jobTitle") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      preferredLocale,
      timezone: String(formData.get("timezone") ?? "Asia/Kuala_Lumpur"),
      emailNotifications: checked(formData, "emailNotifications"),
      inAppNotifications: checked(formData, "inAppNotifications"),
      policyAccepted: true,
    }, actor);
  } catch {
    redirect("/profile?error=invalid-profile");
  }
  if (isSupportedLocale(preferredLocale)) {
    (await cookies()).set(LOCALE_COOKIE, preferredLocale, {
      path: "/",
      maxAge: 31_536_000,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  revalidatePath("/profile");
  redirect(formData.get("onboarding") === "true"
    ? `${landingPathForSession(actor)}?tutorial=1`
    : "/profile?saved=1");
}

export async function uploadProfileImageAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  const file = formData.get("avatar");
  try {
    if (!(file instanceof File)) throw new Error("Choose an image.");
    await saveMyProfileImage(file, actor);
  } catch {
    redirect("/profile?error=invalid-image");
  }
  revalidatePath("/profile");
  redirect("/profile?saved=image");
}

export async function removeProfileImageAction() {
  const actor = await requireAccountLifecycleSession();
  await removeMyProfileImage(actor);
  revalidatePath("/profile");
  redirect("/profile?saved=image-removed");
}
