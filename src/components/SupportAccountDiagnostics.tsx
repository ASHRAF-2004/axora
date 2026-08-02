"use client";

import {
  diagnoseSupportAccountAction,
  revokeSupportSessionsAction,
  type SupportDiagnosticActionState,
} from "@/app/(portal)/support/actions";
import type { SupportedLocale } from "@/lib/i18n";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

const copy = {
  en: {
    title: "Account diagnostics",
    intro: "Use an exact work email and record why support access is needed. The lookup is audited and never exposes passwords, tokens, private documents, or business records.",
    email: "Exact work email",
    reason: "Diagnostic reason",
    reasonHint: "At least 10 characters; this reason is retained in audit history.",
    search: "Run diagnostic",
    searching: "Checking account…",
    notFound: "No account matched that exact address.",
    invalid: "Enter a valid work email and a clear reason of 10 to 240 characters.",
    unavailable: "Diagnostics are temporarily unavailable. No account change was made.",
    account: "Account",
    role: "Role and kind",
    state: "Access state",
    setup: "Setup and verification",
    sessions: "Active sessions",
    scope: "Assigned scope",
    lastLogin: "Last sign-in",
    never: "Not recorded",
    active: "Active",
    inactive: "Inactive",
    complete: "Setup complete",
    pending: "Setup pending",
    verified: "email verified",
    unverified: "email not verified",
    revokeTitle: "End active sessions",
    revokeBody: "Use only for a verified account-security incident. This rotates the account session version and records the action.",
    revokeReason: "Session-revocation reason",
    revoke: "Revoke active sessions",
    protected: "Platform accounts are protected from technical-support session actions.",
  },
  ar: {
    title: "تشخيص الحساب",
    intro: "استخدم بريد العمل الدقيق وسجّل سبب الحاجة إلى وصول الدعم. تُسجّل عملية البحث في سجل التدقيق ولا تعرض كلمات المرور أو الرموز أو المستندات الخاصة أو سجلات الأعمال.",
    email: "بريد العمل الدقيق",
    reason: "سبب التشخيص",
    reasonHint: "10 أحرف على الأقل؛ يُحفظ هذا السبب في سجل التدقيق.",
    search: "تشغيل التشخيص",
    searching: "جارٍ فحص الحساب…",
    notFound: "لم يطابق أي حساب هذا العنوان الدقيق.",
    invalid: "أدخل بريد عمل صالحًا وسببًا واضحًا من 10 إلى 240 حرفًا.",
    unavailable: "التشخيص غير متاح مؤقتًا. لم يُجرَ أي تغيير على الحساب.",
    account: "الحساب",
    role: "الدور والنوع",
    state: "حالة الوصول",
    setup: "الإعداد والتحقق",
    sessions: "الجلسات النشطة",
    scope: "النطاق المعيّن",
    lastLogin: "آخر تسجيل دخول",
    never: "غير مسجل",
    active: "نشط",
    inactive: "غير نشط",
    complete: "اكتمل الإعداد",
    pending: "الإعداد معلق",
    verified: "البريد موثّق",
    unverified: "البريد غير موثّق",
    revokeTitle: "إنهاء الجلسات النشطة",
    revokeBody: "استخدم هذا الإجراء فقط لحادث أمان حساب متحقق منه. يدوّر إصدار جلسة الحساب ويسجّل الإجراء.",
    revokeReason: "سبب إلغاء الجلسات",
    revoke: "إلغاء الجلسات النشطة",
    protected: "حسابات المنصة محمية من إجراءات جلسات الدعم التقني.",
  },
  ms: {
    title: "Diagnostik akaun",
    intro: "Gunakan e-mel kerja yang tepat dan rekodkan sebab akses sokongan diperlukan. Carian diaudit dan tidak pernah mendedahkan kata laluan, token, dokumen peribadi atau rekod perniagaan.",
    email: "E-mel kerja tepat",
    reason: "Sebab diagnostik",
    reasonHint: "Sekurang-kurangnya 10 aksara; sebab ini disimpan dalam sejarah audit.",
    search: "Jalankan diagnostik",
    searching: "Memeriksa akaun…",
    notFound: "Tiada akaun sepadan dengan alamat tepat itu.",
    invalid: "Masukkan e-mel kerja yang sah dan sebab jelas sepanjang 10 hingga 240 aksara.",
    unavailable: "Diagnostik tidak tersedia buat sementara waktu. Tiada perubahan akaun dibuat.",
    account: "Akaun",
    role: "Peranan dan jenis",
    state: "Keadaan akses",
    setup: "Persediaan dan pengesahan",
    sessions: "Sesi aktif",
    scope: "Skop ditugaskan",
    lastLogin: "Log masuk terakhir",
    never: "Tidak direkodkan",
    active: "Aktif",
    inactive: "Tidak aktif",
    complete: "Persediaan lengkap",
    pending: "Persediaan belum selesai",
    verified: "e-mel disahkan",
    unverified: "e-mel belum disahkan",
    revokeTitle: "Tamatkan sesi aktif",
    revokeBody: "Gunakan hanya untuk insiden keselamatan akaun yang telah disahkan. Tindakan ini memutar versi sesi akaun dan direkodkan.",
    revokeReason: "Sebab pembatalan sesi",
    revoke: "Batalkan sesi aktif",
    protected: "Akaun platform dilindungi daripada tindakan sesi sokongan teknikal.",
  },
} as const;

const initialState: SupportDiagnosticActionState = { status: "idle" };

function SearchButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className="button button-primary" type="submit" disabled={pending} aria-busy={pending}>
    <Search size={17} aria-hidden="true" />{pending ? pendingLabel : label}
  </button>;
}

export function SupportAccountDiagnostics({
  locale,
  timezone,
}: {
  locale: SupportedLocale;
  timezone: string;
}) {
  const [state, action] = useActionState(diagnoseSupportAccountAction, initialState);
  const messages = copy[locale];
  const account = state.diagnostic;
  const formattedLastLogin = account?.lastLoginAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(account.lastLoginAt))
    : messages.never;

  return <section className="panel" data-tour="support-actions">
    <div className="panel-header"><div><h2>{messages.title}</h2><p>{messages.intro}</p></div></div>
    <div className="panel-body">
      <form action={action} className="form-grid">
        <label>{messages.email}<input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
        <label>{messages.reason}<input name="reason" required minLength={10} maxLength={240} /><small>{messages.reasonHint}</small></label>
        <div className="form-actions field-full"><SearchButton label={messages.search} pendingLabel={messages.searching} /></div>
      </form>

      {state.status === "not_found" ? <div className="callout" role="status">{messages.notFound}</div> : null}
      {state.status === "invalid" ? <div className="callout callout-warning" role="alert">{messages.invalid}</div> : null}
      {state.status === "unavailable" ? <div className="callout callout-warning" role="alert">{messages.unavailable}</div> : null}

      {state.status === "found" && account ? <div className="support-diagnostic-result">
        <div className="readiness-list">
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.account}</strong><p>{account.displayName} · {account.maskedEmail}</p></div></div>
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.role}</strong><p>{account.role.replaceAll("_", " ")} · {account.accountKind}</p></div></div>
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.state}</strong><p>{account.active ? messages.active : messages.inactive} · {account.accountStatus}</p></div></div>
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.setup}</strong><p>{account.setupCompleted ? messages.complete : messages.pending} · {account.emailVerified ? messages.verified : messages.unverified}</p></div></div>
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.sessions}</strong><p>{new Intl.NumberFormat(locale).format(account.activeSessionCount)}</p></div></div>
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.scope}</strong><p>{[account.organization, account.branch].filter(Boolean).join(" · ") || account.accountKind}</p></div></div>
          <div className="readiness-item"><ShieldCheck aria-hidden="true" /><div><strong>{messages.lastLogin}</strong><p>{formattedLastLogin}</p></div></div>
        </div>

        {account.protectedPlatformAccount ? <div className="callout"><ShieldAlert size={18} aria-hidden="true" /><p>{messages.protected}</p></div> : <form action={revokeSupportSessionsAction.bind(null, account.id)} className="support-session-action">
          <div><strong>{messages.revokeTitle}</strong><p>{messages.revokeBody}</p></div>
          <label>{messages.revokeReason}<input name="reason" required minLength={10} maxLength={240} /></label>
          <button className="button button-danger" type="submit">{messages.revoke}</button>
        </form>}
      </div> : null}
    </div>
  </section>;
}
