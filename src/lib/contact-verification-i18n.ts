import type { SupportedLocale } from "@/lib/i18n";

const messages = {
  en: {
    failed: "Verification could not be completed. Your enquiry has not been sent.",
    expired: "Verification expired. Verify again without changing your form.",
    timeout: "Verification timed out. Your form is unchanged; try verification again.",
    script: "Verification could not load. Check your connection and whether your browser blocks challenges.cloudflare.com, then reload this page.",
    unsupported: "This browser could not complete verification. Try an up-to-date supported browser.",
    retry: "Retry verification",
    reference: "Verification error code",
    help: "Verification troubleshooting",
  },
  ar: {
    failed: "تعذر إكمال التحقق. لم يُرسل استفسارك.",
    expired: "انتهت صلاحية التحقق. تحقق مجدداً دون تغيير بيانات النموذج.",
    timeout: "انتهت مهلة التحقق. بيانات النموذج لم تتغير؛ حاول التحقق مجدداً.",
    script: "تعذر تحميل التحقق. افحص اتصالك وما إذا كان المتصفح يحجب challenges.cloudflare.com، ثم أعد تحميل الصفحة.",
    unsupported: "تعذر على هذا المتصفح إكمال التحقق. جرّب متصفحاً مدعوماً ومحدّثاً.",
    retry: "إعادة محاولة التحقق",
    reference: "رمز خطأ التحقق",
    help: "استكشاف مشكلات التحقق",
  },
  ms: {
    failed: "Pengesahan tidak dapat diselesaikan. Pertanyaan anda belum dihantar.",
    expired: "Pengesahan telah tamat tempoh. Sahkan semula tanpa mengubah borang anda.",
    timeout: "Pengesahan melebihi had masa. Borang anda tidak berubah; cuba pengesahan semula.",
    script: "Pengesahan tidak dapat dimuatkan. Semak sambungan dan sama ada pelayar menyekat challenges.cloudflare.com, kemudian muat semula halaman ini.",
    unsupported: "Pelayar ini tidak dapat menyelesaikan pengesahan. Cuba pelayar yang disokong dan terkini.",
    retry: "Cuba pengesahan semula",
    reference: "Kod ralat pengesahan",
    help: "Penyelesaian masalah pengesahan",
  },
} as const;

export function contactVerificationMessages(locale: SupportedLocale) {
  return messages[locale];
}

export type ContactVerificationFailure = {
  kind: "failed" | "expired" | "timeout" | "script" | "unsupported" | "configuration";
  code: string | null;
  retry: boolean;
};

// Only public six-digit provider codes are retained. Never render arbitrary
// callback data, challenge tokens, request bodies or browser diagnostics.
export function contactVerificationFailure(value: unknown): ContactVerificationFailure {
  const code = typeof value === "string" && /^\d{6}$/.test(value) ? value : null;
  if (code && ["110100", "110110", "110200", "200100", "400020", "400021", "400070"].includes(code)) {
    return { kind: "configuration", code, retry: false };
  }
  return { kind: code === "110600" || code === "110620" ? "timeout" : "failed", code, retry: true };
}
