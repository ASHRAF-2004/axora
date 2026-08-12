"use client";

import {
  resendAccountSetupInvitationAction,
  type InvitationResendActionState,
} from "@/app/(portal)/users/actions";
import type { SupportedLocale } from "@/lib/i18n";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

const messages = {
  en: {
    resend: "Resend invite", resending: "Replacing and resending setup link…",
    sent: "A new secure invitation was sent.",
    disabled: "A new link was created, but email delivery is disabled.",
    failed: "A new link was created, but the email could not be submitted.",
    unconfirmed: "Delivery could not be confirmed. Check before trying again.",
    pending: "An invitation is already queued or being sent.",
    delivered: "The current invitation was already delivered and is still valid.",
    cooldown: "Wait one minute before replacing this invitation again.",
    hourly: "This account reached the hourly invitation limit.",
    quota: "The invitation safety limit has been reached. Try again later.",
    ineligible: "This account is no longer eligible for an invitation resend.",
  },
  ms: {
    resend: "Hantar semula jemputan", resending: "Mengganti dan menghantar semula pautan persediaan…",
    sent: "Jemputan selamat baharu telah dihantar.",
    disabled: "Pautan baharu dicipta tetapi penghantaran e-mel dilumpuhkan.",
    failed: "Pautan baharu dicipta tetapi e-mel tidak dapat dihantar.",
    unconfirmed: "Penghantaran tidak dapat disahkan. Semak sebelum mencuba lagi.",
    pending: "Jemputan sedang beratur atau sedang dihantar.",
    delivered: "Jemputan semasa telah dihantar dan masih sah.",
    cooldown: "Tunggu satu minit sebelum mengganti jemputan ini lagi.",
    hourly: "Akaun ini telah mencapai had jemputan setiap jam.",
    quota: "Had keselamatan jemputan telah dicapai. Cuba lagi kemudian.",
    ineligible: "Akaun ini tidak lagi layak menerima penghantaran semula jemputan.",
  },
  ar: {
    resend: "إعادة إرسال الدعوة", resending: "جارٍ استبدال رابط الإعداد وإرساله…",
    sent: "تم إرسال دعوة آمنة جديدة.",
    disabled: "تم إنشاء رابط جديد، لكن إرسال البريد الإلكتروني معطل.",
    failed: "تم إنشاء رابط جديد، لكن تعذر إرسال البريد الإلكتروني.",
    unconfirmed: "تعذر تأكيد التسليم. تحقق قبل المحاولة مرة أخرى.",
    pending: "هناك دعوة في قائمة الانتظار أو قيد الإرسال بالفعل.",
    delivered: "تم تسليم الدعوة الحالية وما زالت صالحة.",
    cooldown: "انتظر دقيقة قبل استبدال هذه الدعوة مرة أخرى.",
    hourly: "بلغ هذا الحساب الحد الأقصى للدعوات خلال الساعة.",
    quota: "تم بلوغ حد أمان الدعوات. حاول لاحقًا.",
    ineligible: "لم يعد هذا الحساب مؤهلًا لإعادة إرسال الدعوة.",
  },
} as const;

const initialState: InvitationResendActionState = { status: "idle" };

function Submit({ locale }: { locale: SupportedLocale }) {
  const pending = useFormStatus();
  const copy = messages[locale];
  return <button className="button button-secondary" type="submit" disabled={pending.pending}
    aria-busy={pending.pending} data-feedback-label={copy.resending}>
    {pending.pending ? copy.resending : copy.resend}
  </button>;
}

export function InvitationResendForm({
  userId,
  userName,
  locale,
}: {
  userId: string;
  userName: string;
  locale: SupportedLocale;
}) {
  const [state, action] = useActionState(
    resendAccountSetupInvitationAction,
    initialState,
  );
  const copy = messages[locale];
  useEffect(() => {
    if (state.status === "idle") return;
    window.dispatchEvent(new CustomEvent("axora:form-action-outcome", {
      detail: { outcome: state.status, formId: `invitation-resend-${userId}` },
    }));
  }, [state.status, userId]);

  return <form action={action} data-draft-ignore="true"
    data-draft-id={`invitation-resend-${userId}`}>
    <input type="hidden" name="userId" value={userId} />
    <Submit locale={locale} />
    {state.code ? <p className="subtle" role={state.status === "error" ? "alert" : "status"}>
      {copy[state.code]}
    </p> : null}
    <span className="sr-only">{userName}</span>
  </form>;
}
