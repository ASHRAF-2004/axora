"use server";

import { requireAccountLifecycleSession } from "@/lib/auth";
import {
  completeMyProfile,
  removeMyProfileImage,
  saveMyProfileImage,
} from "@/lib/profile";
import { ProfileImageError } from "@/lib/profile-images";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isSupportedLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { landingPathForSession } from "@/lib/session-landing";
import {
  authorizedSessionReturnPath,
  safeInternalReturnPath,
} from "@/lib/session-return";

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function profileStatePath(
  formData: FormData,
  state: { error?: string; saved?: string },
) {
  const params = new URLSearchParams();
  if (state.error) params.set("error", state.error);
  if (state.saved) params.set("saved", state.saved);
  if (formData.get("onboarding") === "true") params.set("onboarding", "1");
  const returnTo = safeInternalReturnPath(
    String(formData.get("returnTo") ?? ""),
    "/dashboard",
  );
  params.set("returnTo", returnTo);
  return `/profile?${params.toString()}`;
}

export async function saveProfileAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  if (!checked(formData, "policyAccepted")) {
    redirect(profileStatePath(formData, { error: "invalid-profile" }));
  }
  const preferredLocale = String(formData.get("preferredLocale") ?? "en");
  try {
    await completeMyProfile({
      displayName: String(formData.get("displayName") ?? ""),
      jobTitle: String(formData.get("jobTitle") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      preferredLocale,
      timezone: String(formData.get("timezone") ?? "Asia/Kuala_Lumpur"),
      emailNotifications: checked(formData, "emailNotifications"),
      inAppNotifications: true,
      policyAccepted: true,
    }, actor);
  } catch {
    redirect(profileStatePath(formData, { error: "invalid-profile" }));
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
  if (formData.get("onboarding") === "true") {
    const landing = landingPathForSession(actor);
    const destination = authorizedSessionReturnPath(
      actor,
      String(formData.get("returnTo") ?? ""),
      landing,
    );
    const parsed = new URL(destination, "https://axora.management");
    parsed.searchParams.set("tutorial", "1");
    redirect(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  }
  redirect("/profile?saved=1");
}

export async function uploadProfileImageAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  const file = formData.get("avatar");
  try {
    if (!(file instanceof File)) throw new Error("Choose an image.");
    await saveMyProfileImage(file, actor, {
      focalX: formData.get("focalX") ?? 50,
      focalY: formData.get("focalY") ?? 50,
      zoom: formData.get("zoom") ?? 1,
    });
  } catch (error) {
    const code = error instanceof ProfileImageError ? error.code : "unavailable";
    redirect(profileStatePath(formData, { error: `image-${code}` }));
  }
  revalidatePath("/profile");
  redirect(profileStatePath(formData, { saved: "image" }));
}

export async function removeProfileImageAction(formData: FormData) {
  const actor = await requireAccountLifecycleSession();
  await removeMyProfileImage(actor);
  revalidatePath("/profile");
  redirect(profileStatePath(formData, { saved: "image-removed" }));
}
