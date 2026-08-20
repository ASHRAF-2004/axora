"use client";

import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { clearRequestCart } from "@/lib/request-cart";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

type Notice = {
  message: string;
  tone?: "success" | "error" | "info";
};

const notices: Record<string, Notice> = {
  "company-created": { message: "Company created successfully." },
  "branch-created": { message: "Branch created successfully." },
  "supplier-created": { message: "Supplier created successfully." },
  "product-created": {
    message: "Product created successfully. You can now review its details and images.",
  },
  "product-updated": { message: "Product changes saved successfully." },
  "user-created": { message: "User account created successfully." },
  "user-invited": {
    message: "Account created and secure setup email sent.",
  },
  "user-created-email-disabled": {
    message: "Account created, but email delivery is not configured. Configure it, then resend the setup link.",
    tone: "error",
  },
  "user-created-email-failed": {
    message: "Account created, but the setup email could not be sent. Check email delivery, then resend it.",
    tone: "error",
  },
  "user-created-email-unconfirmed": {
    message: "Account created, but Axora could not confirm the email delivery record. Check with the recipient before resending.",
    tone: "info",
  },
  "user-invitation-resent": {
    message: "A new secure setup link was sent. The previous link is no longer valid.",
  },
  "user-resend-email-disabled": {
    message: "A new setup link was created, but email delivery is not configured. Configure it, then resend again.",
    tone: "error",
  },
  "user-resend-email-failed": {
    message: "A new setup link was created, but its email could not be sent. Check email delivery, then resend again.",
    tone: "error",
  },
  "user-resend-email-unconfirmed": {
    message: "Axora could not confirm delivery of the new setup email. Check with the recipient before resending.",
    tone: "info",
  },
  "user-resend-cooldown": {
    message: "Wait one minute before replacing this setup link again.",
    tone: "info",
  },
  "user-resend-hourly": {
    message: "This account reached the hourly invitation limit. Try again later.",
    tone: "error",
  },
  "user-invitation-quota-actor": {
    message: "This administrator reached the limit of 20 account invitations per hour. Try again after earlier invitations leave the one-hour window.",
    tone: "error",
  },
  "user-invitation-quota-company": {
    message: "This company reached the limit of 100 account invitations per rolling 24 hours. Try again after earlier invitations leave that window.",
    tone: "error",
  },
  "budget-updated": { message: "Branch budget updated successfully." },
  "pricing-updated": {
    message: "Request pricing settings saved successfully.",
  },
  "request-submitted": {
    message: "Purchase request submitted successfully.",
  },
};

const localizedUserCreationNotices: Record<
  SupportedLocale,
  Record<string, Notice>
> = {
  en: {
    "user-creation-invalid": {
      message: "The account details are invalid or no longer match the selected scope. No account was created. Reload the form and try again.",
      tone: "error",
    },
    "user-permission-selection-unavailable": {
      message: "The selected access template changed or includes unavailable permissions. No account was created. Reload the form and try again.",
      tone: "error",
    },
  },
  ar: {
    "user-creation-invalid": {
      message: "بيانات الحساب غير صالحة أو لم تعد مطابقة للنطاق المحدد. لم يتم إنشاء أي حساب. أعد تحميل النموذج ثم حاول مرة أخرى.",
      tone: "error",
    },
    "user-permission-selection-unavailable": {
      message: "تغيّر قالب الصلاحيات المحدد أو يتضمن صلاحيات غير متاحة. لم يتم إنشاء أي حساب. أعد تحميل النموذج ثم حاول مرة أخرى.",
      tone: "error",
    },
  },
  ms: {
    "user-creation-invalid": {
      message: "Butiran akaun tidak sah atau tidak lagi sepadan dengan skop yang dipilih. Tiada akaun dicipta. Muat semula borang dan cuba lagi.",
      tone: "error",
    },
    "user-permission-selection-unavailable": {
      message: "Templat akses yang dipilih telah berubah atau mengandungi kebenaran yang tidak tersedia. Tiada akaun dicipta. Muat semula borang dan cuba lagi.",
      tone: "error",
    },
  },
};

export function NavigationNotice({ locale = "en" }: { locale?: SupportedLocale }) {
  const { notify } = useUxFeedback();
  const searchParams = useSearchParams();
  const handledLocation = useRef<string | null>(null);

  useEffect(() => {
    const notice = searchParams.get("notice");
    if (!notice) {
      handledLocation.current = null;
      return;
    }

    const locationKey = `${window.location.pathname}?${searchParams.toString()}`;
    if (handledLocation.current === locationKey) return;
    handledLocation.current = locationKey;

    const feedback = corePortalMessages(locale).notices[notice]
      ?? localizedUserCreationNotices[locale][notice]
      ?? notices[notice];

    if (notice === "request-submitted") {
      clearRequestCart();
    }

    if (feedback) {
      const tone = feedback.tone ?? "success";
      notify(feedback.message, tone);
      window.dispatchEvent(new CustomEvent("axora:form-action-outcome", {
        detail: { outcome: tone === "success" ? "success" : "error" },
      }));
    }

    // Keep the presentation-only query in the current history entry. Mutating
    // browser history from this effect competes with a later Server Action
    // redirect in Next.js, which can restore this stale route after the action
    // has already committed. The ref prevents duplicate feedback without
    // creating any navigation or changing router state.
  }, [locale, notify, searchParams]);

  return null;
}
