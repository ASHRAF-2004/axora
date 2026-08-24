import type { SupportedLocale } from "./i18n";

const messages = {
  en: {
    eyebrow: "Shopping cart", title: "Cart", description: "Review products and quantities for this delivery branch.",
    deliverTo: "Deliver to", empty: "Your cart is empty.", continueShopping: "Continue shopping",
    each: "each", quantity: "Quantity", decrease: (name: string) => `Decrease ${name} quantity`,
    increase: (name: string) => `Increase ${name} quantity`, removeItem: (name: string) => `Remove ${name}`,
    subtotal: "Subtotal", total: "Order total", remove: "Remove", continue: "Continue",
    invalidQuantity: "Quantity must be a whole number of at least 1.", tooLarge: "Quantity cannot exceed 1,000,000.",
    stale: "This cart changed in another tab. The latest saved quantity is shown; review it before changing it again.",
    unavailable: "The cart could not be updated. Your last saved quantity is unchanged.", unconfirmed: "The connection ended before this update could be confirmed. Reconnect to load the authoritative cart.", updating: "Updating cart…",
  },
  ar: {
    eyebrow: "سلة التسوق", title: "السلة", description: "راجع المنتجات والكميات لفرع التسليم هذا.",
    deliverTo: "التسليم إلى", empty: "سلتك فارغة.", continueShopping: "متابعة التسوق",
    each: "لكل وحدة", quantity: "الكمية", decrease: (name: string) => `تقليل كمية ${name}`,
    increase: (name: string) => `زيادة كمية ${name}`, removeItem: (name: string) => `إزالة ${name}`,
    subtotal: "المجموع الفرعي", total: "إجمالي الطلب", remove: "إزالة", continue: "متابعة",
    invalidQuantity: "يجب أن تكون الكمية عدداً صحيحاً لا يقل عن 1.", tooLarge: "لا يمكن أن تتجاوز الكمية 1,000,000.",
    stale: "تغيرت هذه السلة في علامة تبويب أخرى. تظهر أحدث كمية محفوظة؛ راجعها قبل تغييرها مجدداً.",
    unavailable: "تعذر تحديث السلة. لم تتغير آخر كمية محفوظة.", unconfirmed: "انقطع الاتصال قبل تأكيد هذا التحديث. أعد الاتصال لتحميل السلة المعتمدة.", updating: "جارٍ تحديث السلة…",
  },
  ms: {
    eyebrow: "Troli membeli-belah", title: "Troli", description: "Semak produk dan kuantiti untuk cawangan penghantaran ini.",
    deliverTo: "Hantar ke", empty: "Troli anda kosong.", continueShopping: "Teruskan membeli-belah",
    each: "setiap satu", quantity: "Kuantiti", decrease: (name: string) => `Kurangkan kuantiti ${name}`,
    increase: (name: string) => `Tambah kuantiti ${name}`, removeItem: (name: string) => `Keluarkan ${name}`,
    subtotal: "Subjumlah", total: "Jumlah pesanan", remove: "Keluarkan", continue: "Teruskan",
    invalidQuantity: "Kuantiti mestilah nombor bulat sekurang-kurangnya 1.", tooLarge: "Kuantiti tidak boleh melebihi 1,000,000.",
    stale: "Troli ini berubah dalam tab lain. Kuantiti terkini yang disimpan dipaparkan; semak sebelum mengubahnya lagi.",
    unavailable: "Troli tidak dapat dikemas kini. Kuantiti terakhir yang disimpan tidak berubah.", unconfirmed: "Sambungan terputus sebelum kemas kini ini dapat disahkan. Sambung semula untuk memuatkan troli berwibawa.", updating: "Mengemas kini troli…",
  },
} as const;

export function cartMessages(locale: SupportedLocale) {
  return messages[locale];
}
