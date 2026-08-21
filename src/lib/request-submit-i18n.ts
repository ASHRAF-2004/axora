import type { SupportedLocale } from "./i18n";

const messages = {
  en: {
    "cart-repriced": "A price changed. Review the current cart total and submit again.",
    "cart-product-unavailable": "A product is inactive or its category is not allowed for this purchasing scope.",
    "cart-empty": "Your cart is empty. Add at least one product before submitting.",
    "budget-inactive": "No active budget is available for this purchasing scope.",
    "budget-insufficient": "The available budget is insufficient for this request.",
    "cart-stale": "The cart changed. Review the latest cart and submit again.",
    "request-invalid": "Review the required request details and submit again.",
    "request-unavailable": "The purchase request could not be submitted in your current scope.",
  },
  ar: {
    "cart-repriced": "تغير أحد الأسعار. راجع إجمالي السلة الحالي ثم أرسل مجدداً.",
    "cart-product-unavailable": "أحد المنتجات غير نشط أو فئته غير مسموحة في نطاق الشراء هذا.",
    "cart-empty": "سلتك فارغة. أضف منتجاً واحداً على الأقل قبل الإرسال.",
    "budget-inactive": "لا توجد ميزانية نشطة لنطاق الشراء هذا.",
    "budget-insufficient": "الميزانية المتاحة غير كافية لهذا الطلب.",
    "cart-stale": "تغيرت السلة. راجع أحدث سلة ثم أرسل مجدداً.",
    "request-invalid": "راجع تفاصيل الطلب المطلوبة ثم أرسل مجدداً.",
    "request-unavailable": "تعذر إرسال طلب الشراء ضمن نطاقك الحالي.",
  },
  ms: {
    "cart-repriced": "Harga telah berubah. Semak jumlah troli semasa dan hantar semula.",
    "cart-product-unavailable": "Produk tidak aktif atau kategorinya tidak dibenarkan untuk skop pembelian ini.",
    "cart-empty": "Troli anda kosong. Tambah sekurang-kurangnya satu produk sebelum menghantar.",
    "budget-inactive": "Tiada bajet aktif tersedia untuk skop pembelian ini.",
    "budget-insufficient": "Bajet tersedia tidak mencukupi untuk permintaan ini.",
    "cart-stale": "Troli telah berubah. Semak troli terkini dan hantar semula.",
    "request-invalid": "Semak butiran permintaan yang diperlukan dan hantar semula.",
    "request-unavailable": "Permintaan pembelian tidak dapat dihantar dalam skop semasa anda.",
  },
} as const;

export type RequestSubmitNotice = keyof typeof messages.en;

export function requestSubmitMessage(locale: SupportedLocale, notice: string | undefined) {
  return notice && notice in messages.en
    ? messages[locale][notice as RequestSubmitNotice]
    : null;
}
